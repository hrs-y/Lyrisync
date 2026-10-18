import { buildUrl, getJson, type HttpGet } from '../../net/http';
import { trackKey, type PlayerSnapshot } from '../../player/types';
import { attachByTime } from '../attach';
import { removeCredits } from '../credits';
import { parseLrc } from '../lrc';
import { pickBest, searchTitles, splitArtists, WORD_MAX_DURATION_DIFF_MS } from '../match';
import type { LyricLine, Lyrics } from '../model';
import type { LyricsProvider } from '../service';
import type { AmllSpotifyIndex } from './amllIndex';
import { parseTtml } from '../ttml';
import { parseYrc } from '../yrc';

const API = 'https://music.163.com/api';

/** AMLL TTML DB 依哪個平台的歌曲 ID 分資料夾：網易雲、Spotify */
type TtmlFolder = 'ncm-lyrics' | 'spotify-lyrics';

/** AMLL TTML DB 的本站和鏡像；GitHub 在部分網路很慢，所以先和一個鏡像同時問 */
const TTML_SOURCES: Array<(folder: TtmlFolder, id: string) => string> = [
  (folder, id) => `https://amll.mirror.dimeta.top/api/db/${folder}/${id}.ttml`,
  (folder, id) => `https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/${folder}/${id}.ttml`,
  (folder, id) => `https://amlldb.bikonoo.com/${folder}/${id}.ttml`,
  (folder, id) => `https://amll-ttml-db.gbclstudio.cn/${folder}/${id}.ttml`,
];
const TTML_TIMEOUT_MS = 5000;
/** 同一批次問幾個來源 */
const TTML_BATCH = 2;
/** 記住最近幾首歌的網易雲搜尋結果 */
const LOOKUP_CACHE_SIZE = 20;

interface NeteaseArtist {
  name: string;
  alias?: string[];
  trans?: string | null;
}

interface NeteaseSong {
  id: number;
  name: string;
  artists: NeteaseArtist[];
  duration: number;
}

interface NeteaseSearchResponse {
  code: number;
  result?: { songs?: NeteaseSong[] };
}

export interface NeteaseLyricResponse {
  code: number;
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  romalrc?: { lyric?: string };
  yrc?: { lyric?: string };
  nolyric?: boolean;
  pureMusic?: boolean;
}

export interface NeteaseMatch {
  id: number;
  title: string;
  artist: string;
  durationMs: number;
}

/** 網易雲的歌曲搜尋；同一首歌只查一次，給網易雲和 AMLL TTML DB 兩個來源共用。 */
export class NeteaseLookup {
  private readonly pending = new Map<string, Promise<NeteaseMatch | null>>();

  constructor(private readonly http: HttpGet) {}

  find(snapshot: PlayerSnapshot): Promise<NeteaseMatch | null> {
    const key = trackKey(snapshot);
    let lookup = this.pending.get(key);
    if (!lookup) {
      lookup = this.search(snapshot);
      this.pending.set(key, lookup);
      // 失敗的不留著，下次再查
      lookup.catch(() => this.pending.delete(key));
      if (this.pending.size > LOOKUP_CACHE_SIZE) this.pending.delete(this.pending.keys().next().value!);
    }
    return lookup;
  }

  private async search(snapshot: PlayerSnapshot): Promise<NeteaseMatch | null> {
    // 網易雲的搜尋分得出繁簡，Spotify 的原始歌名通常就找得到；找不到再用去掉版本資訊的歌名
    const [firstArtist = ''] = splitArtists(snapshot.artist);
    const queries = [
      `${snapshot.title} ${snapshot.artist}`,
      ...searchTitles(snapshot.title)
        .slice(1)
        .map((title) => `${title} ${firstArtist}`),
    ];
    for (const query of [...new Set(queries.map((q) => q.trim()))]) {
      const data = await getJson<NeteaseSearchResponse>(
        this.http,
        buildUrl(`${API}/search/get/web`, { s: query, type: 1, limit: 10, offset: 0 }),
      );
      const best = pickBest(
        (data?.result?.songs ?? []).map((song) => ({
          song,
          title: song.name,
          artists: song.artists.flatMap((a) => [a.name, ...(a.alias ?? []), ...(a.trans ? [a.trans] : [])]),
          durationMs: song.duration,
        })),
        snapshot,
      );
      if (best) {
        return {
          id: best.song.id,
          title: best.song.name,
          artist: best.song.artists.map((a) => a.name).join(' / '),
          durationMs: best.song.duration,
        };
      }
    }
    return null;
  }
}

/** 網易雲：有逐字歌詞（YRC）就用逐字，否則用 LRC；附上中文翻譯與羅馬拼音。 */
export function createNeteaseProvider(http: HttpGet, lookup: NeteaseLookup): LyricsProvider {
  return {
    name: 'netease',
    async search(snapshot, found) {
      const match = await lookup.find(snapshot);
      if (!match) return;
      const data = await getJson<NeteaseLyricResponse>(
        http,
        buildUrl(`${API}/song/lyric/v1`, { id: match.id, lv: -1, kv: -1, tv: -1, rv: -1, yv: -1, ytv: -1, yrv: -1 }),
      );
      const lyrics = data && neteaseToLyrics(data, match, snapshot);
      if (lyrics) found(lyrics);
    },
  };
}

export function neteaseToLyrics(data: NeteaseLyricResponse, match: NeteaseMatch, snapshot: PlayerSnapshot): Lyrics | null {
  const base = {
    source: 'netease' as const,
    sourceId: String(match.id),
    matched: { title: match.title, artist: match.artist, durationMs: match.durationMs },
  };
  if (data.pureMusic || data.nolyric) return { ...base, synced: false, instrumental: true, lines: [] };

  // 長度差太多可能是不同版本，逐字時間軸會整段偏掉，退回逐行
  const closeEnough = !snapshot.durationMs || Math.abs(match.durationMs - snapshot.durationMs) <= WORD_MAX_DURATION_DIFF_MS;
  let lines: LyricLine[] = [];
  let synced = true;
  if (data.yrc?.lyric && closeEnough) lines = parseYrc(data.yrc.lyric);
  if (!lines.length && data.lrc?.lyric) {
    const parsed = parseLrc(data.lrc.lyric, snapshot.durationMs);
    lines = parsed.lines;
    synced = parsed.synced;
  }
  lines = removeCredits(lines, snapshot.title, snapshot.artist);
  if (!lines.length) return null;
  if (synced) {
    attachByTime(lines, data.tlyric?.lyric, 'translation');
    attachByTime(lines, data.romalrc?.lyric, 'romanization');
  }
  return { ...base, synced, lines };
}

/**
 * AMLL TTML DB：社群手工對時的逐字歌詞。兩條路同時查：
 * - 連結 Spotify 時，用 Spotify 的歌曲 ID 直接查（精準，不必比對歌名）；這個 ID 沒收錄時再用 ISRC 查索引。
 * - 用網易雲搜尋到的歌曲 ID 查。
 * 兩條路找到同一份歌詞時只回報一次。
 */
export function createTtmlDbProvider(http: HttpGet, lookup: NeteaseLookup, spotifyIndex?: AmllSpotifyIndex): LyricsProvider {
  return {
    name: 'ttml-db',
    async search(snapshot, found, context) {
      const reported: Lyrics[] = [];
      const report = (lyrics: Lyrics | null) => {
        if (!lyrics || reported.some((other) => sameLines(other.lines, lyrics.lines))) return;
        reported.push(lyrics);
        found(lyrics);
      };

      const bySpotify = async () => {
        const track = await context?.spotify?.catch(() => null);
        if (!track) return;
        let id: string | null = track.id;
        let xml = await fetchTtml(http, 'spotify-lyrics', id);
        if (!xml && track.isrc && spotifyIndex) {
          id = await spotifyIndex.idForIsrc(track.isrc);
          if (id && id !== track.id) xml = await fetchTtml(http, 'spotify-lyrics', id);
        }
        const lines = xml ? parseTtml(xml) : [];
        if (!lines.length) return;
        report({
          synced: true,
          lines,
          source: 'ttml-db',
          sourceId: `spotify:${id}`,
          matched: { title: track.name, artist: track.artists.join(', '), durationMs: track.durationMs },
        });
      };

      const byNetease = async () => {
        const match = await lookup.find(snapshot);
        if (!match) return;
        const xml = await fetchTtml(http, 'ncm-lyrics', String(match.id));
        const lines = xml ? parseTtml(xml) : [];
        if (!lines.length) return;
        report({
          synced: true,
          lines,
          source: 'ttml-db',
          sourceId: String(match.id),
          matched: { title: match.title, artist: match.artist, durationMs: match.durationMs },
        });
      };

      // 一條路連不上不影響另一條；都查完才回報錯誤（有錯誤就不寫快取，下次再試）
      const outcomes = await Promise.allSettled([bySpotify(), byNetease()]);
      const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      if (failure) throw failure.reason;
    },
  };
}

/** 兩份歌詞的每一行文字和開始時間都一樣（同一個 TTML 檔從不同的 ID 查到） */
function sameLines(a: readonly LyricLine[], b: readonly LyricLine[]): boolean {
  return a.length === b.length && a.every((line, i) => line.text === b[i].text && line.startMs === b[i].startMs);
}

/** 一批問兩個來源：先拿到檔案就用，任何一個明確回 404 就當成資料庫沒有；兩個都連不上才問下一批。 */
async function fetchTtml(http: HttpGet, folder: TtmlFolder, id: string): Promise<string | null> {
  const errors: string[] = [];
  for (let i = 0; i < TTML_SOURCES.length; i += TTML_BATCH) {
    const batch = TTML_SOURCES.slice(i, i + TTML_BATCH);
    // string：找到；null：資料庫沒有；undefined：這一批都連不上
    const outcome = await new Promise<string | null | undefined>((resolve) => {
      let remaining = batch.length;
      const failed = (reason: string) => {
        errors.push(reason);
        if (--remaining === 0) resolve(undefined);
      };
      for (const source of batch) {
        const url = source(folder, id);
        http(url, { timeoutMs: TTML_TIMEOUT_MS }).then(
          (response) => {
            if (response.status === 200 && response.body.includes('<tt')) resolve(response.body);
            else if (response.status === 404) resolve(null);
            else failed(`${new URL(url).host} HTTP ${response.status}`);
          },
          (e: unknown) => failed(`${new URL(url).host} ${String(e)}`),
        );
      }
    });
    if (outcome !== undefined) return outcome;
  }
  throw new Error(`AMLL TTML DB 都連不上（${errors.join('；')}）`);
}
