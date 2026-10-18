import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { t } from '../i18n';
import { SpotifyError } from './errors';

/**
 * disconnected：沒有連結；connected：已連結；expired：授權過期要重新連結；
 * logging-in：等使用者在瀏覽器登入；unavailable：瀏覽器預覽，沒有 Rust 端可以登入
 */
export type SpotifyConnection = 'disconnected' | 'connected' | 'expired' | 'logging-in' | 'unavailable';

/** 對應 spotify.rs 的 SpotifyStatus */
export interface SpotifyStatus {
  state: SpotifyConnection;
  clientId: string | null;
  userName: string | null;
  /** 授權大約什麼時候到期（Unix 毫秒，登入後半年） */
  expiresAt: number | null;
  /** 要登記在 Spotify 開發者後台的回呼網址 */
  redirectUri: string;
  error: string | null;
}

/** Spotify 上的一首歌（只留比對歌詞用得到的欄位） */
export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
  /** 國際標準錄音錄影資料代碼：同一個錄音在不同專輯上的 Spotify ID 不同，ISRC 相同 */
  isrc?: string;
  /** 點封面、點歌手時在 Spotify 開啟用 */
  albumId?: string;
  /** 和 artists 一一對應；拿不到的是空字串 */
  artistIds?: string[];
  /** 待播清單用的小封面（約 300px） */
  imageUrl?: string;
}

export interface SpotifyResponse {
  status: number;
  body: string;
}

export type SpotifyMethod = 'GET' | 'PUT' | 'DELETE';

/** 和 Rust 端（spotify.rs）溝通的介面；瀏覽器預覽和測試換成別的實作 */
export interface SpotifyBackend {
  status(): Promise<SpotifyStatus>;
  onStatus(listener: (status: SpotifyStatus) => void): void;
  login(clientId: string): Promise<SpotifyStatus>;
  cancelLogin(): Promise<void>;
  logout(): Promise<SpotifyStatus>;
  openDashboard(): Promise<void>;
  /** 在 Spotify 開啟專輯或歌手：有 ID 用 ID，沒有就用名稱搜尋 */
  open(kind: 'album' | 'artist', id: string | undefined, query: string): Promise<void>;
  call(method: SpotifyMethod, path: string, query?: Record<string, string>): Promise<SpotifyResponse>;
}

export const REDIRECT_URI = 'http://127.0.0.1:47823/callback';
export const STATUS_EVENT = 'spotify://status';
export const DASHBOARD_URL = 'https://developer.spotify.com/dashboard';

export const tauriSpotifyBackend: SpotifyBackend = {
  status: () => invoke<SpotifyStatus>('spotify_status'),
  onStatus: (listener) => void listen<SpotifyStatus>(STATUS_EVENT, (event) => listener(event.payload)),
  login: (clientId) => invoke<SpotifyStatus>('spotify_login', { clientId, page: callbackPage() }),
  cancelLogin: () => invoke<void>('spotify_cancel_login'),
  logout: () => invoke<SpotifyStatus>('spotify_logout'),
  openDashboard: () => invoke<void>('spotify_open_dashboard'),
  open: (kind, id, query) => invoke<void>('spotify_open', { kind, id: id ?? null, query }),
  call: (method, path, query) =>
    invoke<SpotifyResponse>('spotify_api', { method, path, query: query ? Object.entries(query) : null }),
};

/** 登入完成後瀏覽器分頁顯示的文字，跟著介面語言 */
function callbackPage() {
  return {
    lang: document.documentElement.lang,
    successTitle: t('callback.success.title'),
    successMessage: t('callback.success.message'),
    deniedTitle: t('callback.denied.title'),
    deniedMessage: t('callback.denied.message'),
    otherTitle: t('callback.other.title'),
    otherMessage: t('callback.other.message'),
  };
}

export const UNAVAILABLE_STATUS: SpotifyStatus = {
  state: 'unavailable',
  clientId: null,
  userName: null,
  expiresAt: null,
  redirectUri: REDIRECT_URI,
  error: null,
};

/** 瀏覽器預覽：沒有 Rust 端，一律無法使用 */
export const unavailableSpotifyBackend: SpotifyBackend = {
  status: async () => UNAVAILABLE_STATUS,
  onStatus: () => {},
  login: () => Promise.reject(new SpotifyError('unavailable')),
  cancelLogin: async () => {},
  logout: async () => UNAVAILABLE_STATUS,
  openDashboard: async () => {
    window.open(DASHBOARD_URL, '_blank', 'noopener');
  },
  // 瀏覽器預覽：開網頁版
  open: async (kind, id, query) => {
    const url = id ? `https://open.spotify.com/${kind}/${id}` : `https://open.spotify.com/search/${encodeURIComponent(query)}`;
    window.open(url, '_blank', 'noopener');
  },
  call: () => Promise.reject(new SpotifyError('unavailable')),
};

/** 非 2xx 時丟出錯誤代碼（顯示時再依介面語言翻譯） */
function ensureOk(response: SpotifyResponse): void {
  if (response.status >= 200 && response.status < 300) return;
  if (response.status === 403) throw new SpotifyError('forbidden');
  if (response.status === 401) throw new SpotifyError('unauthorized');
  throw new SpotifyError('http', response.status);
}

function parseBody(response: SpotifyResponse): unknown {
  try {
    return JSON.parse(response.body);
  } catch {
    throw new SpotifyError('http', `${response.status} JSON`);
  }
}

/** 約 300px 寬的封面（Spotify 依序給 640、300、64），給待播清單用 */
function pickImage(images: unknown): string | undefined {
  if (!Array.isArray(images)) return undefined;
  const valid = images.filter(
    (image): image is { url: string; width?: number } => isObject(image) && typeof image.url === 'string',
  );
  const medium = valid.find((image) => typeof image.width === 'number' && image.width >= 200 && image.width <= 400);
  return (medium ?? valid[valid.length - 1] ?? valid[0])?.url;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** 把 API 的 track 物件整理成 SpotifyTrack；本機檔案、Podcast 單集、廣告回傳 null（沒有可以比對的 ID）。 */
export function parseTrack(item: unknown): SpotifyTrack | null {
  if (!isObject(item) || item.type !== 'track' || item.is_local === true) return null;
  const id = item.id;
  if (typeof id !== 'string' || !id) return null;
  const artistObjects = Array.isArray(item.artists)
    ? item.artists.filter((artist): artist is Record<string, unknown> => isObject(artist) && typeof artist.name === 'string')
    : [];
  const artists = artistObjects.map((artist) => artist.name as string);
  const artistIds = artistObjects.map((artist) => (typeof artist.id === 'string' ? artist.id : ''));
  const albumObject = isObject(item.album) ? item.album : null;
  const album = albumObject && typeof albumObject.name === 'string' ? albumObject.name : '';
  const albumId = albumObject && typeof albumObject.id === 'string' ? albumObject.id : undefined;
  const imageUrl = albumObject ? pickImage(albumObject.images) : undefined;
  const isrc = isObject(item.external_ids) && typeof item.external_ids.isrc === 'string' ? item.external_ids.isrc : undefined;
  return {
    id,
    uri: typeof item.uri === 'string' ? item.uri : `spotify:track:${id}`,
    name: typeof item.name === 'string' ? item.name : '',
    artists,
    album,
    durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : 0,
    ...(isrc ? { isrc: isrc.toUpperCase() } : {}),
    ...(albumId ? { albumId } : {}),
    artistIds,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

/** 目前在播的歌；沒有在播、在播 Podcast／廣告／本機檔案時回傳 null。 */
export async function getCurrentTrack(backend: SpotifyBackend): Promise<SpotifyTrack | null> {
  const response = await backend.call('GET', 'me/player/currently-playing');
  if (response.status === 204) return null;
  ensureOk(response);
  const data = parseBody(response);
  if (!isObject(data) || data.currently_playing_type !== 'track') return null;
  return parseTrack(data.item);
}

/** 播放佇列裡接下來的歌（略過 Podcast 和本機檔案）。 */
export async function getQueue(backend: SpotifyBackend): Promise<SpotifyTrack[]> {
  const response = await backend.call('GET', 'me/player/queue');
  if (response.status === 204) return [];
  ensureOk(response);
  const data = parseBody(response);
  const queue = isObject(data) && Array.isArray(data.queue) ? data.queue : [];
  return queue.map(parseTrack).filter((track): track is SpotifyTrack => track !== null);
}

/** 這首歌在不在「已按讚的歌曲」裡 */
export async function isSaved(backend: SpotifyBackend, track: SpotifyTrack): Promise<boolean> {
  const response = await backend.call('GET', 'me/library/contains', { uris: track.uri });
  ensureOk(response);
  const data = parseBody(response);
  return Array.isArray(data) && data[0] === true;
}

/** 加入或移出「已按讚的歌曲」 */
export async function setSaved(backend: SpotifyBackend, track: SpotifyTrack, saved: boolean): Promise<void> {
  ensureOk(await backend.call(saved ? 'PUT' : 'DELETE', 'me/library', { uris: track.uri }));
}
