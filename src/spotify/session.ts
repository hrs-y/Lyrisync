import { normalizeForCompare } from '../lyrics/match';
import type { PlayerSnapshot } from '../player/types';
import {
  getCurrentTrack,
  getQueue,
  isSaved,
  setSaved,
  UNAVAILABLE_STATUS,
  type SpotifyBackend,
  type SpotifyStatus,
  type SpotifyTrack,
} from './api';

/** Spotify API 在換歌後通常要一下子才跟上：對不上時隔這些時間再問 */
const RESOLVE_RETRY_MS = [700, 1500, 3000];
/** SMTC 和 API 的長度差在這個範圍內才算同一首 */
const SAME_TRACK_DURATION_DIFF_MS = 3000;
/** 預先找下一首、下下首 */
const PREFETCH_COUNT = 2;
/** 待播清單最多顯示幾首 */
const QUEUE_LIMIT = 30;
/** 視窗回到前景時，距離上次查按讚狀態超過這麼久就再查一次（可能在 Spotify 裡改過） */
const LIKE_RECHECK_MS = 15_000;

/** hidden：沒有可以按讚的歌；ready：已知是否已按讚；busy：正在改 */
export type LikeState = { kind: 'hidden' } | { kind: 'ready'; saved: boolean; busy: boolean };

export interface SpotifySessionOptions {
  backend: SpotifyBackend;
  onStatus(status: SpotifyStatus): void;
  onLike(state: LikeState): void;
  log(message: string, error?: boolean): void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** SMTC 給的這首歌和 Spotify API 回傳的是不是同一首：歌名一樣、長度差不多。 */
export function sameTrack(snapshot: PlayerSnapshot, track: SpotifyTrack): boolean {
  if (normalizeForCompare(snapshot.title) !== normalizeForCompare(track.name)) return false;
  return !snapshot.durationMs || !track.durationMs || Math.abs(snapshot.durationMs - track.durationMs) <= SAME_TRACK_DURATION_DIFF_MS;
}

/** 把 Spotify 的歌當成 SMTC 快照，給歌詞搜尋用（預先找播放佇列裡的歌）。 */
export function snapshotFromTrack(track: SpotifyTrack): PlayerSnapshot {
  return {
    appId: 'spotify-web-api',
    title: track.name,
    artist: track.artists.join(', '),
    album: track.album,
    status: 'paused',
    positionMs: 0,
    durationMs: track.durationMs,
    lastUpdatedMs: 0,
  };
}

/**
 * 連結 Spotify 時的額外功能：換歌時查出這首歌的 Spotify ID 與 ISRC（精準比對歌詞），
 * 讀播放佇列（預先找下一首的歌詞），以及按讚。沒連結時什麼都不做，其他功能照常。
 */
export class SpotifySession {
  status: SpotifyStatus = UNAVAILABLE_STATUS;
  /** 目前這首歌在 Spotify 上的資料；還沒查到或對不上時是 null */
  track: SpotifyTrack | null = null;
  private generation = 0;
  private like: LikeState = { kind: 'hidden' };
  private likeCheckedAt = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: SpotifySessionOptions) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  get connected(): boolean {
    return this.status.state === 'connected';
  }

  get backend(): SpotifyBackend {
    return this.options.backend;
  }

  async init(): Promise<void> {
    this.options.backend.onStatus((status) => this.setStatus(status));
    try {
      this.setStatus(await this.options.backend.status());
    } catch (e) {
      this.options.log(`讀取 Spotify 連結狀態失敗：${String(e)}`, true);
    }
  }

  setStatus(status: SpotifyStatus): void {
    const wasConnected = this.connected;
    this.status = status;
    if (wasConnected && !this.connected) {
      this.track = null;
      this.setLike({ kind: 'hidden' });
    }
    this.options.onStatus(status);
  }

  /**
   * 換歌時呼叫：回傳這首歌在 Spotify 上的資料（給歌詞搜尋精準比對）。
   * 沒連結時回傳 undefined（不必等）；對不上（本機檔案、Podcast）時 resolve 成 null；查詢失敗時 reject。
   */
  trackFor(snapshot: PlayerSnapshot | null): Promise<SpotifyTrack | null> | undefined {
    const generation = ++this.generation;
    this.track = null;
    this.setLike({ kind: 'hidden' });
    if (!snapshot || !this.connected) return undefined;
    const lookup = this.resolve(snapshot, generation);
    lookup.then(
      (track) => {
        if (generation !== this.generation) return;
        this.track = track;
        if (track) {
          const isrc = track.isrc ? `，ISRC ${track.isrc}` : '';
          this.options.log(`對應到 Spotify 歌曲 ${track.id}${isrc}`);
          void this.refreshLike(generation);
        } else {
          this.options.log('Spotify 上對不到這首歌（可能是本機檔案、Podcast 或廣告）');
        }
      },
      (e: unknown) => {
        if (generation === this.generation) this.options.log(`查詢 Spotify 目前歌曲失敗：${errorText(e)}`, true);
      },
    );
    return lookup;
  }

  private async resolve(snapshot: PlayerSnapshot, generation: number): Promise<SpotifyTrack | null> {
    for (let attempt = 0; ; attempt++) {
      const track = await getCurrentTrack(this.options.backend);
      if (track && sameTrack(snapshot, track)) return track;
      // 換過歌了，或 API 還沒跟上：等一下再問
      if (attempt >= RESOLVE_RETRY_MS.length || generation !== this.generation) return null;
      await this.sleep(RESOLVE_RETRY_MS[attempt]);
    }
  }

  /** 播放佇列裡接下來的幾首（不含目前這首），給歌詞預先搜尋。 */
  async upcoming(): Promise<SpotifyTrack[]> {
    return (await this.queue()).filter((track, index, all) => all.findIndex((other) => other.id === track.id) === index).slice(0, PREFETCH_COUNT);
  }

  /** 待播清單：接下來要播的歌（開頭若是目前這首就略過；同一首可以重複出現，例如單曲循環）。 */
  async queue(limit = QUEUE_LIMIT): Promise<SpotifyTrack[]> {
    if (!this.connected) return [];
    const tracks = await getQueue(this.options.backend);
    const start = tracks[0]?.id === this.track?.id ? 1 : 0;
    return tracks.slice(start, start + limit);
  }

  /** 按讚或取消；先改畫面，失敗再改回來。 */
  async toggleLike(): Promise<void> {
    const track = this.track;
    const like = this.like;
    if (!track || like.kind !== 'ready' || like.busy) return;
    const generation = this.generation;
    const next = !like.saved;
    this.setLike({ kind: 'ready', saved: next, busy: true });
    try {
      await setSaved(this.options.backend, track, next);
      this.options.log(next ? `已加入「已按讚的歌曲」：${track.name}` : `已從「已按讚的歌曲」移除：${track.name}`);
      if (generation === this.generation) this.setLike({ kind: 'ready', saved: next, busy: false });
    } catch (e) {
      this.options.log(`${next ? '按讚' : '取消按讚'}失敗：${errorText(e)}`, true);
      if (generation === this.generation) this.setLike({ kind: 'ready', saved: like.saved, busy: false });
    }
  }

  /** 視窗回到前景時呼叫：可能在 Spotify 裡按過讚，隔一段時間就重新查一次。 */
  recheckLike(): void {
    if (this.track && this.like.kind === 'ready' && !this.like.busy && this.now() - this.likeCheckedAt > LIKE_RECHECK_MS) {
      void this.refreshLike(this.generation);
    }
  }

  /** 除錯面板用 */
  describe(): string {
    if (this.status.state === 'unavailable') return '瀏覽器預覽無法使用';
    if (!this.connected) return this.status.state === 'expired' ? '授權過期，需要重新連結' : '未連結';
    if (!this.track) return '已連結｜這首歌還沒對應到';
    const isrc = this.track.isrc ? `｜ISRC ${this.track.isrc}` : '';
    return `已連結｜${this.track.id}${isrc}`;
  }

  private async refreshLike(generation: number): Promise<void> {
    const track = this.track;
    if (!track) return;
    this.likeCheckedAt = this.now();
    try {
      const saved = await isSaved(this.options.backend, track);
      if (generation === this.generation && this.track === track) this.setLike({ kind: 'ready', saved, busy: false });
    } catch (e) {
      this.options.log(`查詢按讚狀態失敗：${errorText(e)}`, true);
    }
  }

  private setLike(state: LikeState): void {
    this.like = state;
    this.options.onLike(state);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
