import type { PlayerSnapshot } from '../player/types';
import type { SpotifyTrack } from '../spotify/api';
import type { LyricsCache } from './cache';
import { loadChineseConverter } from './chinese';
import { normalizeForCompare } from './match';
import type { Lyrics } from './model';
import { isBestPossible, rankLyrics } from './rank';

/** 搜尋時額外知道的資訊 */
export interface SearchContext {
  /**
   * 這首歌在 Spotify 上的資料（連結 Spotify 時才有）：resolve 成 null 代表查過但對不到（本機檔案等），
   * reject 代表查詢失敗。來源自己決定要不要等它。
   */
  spotify?: Promise<SpotifyTrack | null>;
}

export interface LyricsProvider {
  readonly name: string;
  /** 每找到一份歌詞就呼叫一次 found；全部找完才 resolve。連線或解析失敗就 reject。 */
  search(snapshot: PlayerSnapshot, found: (lyrics: Lyrics) => void, context?: SearchContext): Promise<void>;
}

export interface SearchUpdate {
  /** 依好壞排序的結果，第一個最好；空陣列代表（目前）找不到 */
  results: Lyrics[];
  /** 所有來源都回覆了，或結果來自快取 */
  done: boolean;
  fromCache: boolean;
  /** 結果是播放佇列預先找好的 */
  prefetched?: boolean;
  /** 失敗的來源與原因 */
  errors: string[];
  /** 每個來源花了多久（毫秒） */
  timings: Record<string, number>;
}

/** 寬限期內只有「最好那一級」的結果會立刻顯示，避免一首歌開頭換好幾次歌詞 */
const DEFAULT_GRACE_MS = 1200;
/** 記住幾首預先找好的歌 */
const MAX_PREFETCHED = 4;
/** 預先找好的歌和實際播放的歌，長度差在這個範圍內才算同一首 */
const PREFETCH_DURATION_DIFF_MS = 3000;

interface Prefetched {
  snapshot: PlayerSnapshot;
  results: Lyrics[];
  spotifyChecked: boolean;
}

/** 同時詢問所有來源，依精細度與來源排名；結果先寫進快取，下次直接用。 */
export class LyricsService {
  private prefetched: Prefetched[] = [];

  constructor(
    private readonly providers: readonly LyricsProvider[],
    private readonly cache: LyricsCache | null,
    private readonly graceMs = DEFAULT_GRACE_MS,
  ) {}

  /**
   * 開始找這首歌的歌詞。最好的結果改變、或全部找完時呼叫 onUpdate。
   * 回傳取消函式：換歌時呼叫，之後就不會再收到這首歌的更新。
   */
  search(snapshot: PlayerSnapshot, onUpdate: (update: SearchUpdate) => void, context: SearchContext = {}): () => void {
    let cancelled = false;
    void this.run(
      snapshot,
      context,
      (update) => {
        if (!cancelled) onUpdate(update);
      },
      () => cancelled,
    );
    return () => {
      cancelled = true;
    };
  }

  /**
   * 先幫播放佇列裡的下一首找好歌詞：結果寫進快取，也記在記憶體裡。
   * 換到這首歌時，就算 SMTC 給的歌手寫法和 Spotify API 不同（快取鍵對不上），也能用歌名和長度認出來。
   * 回傳找到幾份；已經有快取就不找。
   */
  async prefetch(snapshot: PlayerSnapshot, context: SearchContext = {}): Promise<number> {
    if (this.findPrefetched(snapshot)) return -1;
    const cached = await this.cache?.get(snapshot).catch(() => null);
    if (cached && (!context.spotify || cached.spotifyChecked)) return -1;
    return new Promise((resolve) => {
      void this.run(
        snapshot,
        context,
        (update) => {
          if (update.done) resolve(update.results.length);
        },
        () => false,
        true,
      );
    });
  }

  /** 這首歌已經預先找好、而且有找到歌詞（待播清單的「歌詞已備妥」）。 */
  hasPrefetched(snapshot: PlayerSnapshot): boolean {
    return Boolean(this.findPrefetched(snapshot)?.results.length);
  }

  /** 丟掉這首歌的快取，下次搜尋會重新詢問所有來源。 */
  async forget(snapshot: PlayerSnapshot): Promise<void> {
    const found = this.findPrefetched(snapshot);
    if (found) this.prefetched = this.prefetched.filter((entry) => entry !== found);
    await this.cache?.forget(snapshot);
  }

  private findPrefetched(snapshot: PlayerSnapshot): Prefetched | undefined {
    const title = normalizeForCompare(snapshot.title);
    const album = normalizeForCompare(snapshot.album);
    return this.prefetched.find(
      (entry) =>
        normalizeForCompare(entry.snapshot.title) === title &&
        normalizeForCompare(entry.snapshot.album) === album &&
        (!snapshot.durationMs ||
          !entry.snapshot.durationMs ||
          Math.abs(entry.snapshot.durationMs - snapshot.durationMs) <= PREFETCH_DURATION_DIFF_MS),
    );
  }

  private remember(entry: Prefetched): void {
    this.prefetched = [entry, ...this.prefetched.filter((other) => other.snapshot !== entry.snapshot)].slice(0, MAX_PREFETCHED);
  }

  private async run(
    snapshot: PlayerSnapshot,
    context: SearchContext,
    emit: (update: SearchUpdate) => void,
    isCancelled: () => boolean,
    prefetching = false,
  ) {
    // 查詢失敗是正常情況（沒連上、被限流）：先掛上處理，等一下再看結果，免得被當成沒處理的錯誤
    context.spotify?.catch(() => {});
    // 比對歌名要用到簡繁轉換
    await loadChineseConverter();

    if (!prefetching) {
      const early = this.findPrefetched(snapshot);
      if (early?.results.length) {
        // 也用實際播放的歌寫一份快取，下次直接讀
        await this.cache?.put(snapshot, early.results, early.spotifyChecked).catch(() => {});
        if (isCancelled()) return;
        emit({ results: rankLyrics(early.results, snapshot), done: true, fromCache: true, prefetched: true, errors: [], timings: {} });
        return;
      }
    }

    const cached = await this.cache?.get(snapshot).catch(() => null);
    if (isCancelled()) return;
    // 連結 Spotify 前存的快取沒用歌曲 ID 查過 AMLL TTML DB：重找一次
    if (cached && (!context.spotify || cached.spotifyChecked)) {
      emit({ results: cached.results, done: true, fromCache: true, errors: [], timings: {} });
      return;
    }

    const results: Lyrics[] = [];
    const errors: string[] = [];
    const timings: Record<string, number> = {};
    let shown: Lyrics | null = null;
    let graceOver = false;

    const publish = (done: boolean) => {
      const ranked = rankLyrics(results, snapshot);
      const best = ranked[0] ?? null;
      if (!done) {
        if (prefetching || !best || best === shown) return;
        if (!graceOver && !isBestPossible(best)) return;
      }
      shown = best;
      emit({ results: ranked, done, fromCache: false, errors: [...errors], timings: { ...timings } });
    };

    const timer = setTimeout(() => {
      graceOver = true;
      publish(false);
    }, this.graceMs);
    const started = performance.now();

    await Promise.all(
      this.providers.map(async (provider) => {
        try {
          await provider.search(
            snapshot,
            (lyrics) => {
              if (isCancelled()) return;
              results.push(lyrics);
              publish(false);
            },
            context,
          );
        } catch (e) {
          errors.push(`${provider.name}：${e instanceof Error ? e.message : String(e)}`);
        } finally {
          timings[provider.name] = Math.round(performance.now() - started);
        }
      }),
    );
    clearTimeout(timer);

    // 有沒有真的用 Spotify 查過（查詢失敗不算，下次再試）
    const spotifyChecked = context.spotify ? await context.spotify.then(() => true, () => false) : false;
    const ranked = rankLyrics(results, snapshot);
    if (prefetching) this.remember({ snapshot, results: ranked, spotifyChecked });

    // 所有來源都回覆了，就算中途換了歌也值得存起來；有來源失敗時不寫，下次再試（可能只是暫時連不上）。
    // 先寫快取再回報「找完」，馬上切回這首歌時一定讀得到。
    if (errors.length === 0) {
      await this.cache?.put(snapshot, ranked, spotifyChecked).catch((e: unknown) => {
        console.warn('寫入歌詞快取失敗', e);
      });
    }
    if (isCancelled()) return;
    publish(true);
  }
}
