/** SMTC 的播放狀態，對應 smtc.rs 的 status_name。 */
export type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'changing' | 'opened' | 'closed' | 'unknown';

/** Spotify 一次播放狀態的快照，欄位對應 Rust 端的 PlayerSnapshot。 */
export interface PlayerSnapshot {
  appId: string;
  title: string;
  artist: string;
  album: string;
  status: PlaybackStatus;
  positionMs: number;
  durationMs: number;
  /** Spotify 最後一次更新進度的系統時間（Unix 毫秒），0 代表沒有提供 */
  lastUpdatedMs: number;
  /** 封面圖編號，換圖時改變；沒有或 0 代表沒有封面 */
  artworkId?: number;
}

export interface SnapshotEvent {
  /** null 代表偵測不到 Spotify */
  snapshot: PlayerSnapshot | null;
  /** 讀到這份快照的系統時間（Unix 毫秒） */
  capturedMs: number;
}

/** 播放狀態的來源：在 Tauri 裡是 SMTC，瀏覽器預覽時是模擬播放器。 */
export interface PlayerSource {
  readonly kind: 'smtc' | 'mock';
  subscribe(listener: (event: SnapshotEvent) => void): Promise<void>;
  /** 目前的封面圖；沒有封面時回傳 null */
  artwork(): Promise<Blob | null>;
  /** 以下指令都回傳播放器是否接受 */
  seek(positionMs: number): Promise<boolean>;
  togglePlayPause(): Promise<boolean>;
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
}

/** 判斷是不是同一首歌。長度不放進來，因為它可能比歌名晚一步更新。 */
export function trackKey(snapshot: PlayerSnapshot): string {
  return [snapshot.title, snapshot.artist, snapshot.album].join('\u0001');
}
