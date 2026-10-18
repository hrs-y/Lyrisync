import { describe, expect, it } from 'vitest';
import {
  getCurrentTrack,
  getQueue,
  isSaved,
  parseTrack,
  setSaved,
  UNAVAILABLE_STATUS,
  type SpotifyBackend,
  type SpotifyMethod,
  type SpotifyResponse,
} from './api';

// 測試用的歌曲資料都是自己編的
const trackItem = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  type: 'track',
  id,
  uri: `spotify:track:${id}`,
  name,
  artists: [{ name: '測試樂團' }, { name: 'Guest' }],
  album: { name: '城市燈火' },
  duration_ms: 200_000,
  external_ids: { isrc: 'twa000000001' },
  is_local: false,
  ...extra,
});

function fakeBackend(handler: (method: SpotifyMethod, path: string, query?: Record<string, string>) => SpotifyResponse) {
  const calls: Array<[SpotifyMethod, string, Record<string, string> | undefined]> = [];
  const backend: SpotifyBackend = {
    status: async () => UNAVAILABLE_STATUS,
    onStatus: () => {},
    login: async () => UNAVAILABLE_STATUS,
    cancelLogin: async () => {},
    logout: async () => UNAVAILABLE_STATUS,
    openDashboard: async () => {},
    open: async () => {},
    call: async (method, path, query) => {
      calls.push([method, path, query]);
      return handler(method, path, query);
    },
  };
  return { backend, calls };
}

describe('parseTrack', () => {
  it('keeps what lyric matching needs, with the ISRC upper-cased', () => {
    expect(parseTrack(trackItem('abc', '夜車'))).toEqual({
      id: 'abc',
      uri: 'spotify:track:abc',
      name: '夜車',
      artists: ['測試樂團', 'Guest'],
      artistIds: ['', ''],
      album: '城市燈火',
      durationMs: 200_000,
      isrc: 'TWA000000001',
    });
  });

  it('skips local files, podcast episodes and junk', () => {
    expect(parseTrack(trackItem('abc', 'x', { is_local: true }))).toBeNull();
    expect(parseTrack(trackItem('abc', 'x', { id: null }))).toBeNull();
    expect(parseTrack({ ...trackItem('abc', 'x'), type: 'episode' })).toBeNull();
    expect(parseTrack(null)).toBeNull();
  });
});

describe('Spotify API calls', () => {
  it('reads the current track, and nothing when idle or during an ad', async () => {
    let response: SpotifyResponse = { status: 200, body: JSON.stringify({ currently_playing_type: 'track', item: trackItem('abc', '夜車') }) };
    const { backend, calls } = fakeBackend(() => response);
    expect((await getCurrentTrack(backend))?.id).toBe('abc');
    expect(calls[0]).toEqual(['GET', 'me/player/currently-playing', undefined]);
    response = { status: 204, body: '' };
    expect(await getCurrentTrack(backend)).toBeNull();
    response = { status: 200, body: JSON.stringify({ currently_playing_type: 'ad', item: null }) };
    expect(await getCurrentTrack(backend)).toBeNull();
  });

  it('reports a 403 as "forbidden", which usually means the account is not on the app user list', async () => {
    const { backend } = fakeBackend(() => ({ status: 403, body: '' }));
    await expect(getCurrentTrack(backend)).rejects.toThrow('forbidden');
  });

  it('keeps album and artist IDs and a medium-sized cover for the queue', () => {
    const track = parseTrack(
      trackItem('abc', '夜車', {
        album: {
          id: 'alb',
          name: '城市燈火',
          images: [
            { url: 'big', width: 640 },
            { url: 'medium', width: 300 },
            { url: 'small', width: 64 },
          ],
        },
        artists: [{ name: '測試樂團', id: 'ar1' }, { name: 'Guest' }],
      }),
    );
    expect(track).toMatchObject({ albumId: 'alb', artistIds: ['ar1', ''], imageUrl: 'medium' });
  });

  it('lists queued tracks, skipping episodes', async () => {
    const { backend } = fakeBackend(() => ({
      status: 200,
      body: JSON.stringify({ queue: [trackItem('n1', '下一首'), { type: 'episode', id: 'e1' }, trackItem('n2', '再下一首')] }),
    }));
    expect((await getQueue(backend)).map((track) => track.id)).toEqual(['n1', 'n2']);
  });

  it('checks and changes Liked Songs with the track URI', async () => {
    const { backend, calls } = fakeBackend((method) => (method === 'GET' ? { status: 200, body: '[true]' } : { status: 200, body: '' }));
    const track = parseTrack(trackItem('abc', '夜車'))!;
    expect(await isSaved(backend, track)).toBe(true);
    await setSaved(backend, track, false);
    await setSaved(backend, track, true);
    expect(calls).toEqual([
      ['GET', 'me/library/contains', { uris: 'spotify:track:abc' }],
      ['DELETE', 'me/library', { uris: 'spotify:track:abc' }],
      ['PUT', 'me/library', { uris: 'spotify:track:abc' }],
    ]);
  });
});
