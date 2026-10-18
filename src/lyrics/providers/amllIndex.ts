import type { HttpGet } from '../../net/http';

/** AMLL TTML DB 的 Spotify 索引：每行一首歌，含它的所有 Spotify ID 與 ISRC */
const INDEX_SOURCES = [
  'https://amll.mirror.dimeta.top/api/db/spotify-lyrics/index.jsonl',
  'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/spotify-lyrics/index.jsonl',
];
/** 索引約 3MB，鏡像下載約 7 秒 */
const INDEX_TIMEOUT_MS = 30_000;
/** 下載失敗後隔多久再試 */
const RETRY_AFTER_MS = 10 * 60_000;

interface IndexEntry {
  id?: unknown;
  metadata?: unknown;
}

/** 從索引的每一行取出 ISRC → Spotify ID（有歌詞檔的那個 ID）。 */
export function parseSpotifyIndex(text: string): Map<string, string> {
  const byIsrc = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry: IndexEntry;
    try {
      entry = JSON.parse(line) as IndexEntry;
    } catch {
      continue;
    }
    if (typeof entry.id !== 'string' || !Array.isArray(entry.metadata)) continue;
    for (const pair of entry.metadata) {
      if (!Array.isArray(pair) || pair[0] !== 'isrc' || !Array.isArray(pair[1])) continue;
      for (const isrc of pair[1]) {
        if (typeof isrc === 'string' && isrc && !byIsrc.has(isrc.toUpperCase())) byIsrc.set(isrc.toUpperCase(), entry.id);
      }
    }
  }
  return byIsrc;
}

/**
 * 同一個錄音在 Spotify 上常有好幾個 ID（單曲、專輯、精選輯），AMLL TTML DB 只收錄其中幾個。
 * 用歌曲 ID 找不到時，改用 ISRC 查索引找到收錄的那個 ID。索引在第一次需要時才下載，之後留在記憶體。
 */
export class AmllSpotifyIndex {
  private loading: Promise<Map<string, string> | null> | null = null;
  private failedAt = 0;

  constructor(
    private readonly http: HttpGet,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 回傳收錄了這個 ISRC 的 Spotify ID；索引下載失敗時回傳 null（不丟錯誤，只是少一個管道）。 */
  async idForIsrc(isrc: string): Promise<string | null> {
    const index = await this.load();
    return index?.get(isrc.toUpperCase()) ?? null;
  }

  private load(): Promise<Map<string, string> | null> {
    if (this.loading) return this.loading;
    if (this.failedAt && this.now() - this.failedAt < RETRY_AFTER_MS) return Promise.resolve(null);
    this.loading = this.download().then((index) => {
      if (!index) {
        this.failedAt = this.now();
        this.loading = null;
      }
      return index;
    });
    return this.loading;
  }

  private async download(): Promise<Map<string, string> | null> {
    for (const url of INDEX_SOURCES) {
      try {
        const response = await this.http(url, { timeoutMs: INDEX_TIMEOUT_MS });
        if (response.status === 200) {
          const index = parseSpotifyIndex(response.body);
          if (index.size) return index;
        }
      } catch {
        // 換下一個來源
      }
    }
    return null;
  }
}
