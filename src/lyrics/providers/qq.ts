import { buildUrl, getJson, type HttpGet } from '../../net/http';
import type { PlayerSnapshot } from '../../player/types';
import { attachByTime, attachRomanizationLines } from '../attach';
import { isInstrumentalNotice, removeCredits } from '../credits';
import { parseLrc } from '../lrc';
import { pickBest, searchTitles, splitArtists, WORD_MAX_DURATION_DIFF_MS } from '../match';
import type { LyricLine, Lyrics } from '../model';
import { decryptQrc, extractQrcContent, isQrcContent, parseQrc } from '../qrc';
import type { LyricsProvider } from '../service';

const SEARCH_API = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const MUSICU_API = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
/** QQ 音樂的介面要帶 Referer 才會正常回應 */
const HEADERS = { Referer: 'https://y.qq.com/' };
/** 和 QQ 音樂 PC 版相同的用戶端參數 */
const CLIENT = { ct: 19, cv: 1859 };

interface QqSinger {
  name: string;
  title?: string;
}

interface QqSong {
  id: number;
  name: string;
  title?: string;
  singer?: QqSinger[];
  /** 秒 */
  interval: number;
}

interface QqSearchResponse {
  code: number;
  data?: { song?: { list?: QqSong[] } };
}

export interface QqLyricPayload {
  /** 都是加密過的十六進位字串；沒有時是空字串 */
  lyric?: string;
  trans?: string;
  roma?: string;
}

interface QqLyricResponse {
  code: number;
  req?: { code: number; data?: QqLyricPayload };
}

/** QQ 音樂：逐字歌詞（QRC）最齊全，周杰倫等騰訊獨家的歌也有；附中文翻譯，日文歌常有逐字對時的羅馬字。 */
export function createQqProvider(http: HttpGet): LyricsProvider {
  return {
    name: 'qq',
    async search(snapshot, found) {
      const song = await findSong(http, snapshot);
      if (!song) return;
      const request = {
        comm: { ...CLIENT, uin: '0' },
        req: {
          module: 'music.musichallSong.PlayLyricInfo',
          method: 'GetPlayLyricInfo',
          param: { ...CLIENT, songID: song.id, crypt: 1, qrc: 1, qrc_t: 0, lrc_t: 0, trans: 1, trans_t: 0, roma: 1, roma_t: 0, type: 0 },
        },
      };
      const data = await getJson<QqLyricResponse>(http, buildUrl(MUSICU_API, { data: JSON.stringify(request) }), {
        headers: HEADERS,
      });
      const payload = data?.req?.data;
      if (!payload?.lyric) return;
      const lyrics = await qqToLyrics(payload, song, snapshot);
      if (lyrics) found(lyrics);
    },
  };
}

async function findSong(http: HttpGet, snapshot: PlayerSnapshot): Promise<QqSong | null> {
  const [firstArtist = ''] = splitArtists(snapshot.artist);
  const queries = [
    `${snapshot.title} ${firstArtist}`,
    ...searchTitles(snapshot.title)
      .slice(1)
      .map((title) => `${title} ${firstArtist}`),
  ];
  for (const query of [...new Set(queries.map((q) => q.trim()))]) {
    const data = await getJson<QqSearchResponse>(
      http,
      buildUrl(SEARCH_API, { w: query, format: 'json', p: 1, n: 10, new_json: 1, cr: 1 }),
      { headers: HEADERS },
    );
    const best = pickBest(
      (data?.data?.song?.list ?? []).map((song) => ({
        song,
        title: song.title || song.name,
        artists: (song.singer ?? []).flatMap((s) => [s.name, ...(s.title && s.title !== s.name ? [s.title] : [])]),
        durationMs: song.interval * 1000,
      })),
      snapshot,
      { maxDurationDiffMs: WORD_MAX_DURATION_DIFF_MS },
    );
    if (best) return best.song;
  }
  return null;
}

/** 解開加密的歌詞；解不開或沒有內容時回傳空字串。逐字歌詞會從 XML 裡取出。 */
async function decode(hex: string | undefined): Promise<string> {
  if (!hex) return '';
  try {
    return extractQrcContent(await decryptQrc(hex));
  } catch {
    return '';
  }
}

export async function qqToLyrics(payload: QqLyricPayload, song: QqSong, snapshot: PlayerSnapshot): Promise<Lyrics | null> {
  const base = {
    source: 'qq' as const,
    sourceId: String(song.id),
    matched: {
      title: song.title || song.name,
      artist: (song.singer ?? []).map((s) => s.name).join(' / '),
      durationMs: song.interval * 1000,
    },
  };
  const content = await decode(payload.lyric);
  if (!content) return null;
  if (isInstrumentalNotice(content)) return { ...base, synced: false, instrumental: true, lines: [] };

  let lines: LyricLine[];
  let synced = true;
  if (isQrcContent(content)) {
    lines = parseQrc(content);
  } else {
    const parsed = parseLrc(content, snapshot.durationMs);
    lines = parsed.lines;
    synced = parsed.synced;
  }
  lines = removeCredits(lines, snapshot.title, snapshot.artist);
  if (!lines.length) return null;

  if (synced) {
    const [translation, romanization] = await Promise.all([decode(payload.trans), decode(payload.roma)]);
    attachByTime(lines, translation, 'translation');
    if (romanization && isQrcContent(romanization)) attachRomanizationLines(lines, parseQrc(romanization));
    else attachByTime(lines, romanization, 'romanization');
  }
  return { ...base, synced, lines };
}
