import { t } from '../i18n';
import type { PlayerSnapshot } from '../player/types';
import type { LikeState } from '../spotify/session';
import { formatClock } from '../util/format';
import type { Artwork } from './artwork';
import { icon } from './icons';

export interface PlayerActions {
  previous(): void;
  togglePlayPause(): void;
  next(): void;
  seek(positionMs: number): void;
  /** 加入或移出 Spotify 的「已按讚的歌曲」 */
  toggleLike(): void;
  /** 在 Spotify 開啟這首歌的專輯（點封面、點專輯名稱） */
  openAlbum(): void;
  /** 在 Spotify 開啟第 index 位歌手（點歌手名稱） */
  openArtist(index: number, name: string): void;
}

/** SMTC 把多位歌手用「, 」連在一起；只用這個切，免得拆開「Simon & Garfunkel」這種團名 */
export function splitSmtcArtists(artist: string): string[] {
  return artist
    .split(', ')
    .map((name) => name.trim())
    .filter(Boolean);
}

/** lyrics：封面在左、歌詞在右；cover：沒有歌詞，封面置中放大；idle：沒偵測到 Spotify */
export type PlayerMode = 'lyrics' | 'cover' | 'idle';

const SEEK_STEP_MS = 5000;
const SEEK_PAGE_MS = 15000;
const COVER_FADE_MS = 700;
const MODE_TRANSITION_MS = 760;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** 播放頁左半部：封面、歌名與歌手、進度條、播放控制。 */
export class PlayerView {
  private readonly coverFrame: HTMLElement;
  private readonly cover: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly title: HTMLElement;
  private readonly artist: HTMLElement;
  private readonly transport: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly elapsed: HTMLElement;
  private readonly remaining: HTMLElement;
  private readonly note: HTMLElement;
  private readonly likeButton: HTMLButtonElement;
  private liked = false;
  private album = '';
  private artistNames: string[] = [];
  private trackKey = '';
  private durationMs = 0;
  private positionMs = 0;
  private dragRatio: number | null = null;
  private shownSecond = -1;
  private animate = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: PlayerActions,
  ) {
    const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    this.coverFrame = $('.cover-frame');
    this.cover = $('.cover');
    this.meta = $('.meta');
    this.title = $('.title');
    this.artist = $('.artist');
    this.transport = $('.transport');
    this.progress = $('.progress');
    this.elapsed = $('.time-elapsed');
    this.remaining = $('.time-remaining');
    this.note = $('.status-note');
    this.likeButton = $<HTMLButtonElement>('.like-button');
    this.likeButton.innerHTML = `<span class="icon-heart">${icon('heart')}</span><span class="icon-heart-filled">${icon('heartFilled')}</span>`;
    this.likeButton.addEventListener('click', () => actions.toggleLike());
    // 點封面在 Spotify 開啟專輯（沒有歌時不能點）
    this.coverFrame.addEventListener('click', () => {
      if (this.trackKey) actions.openAlbum();
    });
    this.coverFrame.addEventListener('keydown', (event) => {
      if (!this.trackKey || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      actions.openAlbum();
    });
    this.artist.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement).closest<HTMLElement>('[data-artist], .album-link');
      if (!link) return;
      if (link.classList.contains('album-link')) actions.openAlbum();
      else actions.openArtist(Number(link.dataset.artist), link.textContent ?? '');
    });

    $('.cover-placeholder').innerHTML = icon('note');
    const previous = $<HTMLButtonElement>('.control-previous');
    const play = $<HTMLButtonElement>('.control-play');
    const next = $<HTMLButtonElement>('.control-next');
    previous.innerHTML = icon('previous');
    next.innerHTML = icon('next');
    play.innerHTML = `<span class="icon-play">${icon('play')}</span><span class="icon-pause">${icon('pause')}</span>`;
    previous.addEventListener('click', () => actions.previous());
    play.addEventListener('click', () => actions.togglePlayPause());
    next.addEventListener('click', () => actions.next());
    this.bindProgress();
  }

  /** 按讚按鈕：沒連結 Spotify、或這首歌在 Spotify 上對不到時隱藏。剛按讚時愛心彈一下。 */
  setLike(state: LikeState): void {
    this.likeButton.hidden = state.kind === 'hidden';
    if (state.kind === 'hidden') return;
    const label = state.saved ? t('player.unlike') : t('player.like');
    this.likeButton.setAttribute('aria-pressed', String(state.saved));
    this.likeButton.setAttribute('aria-label', label);
    this.likeButton.title = label;
    this.likeButton.classList.toggle('busy', state.busy);
    if (state.saved && !this.liked && this.animate) {
      this.likeButton.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(0.94)' }, { transform: 'scale(1)' }],
        { duration: 520, easing: EASE_OUT },
      );
    }
    this.liked = state.saved;
  }

  /** 低動畫品質或系統要求減少動態時，關掉版面切換的位移動畫。 */
  setAnimationsEnabled(enabled: boolean): void {
    this.animate = enabled;
  }

  setMode(mode: PlayerMode): void {
    const previous = this.root.dataset.mode;
    if (previous === mode) return;
    if (!previous || !this.animate) {
      this.root.dataset.mode = mode;
      return;
    }
    // FLIP：記下切換前的位置，切換後從舊位置平滑移到新位置
    const targets = [this.coverFrame, this.meta, this.transport];
    const before = targets.map((el) => el.getBoundingClientRect());
    this.root.dataset.mode = mode;
    targets.forEach((el, i) => {
      const after = el.getBoundingClientRect();
      if (!before[i].width || !after.width) return;
      const dx = before[i].left + before[i].width / 2 - (after.left + after.width / 2);
      const dy = before[i].top + before[i].height / 2 - (after.top + after.height / 2);
      const scale = el === this.coverFrame ? before[i].width / after.width : 1;
      el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'translate(0, 0) scale(1)' }], {
        duration: MODE_TRANSITION_MS,
        easing: EASE_OUT,
        composite: 'add',
      });
    });
  }

  setTrack(snapshot: PlayerSnapshot | null): void {
    const key = snapshot ? `${snapshot.title}\u0001${snapshot.artist}\u0001${snapshot.album}` : '';
    if (key === this.trackKey) return;
    this.trackKey = key;
    this.title.textContent = snapshot?.title || t('app.waiting');
    if (snapshot) {
      this.album = snapshot.album && snapshot.album !== snapshot.title ? snapshot.album : '';
      this.renderArtists(splitSmtcArtists(snapshot.artist));
      this.title.title = snapshot.title;
      this.coverFrame.setAttribute('role', 'button');
      this.coverFrame.tabIndex = 0;
      this.coverFrame.setAttribute('aria-label', t('player.openAlbum'));
      this.coverFrame.title = t('player.openAlbum');
    } else {
      this.artistNames = [];
      this.artist.textContent = t('app.waitingHint');
      this.title.removeAttribute('title');
      for (const name of ['role', 'tabindex', 'aria-label', 'title']) this.coverFrame.removeAttribute(name);
    }
    if (this.animate) {
      const enter = [
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ];
      this.title.animate(enter, { duration: 520, easing: EASE_OUT });
      this.artist.animate(enter, { duration: 520, delay: 70, easing: EASE_OUT, fill: 'backwards' });
    }
    this.shownSecond = -1;
  }

  /** Spotify 對應到這首歌後，用它的歌手清單（名字一定是分開的）重新畫歌手連結。 */
  setArtists(names: readonly string[]): void {
    if (!this.trackKey || !names.length || names.join('') === this.artistNames.join('')) return;
    this.renderArtists([...names]);
  }

  /** 歌手一人一個連結，後面接專輯名稱（也可以點） */
  private renderArtists(names: string[]): void {
    this.artistNames = names;
    this.artist.replaceChildren();
    names.forEach((name, index) => {
      if (index) this.artist.append(', ');
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'artist-link';
      link.dataset.artist = String(index);
      link.textContent = name;
      link.title = t('player.openArtist', { name });
      this.artist.append(link);
    });
    if (this.album) {
      this.artist.append(' — ');
      const album = document.createElement('button');
      album.type = 'button';
      album.className = 'album-link';
      album.textContent = this.album;
      album.title = t('player.openAlbum');
      this.artist.append(album);
    }
  }

  /** 換封面：新的一張淡入並從稍大的尺寸收回，舊的等淡入完成再拿掉。 */
  setArtwork(artwork: Artwork | null, alt = ''): void {
    const layers = Array.from(this.cover.querySelectorAll<HTMLImageElement>('img.cover-image'));
    const current = layers[layers.length - 1];
    if ((current?.dataset.src ?? null) === (artwork?.url ?? null)) return;
    this.cover.classList.toggle('empty', !artwork);
    // 封面陰影染上封面的顏色
    if (!artwork) {
      for (const layer of layers) layer.classList.add('leaving');
      setTimeout(() => layers.forEach((layer) => layer.remove()), COVER_FADE_MS);
      return;
    }
    const img = document.createElement('img');
    img.className = 'cover-image';
    img.src = artwork.url;
    img.alt = alt;
    img.draggable = false;
    img.dataset.src = artwork.url;
    this.cover.append(img);
    if (this.animate && current) {
      img.animate(
        [
          { opacity: 0, transform: 'scale(1.04)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        { duration: COVER_FADE_MS, easing: EASE_OUT },
      );
    }
    setTimeout(() => layers.forEach((layer) => layer.remove()), this.animate ? COVER_FADE_MS : 0);
  }

  setPlaying(playing: boolean): void {
    this.root.classList.toggle('is-playing', playing);
  }

  /** 狀態說明（例如「找不到歌詞」），可以附一個按鈕。傳 null 隱藏。 */
  setNote(text: string | null, action?: { label: string; run(): void }): void {
    this.note.replaceChildren();
    this.note.hidden = !text;
    if (!text) return;
    const span = document.createElement('span');
    span.textContent = text;
    this.note.append(span);
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = action.label;
      button.addEventListener('click', () => action.run());
      this.note.append(button);
    }
  }

  /** 每個影格呼叫：更新進度條與時間（拖曳中顯示拖到的位置）。 */
  update(positionMs: number, durationMs: number): void {
    this.positionMs = positionMs;
    this.durationMs = durationMs;
    const ratio =
      this.dragRatio ?? (durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0);
    this.progress.style.setProperty('--progress', ratio.toFixed(5));

    const shownMs = this.dragRatio !== null ? this.dragRatio * durationMs : positionMs;
    const second = Math.floor(shownMs / 1000);
    if (second === this.shownSecond) return;
    this.shownSecond = second;
    this.elapsed.textContent = formatClock(shownMs);
    this.remaining.textContent = durationMs > 0 ? `-${formatClock(Math.max(0, durationMs - shownMs))}` : '';
    this.progress.setAttribute('aria-valuenow', String(second));
    this.progress.setAttribute('aria-valuemax', String(Math.floor(durationMs / 1000)));
    this.progress.setAttribute('aria-valuetext', `${formatClock(shownMs)}／${formatClock(durationMs)}`);
  }

  private bindProgress(): void {
    const ratioAt = (clientX: number) => {
      const rect = this.progress.getBoundingClientRect();
      return rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    };
    let pointerId: number | null = null;

    this.progress.addEventListener('pointerdown', (event) => {
      if (this.durationMs <= 0 || event.button !== 0) return;
      pointerId = event.pointerId;
      this.progress.setPointerCapture(event.pointerId);
      this.progress.classList.add('dragging');
      this.dragRatio = ratioAt(event.clientX);
      this.update(this.positionMs, this.durationMs);
    });
    this.progress.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      this.dragRatio = ratioAt(event.clientX);
      this.update(this.positionMs, this.durationMs);
    });
    const finish = (commit: boolean) => (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      this.progress.classList.remove('dragging');
      if (commit && this.dragRatio !== null) this.actions.seek(this.dragRatio * this.durationMs);
      this.dragRatio = null;
    };
    this.progress.addEventListener('pointerup', finish(true));
    this.progress.addEventListener('pointercancel', finish(false));

    this.progress.addEventListener('keydown', (event) => {
      if (this.durationMs <= 0) return;
      const steps: Record<string, number> = {
        ArrowLeft: -SEEK_STEP_MS,
        ArrowRight: SEEK_STEP_MS,
        PageDown: -SEEK_PAGE_MS,
        PageUp: SEEK_PAGE_MS,
      };
      let target: number | null = null;
      if (event.key in steps) target = this.positionMs + steps[event.key];
      else if (event.key === 'Home') target = 0;
      if (target === null) return;
      event.preventDefault();
      event.stopPropagation();
      this.actions.seek(Math.min(this.durationMs - 1000, Math.max(0, target)));
    });
  }
}
