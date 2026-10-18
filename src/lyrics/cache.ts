import { invoke } from '@tauri-apps/api/core';
import { trackKey, type PlayerSnapshot } from '../player/types';
import type { Lyrics } from './model';

/** 快取格式改變時加一，舊的快取就會被忽略 */
const CACHE_VERSION = 1;
const DAY_MS = 24 * 3600_000;
const FOUND_TTL_MS = 30 * DAY_MS;
/** 找不到的結果過幾天再重試，來源可能補上了 */
const NOT_FOUND_TTL_MS = 3 * DAY_MS;

interface CacheEntry {
  version: number;
  savedAt: number;
  /** 依好壞排序的所有結果；空陣列代表找不到 */
  results: Lyrics[];
  /** 搜尋時有沒有用 Spotify 的歌曲 ID 查過（連結 Spotify 前存的快取，連結後會重找一次） */
  spotify?: boolean;
}

export interface CachedLyrics {
  results: Lyrics[];
  spotifyChecked: boolean;
}

export interface CacheStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 存在 Rust 端（cache.rs）的程式快取資料夾 */
export const tauriCacheStorage: CacheStorage = {
  read: (key) => invoke<string | null>('cache_read', { key }),
  write: (key, value) => invoke<void>('cache_write', { key, value }),
  remove: (key) => invoke<void>('cache_delete', { key }),
};

/** 瀏覽器預覽與測試用，關掉就消失 */
export function memoryCacheStorage(): CacheStorage {
  const map = new Map<string, string>();
  return {
    read: async (key) => map.get(key) ?? null,
    write: async (key, value) => {
      map.set(key, value);
    },
    remove: async (key) => {
      map.delete(key);
    },
  };
}

/** 檔名用的鍵：歌名、歌手、專輯的 SHA-1（十六進位） */
export async function cacheKey(snapshot: PlayerSnapshot): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(trackKey(snapshot)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class LyricsCache {
  constructor(
    private readonly storage: CacheStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 沒有快取、過期或格式不符時回傳 null。 */
  async get(snapshot: PlayerSnapshot): Promise<CachedLyrics | null> {
    const raw = await this.storage.read(await cacheKey(snapshot));
    if (!raw) return null;
    let entry: CacheEntry;
    try {
      entry = JSON.parse(raw) as CacheEntry;
    } catch {
      return null;
    }
    if (entry.version !== CACHE_VERSION || !Array.isArray(entry.results)) return null;
    const ttl = entry.results.length ? FOUND_TTL_MS : NOT_FOUND_TTL_MS;
    if (this.now() - entry.savedAt > ttl) return null;
    return { results: entry.results, spotifyChecked: entry.spotify === true };
  }

  async put(snapshot: PlayerSnapshot, results: Lyrics[], spotifyChecked = false): Promise<void> {
    const entry: CacheEntry = { version: CACHE_VERSION, savedAt: this.now(), results, spotify: spotifyChecked };
    await this.storage.write(await cacheKey(snapshot), JSON.stringify(entry));
  }

  async forget(snapshot: PlayerSnapshot): Promise<void> {
    await this.storage.remove(await cacheKey(snapshot));
  }
}
