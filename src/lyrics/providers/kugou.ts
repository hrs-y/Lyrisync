import { buildUrl, getJson, type HttpGet } from '../../net/http';
import type { PlayerSnapshot } from '../../player/types';
import { toSimplified } from '../chinese';
import { removeCredits } from '../credits';
import { base64ToBytes, decodeKrc, parseKrc } from '../krc';
import { parseLrc } from '../lrc';
import { pickBest, searchTitles, splitArtists, WORD_MAX_DURATION_DIFF_MS } from '../match';
import type { LyricLine } from '../model';
import type { LyricsProvider } from '../service';

const API = 'https://lyrics.kugou.com';

interface KugouCandidate {
  id: string;
  accesskey: string;
  song: string;
  singer: string;
  duration: number;
}

interface KugouSearchResponse {
  status: number;
  candidates?: KugouCandidate[];
}

interface KugouDownloadResponse {
  status: number;
  content?: string;
  fmt?: string;
}

/** 酷狗：幾乎都是逐字歌詞（KRC），西洋歌和周杰倫的歌也有；附中文翻譯。 */
export function createKugouProvider(http: HttpGet): LyricsProvider {
  return {
    name: 'kugou',
    async search(snapshot, found) {
      const candidate = await findCandidate(http, snapshot);
      if (!candidate) return;
      const data = await getJson<KugouDownloadResponse>(
        http,
        buildUrl(`${API}/download`, {
          ver: 1,
          client: 'pc',
          id: candidate.id,
          accesskey: candidate.accesskey,
          fmt: 'krc',
          charset: 'utf8',
        }),
      );
      if (!data?.content) return;

      let lines: LyricLine[];
      if (data.fmt === 'lrc') {
        const text = new TextDecoder().decode(base64ToBytes(data.content));
        lines = parseLrc(text, snapshot.durationMs).lines;
      } else {
        lines = parseKrc(await decodeKrc(data.content)).lines;
      }
      lines = removeCredits(lines, snapshot.title, snapshot.artist);
      if (!lines.length) return;
      found({
        synced: true,
        lines,
        source: 'kugou',
        sourceId: candidate.id,
        matched: { title: candidate.song, artist: candidate.singer, durationMs: candidate.duration },
      });
    },
  };
}

async function findCandidate(http: HttpGet, snapshot: PlayerSnapshot): Promise<KugouCandidate | null> {
  const [firstArtist = ''] = splitArtists(snapshot.artist);
  for (const title of searchTitles(snapshot.title)) {
    // 酷狗只認簡體關鍵字（繁體的「徐佳瑩」搜不到）
    const keyword = toSimplified(firstArtist ? `${firstArtist} - ${title}` : title);
    const data = await getJson<KugouSearchResponse>(
      http,
      buildUrl(`${API}/search`, { ver: 1, man: 'yes', client: 'pc', keyword, duration: snapshot.durationMs, hash: '' }),
    );
    const best = pickBest(
      (data?.candidates ?? []).map((c) => ({ ...c, title: c.song, artists: [c.singer], durationMs: c.duration })),
      snapshot,
      { maxDurationDiffMs: WORD_MAX_DURATION_DIFF_MS },
    );
    if (best) return best;
  }
  return null;
}
