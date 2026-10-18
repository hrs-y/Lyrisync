import { buildUrl, getJson, type HttpGet } from '../../net/http';
import type { PlayerSnapshot } from '../../player/types';
import { removeCredits } from '../credits';
import { parseLrc } from '../lrc';
import { pickBest, searchTitles } from '../match';
import type { Lyrics } from '../model';
import type { LyricsProvider } from '../service';

const API = 'https://lrclib.net/api';

interface LrclibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  /** 秒 */
  duration?: number | null;
  instrumental: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/**
 * LRCLIB：免費的社群逐行歌詞。精確查詢（需要專輯與長度）和搜尋同時送出；
 * 都沒有同步歌詞時，再用去掉版本資訊的歌名搜尋。偏好順序：同步歌詞 > 純音樂標記 > 純文字。
 */
export function createLrclibProvider(http: HttpGet): LyricsProvider {
  return {
    name: 'lrclib',
    async search(snapshot, found) {
      const [title, ...otherTitles] = searchTitles(snapshot.title);
      const requests = [searchTracks(http, title, snapshot.artist)];
      if (snapshot.album && snapshot.durationMs > 0) requests.push(getExact(http, snapshot));

      const settled = await Promise.allSettled(requests);
      let tracks = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
      const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason as unknown] : []));
      let best = pickTrack(tracks, snapshot);

      for (const other of otherTitles) {
        if (best?.syncedLyrics) break;
        tracks = tracks.concat(await searchTracks(http, other, snapshot.artist));
        best = pickTrack(tracks, snapshot);
      }

      if (best) found(toLyrics(best, snapshot));
      else if (failures.length) throw failures[0];
    },
  };
}

async function searchTracks(http: HttpGet, trackName: string, artistName: string): Promise<LrclibTrack[]> {
  const params: Record<string, string> = { track_name: trackName };
  if (artistName) params.artist_name = artistName;
  return (await getJson<LrclibTrack[]>(http, buildUrl(`${API}/search`, params))) ?? [];
}

/** LRCLIB 的精確查詢長度要在 ±2 秒內；資料庫沒有時還會去外部找，所以比較慢。 */
async function getExact(http: HttpGet, snapshot: PlayerSnapshot): Promise<LrclibTrack[]> {
  const track = await getJson<LrclibTrack>(
    http,
    buildUrl(`${API}/get`, {
      track_name: snapshot.title,
      artist_name: snapshot.artist,
      album_name: snapshot.album,
      duration: Math.round(snapshot.durationMs / 1000),
    }),
  );
  return track ? [track] : [];
}

function pickTrack(tracks: readonly LrclibTrack[], snapshot: PlayerSnapshot): LrclibTrack | null {
  const candidates = tracks.map((track) => ({
    track,
    title: track.trackName,
    artists: [track.artistName],
    durationMs: track.duration ? track.duration * 1000 : undefined,
  }));
  const pick = (filter: (t: LrclibTrack) => boolean) => pickBest(candidates.filter((c) => filter(c.track)), snapshot);
  return (pick((t) => Boolean(t.syncedLyrics)) ?? pick((t) => t.instrumental) ?? pick((t) => Boolean(t.plainLyrics)))?.track ?? null;
}

function toLyrics(track: LrclibTrack, snapshot: PlayerSnapshot): Lyrics {
  const base = {
    source: 'lrclib' as const,
    sourceId: String(track.id),
    matched: {
      title: track.trackName,
      artist: track.artistName,
      durationMs: track.duration ? Math.round(track.duration * 1000) : undefined,
    },
  };
  if (track.instrumental) return { ...base, synced: false, instrumental: true, lines: [] };
  const parsed = parseLrc(track.syncedLyrics || track.plainLyrics || '', snapshot.durationMs);
  return { ...base, synced: parsed.synced, lines: removeCredits(parsed.lines, snapshot.title, snapshot.artist) };
}
