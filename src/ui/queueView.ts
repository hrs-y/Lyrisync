import { t } from '../i18n';
import type { SpotifyTrack } from '../spotify/api';
import { formatClock } from '../util/format';

export interface QueueEntry {
  track: SpotifyTrack;
  /** 歌詞已經預先找好了 */
  lyricsReady: boolean;
}

export type QueueState = { kind: 'loading' } | { kind: 'error' } | { kind: 'tracks'; entries: QueueEntry[] };

/**
 * 待播清單：接下來要播的歌（小封面、歌名、歌手、長度），預先找好歌詞的標上「歌詞已備妥」。
 * 只是預覽，不能點歌；資料由 main.ts 向 Spotify 要。
 */
export class QueueView {
  private readonly list = document.createElement('ol');
  private readonly status = document.createElement('p');
  /** 只有清單捲動；標題固定在上面，捲動條才不會和右上角的按鈕疊在一起 */
  private readonly scroller = document.createElement('div');
  /** 上次畫的內容；一樣就不重畫（定時更新時清單通常沒變，避免每次都重播進場動畫） */
  private shownKey = '';

  constructor(root: HTMLElement) {
    root.classList.add('queue-view');
    const title = document.createElement('h3');
    title.className = 'queue-title';
    title.textContent = t('queue.title');
    this.list.className = 'queue-list';
    this.status.className = 'queue-status';
    this.scroller.className = 'queue-scroll';
    this.scroller.append(this.status, this.list);
    root.append(title, this.scroller);
  }

  setState(state: QueueState): void {
    const key =
      state.kind === 'tracks'
        ? state.entries.map((entry) => `${entry.track.id}:${entry.lyricsReady ? 1 : 0}`).join(',') || 'empty'
        : state.kind;
    if (key === this.shownKey) return;
    // 讀取中不要蓋掉已經顯示的清單（定時更新時）
    if (state.kind === 'loading' && this.shownKey && this.shownKey !== 'error') return;
    this.shownKey = key;

    this.status.hidden = state.kind === 'tracks' && state.entries.length > 0;
    this.status.textContent =
      state.kind === 'loading' ? t('queue.loading') : state.kind === 'error' ? t('queue.error') : t('queue.empty');
    this.list.replaceChildren(...(state.kind === 'tracks' ? state.entries.map((entry, i) => this.item(entry, i)) : []));
  }

  /** 打開清單時從頭看起 */
  resetScroll(): void {
    this.scroller.scrollTop = 0;
  }

  private item({ track, lyricsReady }: QueueEntry, index: number): HTMLElement {
    const li = document.createElement('li');
    li.className = 'queue-item';
    // 進場時一首一首錯開淡入（前十首）
    li.style.setProperty('--i', String(Math.min(index, 10)));

    const art = document.createElement('div');
    art.className = 'queue-art';
    if (track.imageUrl) {
      const img = document.createElement('img');
      img.src = track.imageUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      art.append(img);
    }

    const text = document.createElement('div');
    text.className = 'queue-text';
    const name = document.createElement('span');
    name.className = 'queue-name';
    name.textContent = track.name;
    name.title = track.name;
    const artist = document.createElement('span');
    artist.className = 'queue-artist';
    artist.textContent = track.artists.join(', ');
    text.append(name, artist);

    const meta = document.createElement('div');
    meta.className = 'queue-meta';
    if (lyricsReady) {
      const badge = document.createElement('span');
      badge.className = 'queue-badge';
      badge.textContent = t('queue.lyricsReady');
      meta.append(badge);
    }
    const duration = document.createElement('span');
    duration.className = 'queue-duration';
    duration.textContent = track.durationMs ? formatClock(track.durationMs) : '';
    meta.append(duration);

    li.append(art, text, meta);
    return li;
  }
}
