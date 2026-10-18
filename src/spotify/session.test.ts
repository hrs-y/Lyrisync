import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadChineseConverter } from '../lyrics/chinese';
import type { PlayerSnapshot } from '../player/types';
import { UNAVAILABLE_STATUS, type SpotifyBackend, type SpotifyResponse, type SpotifyStatus } from './api';
import { sameTrack, SpotifySession, snapshotFromTrack, type LikeState } from './session';

// 測試用的歌曲資料都是自己編的
const snapshot: PlayerSnapshot = {
  appId: 'Spotify.exe',
  title: '夜車',
  artist: '測試樂團, Guest',
  album: '城市燈火',
  status: 'playing',
  positionMs: 0,
  durationMs: 200_400,
  lastUpdatedMs: 0,
};

const item = (id: string, name: string, durationMs = 200_000) => ({
  type: 'track',
  id,
  uri: `spotify:track:${id}`,
  name,
  artists: [{ name: '測試樂團' }],
  album: { name: '城市燈火' },
  duration_ms: durationMs,
  external_ids: { isrc: 'TWA000000001' },
});

const playing = (id: string, name: string) => ({
  status: 200,
  body: JSON.stringify({ currently_playing_type: 'track', item: item(id, name) }),
});

const CONNECTED: SpotifyStatus = { ...UNAVAILABLE_STATUS, state: 'connected', clientId: 'x', userName: '測試' };

function setup(handler: (method: string, path: string) => SpotifyResponse | Promise<SpotifyResponse>) {
  const likes: LikeState[] = [];
  const logs: string[] = [];
  let statusListener: (status: SpotifyStatus) => void = () => {};
  const backend: SpotifyBackend = {
    status: async () => CONNECTED,
    onStatus: (listener) => {
      statusListener = listener;
    },
    login: async () => CONNECTED,
    cancelLogin: async () => {},
    logout: async () => UNAVAILABLE_STATUS,
    openDashboard: async () => {},
    open: async () => {},
    call: async (method, path) => handler(method, path),
  };
  const session = new SpotifySession({
    backend,
    onStatus: () => {},
    onLike: (state) => likes.push(state),
    log: (message) => logs.push(message),
    sleep: async () => {},
  });
  return { session, likes, logs, emitStatus: (status: SpotifyStatus) => statusListener(status) };
}

beforeAll(async () => {
  await loadChineseConverter();
});

describe('sameTrack', () => {
  const track = { id: 'a', uri: 'spotify:track:a', name: '夜車', artists: ['測試樂團'], album: '城市燈火', durationMs: 200_000 };
  it('matches on the title and a close duration, ignoring how artists are written', () => {
    expect(sameTrack(snapshot, track)).toBe(true);
    expect(sameTrack({ ...snapshot, title: '晨車' }, track)).toBe(false);
    expect(sameTrack({ ...snapshot, durationMs: 230_000 }, track)).toBe(false);
  });

  it('turns a queued track into a search snapshot', () => {
    expect(snapshotFromTrack({ ...track, artists: ['A', 'B'] })).toMatchObject({ title: '夜車', artist: 'A, B', album: '城市燈火', durationMs: 200_000 });
  });
});

describe('SpotifySession', () => {
  it('does nothing until connected', async () => {
    const call = vi.fn();
    const { session } = setup(call);
    expect(session.trackFor(snapshot)).toBeUndefined();
    expect(call).not.toHaveBeenCalled();
  });

  it('waits for the Web API to catch up with a track change, then shows the like state', async () => {
    let calls = 0;
    const { session, likes } = setup((_method, path) => {
      if (path === 'me/player/currently-playing') return ++calls < 3 ? playing('old', '上一首') : playing('abc', '夜車');
      if (path === 'me/library/contains') return { status: 200, body: '[true]' };
      return { status: 404, body: '' };
    });
    await session.init();
    const track = await session.trackFor(snapshot);
    expect(track?.id).toBe('abc');
    expect(calls).toBe(3);
    await vi.waitFor(() => expect(likes.at(-1)).toEqual({ kind: 'ready', saved: true, busy: false }));
    expect(session.describe()).toContain('abc');
  });

  it('gives up with null when the API keeps reporting another song', async () => {
    const { session } = setup(() => playing('other', '別首歌'));
    await session.init();
    expect(await session.trackFor(snapshot)).toBeNull();
  });

  it('rejects when the API fails, so the lyrics cache does not record a Spotify check', async () => {
    const { session } = setup(() => ({ status: 403, body: '' }));
    await session.init();
    await expect(session.trackFor(snapshot)).rejects.toThrow();
  });

  it('likes optimistically and rolls back when Spotify refuses', async () => {
    let saveStatus = 200;
    const { session, likes } = setup((_method, path) => {
      if (path === 'me/player/currently-playing') return playing('abc', '夜車');
      if (path === 'me/library/contains') return { status: 200, body: '[false]' };
      return { status: saveStatus, body: '' };
    });
    await session.init();
    await session.trackFor(snapshot);
    await vi.waitFor(() => expect(likes.at(-1)).toEqual({ kind: 'ready', saved: false, busy: false }));

    await session.toggleLike();
    expect(likes.slice(-2)).toEqual([
      { kind: 'ready', saved: true, busy: true },
      { kind: 'ready', saved: true, busy: false },
    ]);

    saveStatus = 500;
    await session.toggleLike();
    expect(likes.slice(-2)).toEqual([
      { kind: 'ready', saved: false, busy: true },
      { kind: 'ready', saved: true, busy: false },
    ]);
  });

  it('lists the next two queued songs, skipping the current one and repeats', async () => {
    const { session } = setup((_method, path) => {
      if (path === 'me/player/currently-playing') return playing('abc', '夜車');
      if (path === 'me/player/queue') {
        return {
          status: 200,
          body: JSON.stringify({ queue: [item('abc', '夜車'), item('n1', '一'), item('n1', '一'), item('n2', '二'), item('n3', '三')] }),
        };
      }
      return { status: 200, body: '[false]' };
    });
    await session.init();
    await session.trackFor(snapshot);
    expect((await session.upcoming()).map((track) => track.id)).toEqual(['n1', 'n2']);
  });

  it('hides the like button when the connection is lost', async () => {
    const { session, likes, emitStatus } = setup((_method, path) =>
      path === 'me/player/currently-playing' ? playing('abc', '夜車') : { status: 200, body: '[true]' },
    );
    await session.init();
    await session.trackFor(snapshot);
    await vi.waitFor(() => expect(likes.at(-1)?.kind).toBe('ready'));
    emitStatus({ ...CONNECTED, state: 'expired' });
    expect(likes.at(-1)).toEqual({ kind: 'hidden' });
    expect(session.track).toBeNull();
  });
});
