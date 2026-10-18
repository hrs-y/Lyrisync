import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerSnapshot } from '../player/types';
import { LyricsCache, memoryCacheStorage } from './cache';
import { loadChineseConverter } from './chinese';
import type { Lyrics, LyricsSource } from './model';
import { LyricsService, type LyricsProvider, type SearchContext, type SearchUpdate } from './service';
import type { SpotifyTrack } from '../spotify/api';

const snapshot: PlayerSnapshot = {
  appId: 'Spotify.exe',
  title: 'Night Drive',
  artist: 'Example Band',
  album: 'Somewhere',
  status: 'playing',
  positionMs: 0,
  durationMs: 200_000,
  lastUpdatedMs: 0,
};

function lyrics(source: LyricsSource, word: boolean): Lyrics {
  const words = word ? { words: [{ text: '字', startMs: 0, endMs: 100 }] } : {};
  return { source, synced: true, lines: [{ startMs: 0, endMs: 100, text: '字', ...words }] };
}

/** 過 delayMs 後回報結果（或丟出錯誤）的假來源 */
function provider(name: string, delayMs: number, result: Lyrics | Error | null) {
  const fake = {
    name,
    calls: 0,
    async search(_snapshot: PlayerSnapshot, found: (lyrics: Lyrics) => void) {
      fake.calls++;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (result instanceof Error) throw result;
      if (result) found(result);
    },
  };
  return fake satisfies LyricsProvider;
}

const summary = (updates: SearchUpdate[]) =>
  updates.map((u) => `${u.results[0]?.source ?? 'none'}${u.done ? ' done' : ''}`);

function searchToEnd(service: LyricsService, context?: SearchContext, target: PlayerSnapshot = snapshot): Promise<SearchUpdate> {
  return new Promise((resolve) => {
    service.search(
      target,
      (update) => {
        if (update.done) resolve(update);
      },
      context,
    );
  });
}

const spotifyTrack: SpotifyTrack = {
  id: 'abc',
  uri: 'spotify:track:abc',
  name: 'Night Drive',
  artists: ['Example Band', 'Guest'],
  album: 'Somewhere',
  durationMs: 200_300,
};

beforeAll(async () => {
  await loadChineseConverter();
});

describe('LyricsService timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the grace period before showing a lower-ranked result, then upgrades', async () => {
    const service = new LyricsService(
      [provider('lrclib', 100, lyrics('lrclib', false)), provider('kugou', 2000, lyrics('kugou', true))],
      null,
      1200,
    );
    const updates: SearchUpdate[] = [];
    service.search(snapshot, (u) => updates.push(u));
    await vi.advanceTimersByTimeAsync(1000);
    expect(updates).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(summary(updates)).toEqual(['lrclib']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(summary(updates)).toEqual(['lrclib', 'kugou', 'kugou done']);
    expect(updates[2].results.map((l) => l.source)).toEqual(['kugou', 'lrclib']);
  });

  it('shows AMLL word timing as soon as it arrives', async () => {
    const service = new LyricsService(
      [provider('ttml-db', 300, lyrics('ttml-db', true)), provider('lrclib', 3000, lyrics('lrclib', false))],
      null,
      1200,
    );
    const updates: SearchUpdate[] = [];
    service.search(snapshot, (u) => updates.push(u));
    await vi.advanceTimersByTimeAsync(300);
    expect(summary(updates)).toEqual(['ttml-db']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(summary(updates)).toEqual(['ttml-db', 'ttml-db done']);
  });

  it('reports the end even when nothing was found', async () => {
    const service = new LyricsService([provider('lrclib', 100, null)], null, 1200);
    const updates: SearchUpdate[] = [];
    service.search(snapshot, (u) => updates.push(u));
    await vi.advanceTimersByTimeAsync(2000);
    expect(summary(updates)).toEqual(['none done']);
  });

  it('stops reporting once cancelled', async () => {
    const service = new LyricsService([provider('lrclib', 100, lyrics('lrclib', false))], null, 1200);
    const updates: SearchUpdate[] = [];
    const cancel = service.search(snapshot, (u) => updates.push(u));
    cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(updates).toEqual([]);
  });
});

describe('LyricsService cache', () => {
  it('serves the next search from the cache', async () => {
    const source = provider('lrclib', 0, lyrics('lrclib', false));
    const service = new LyricsService([source], new LyricsCache(memoryCacheStorage()), 0);
    await searchToEnd(service);
    const second = await searchToEnd(service);
    expect(second.fromCache).toBe(true);
    expect(second.results[0].source).toBe('lrclib');
    expect(source.calls).toBe(1);
  });

  it('does not cache when a source failed', async () => {
    const failing = provider('netease', 0, new Error('連不上'));
    const service = new LyricsService(
      [failing, provider('lrclib', 0, lyrics('lrclib', false))],
      new LyricsCache(memoryCacheStorage()),
      0,
    );
    const first = await searchToEnd(service);
    expect(first.errors).toEqual(['netease：連不上']);
    expect(first.results[0].source).toBe('lrclib');
    const second = await searchToEnd(service);
    expect(second.fromCache).toBe(false);
    expect(failing.calls).toBe(2);
  });

  it('searches the sources again after forget', async () => {
    const source = provider('lrclib', 0, lyrics('lrclib', false));
    const service = new LyricsService([source], new LyricsCache(memoryCacheStorage()), 0);
    await searchToEnd(service);
    await service.forget(snapshot);
    const second = await searchToEnd(service);
    expect(second.fromCache).toBe(false);
    expect(source.calls).toBe(2);
  });

  it('remembers "not found" too, but only for a few days', async () => {
    let now = 0;
    const source = provider('lrclib', 0, null);
    const service = new LyricsService([source], new LyricsCache(memoryCacheStorage(), () => now), 0);
    await searchToEnd(service);
    expect((await searchToEnd(service)).fromCache).toBe(true);
    now += 4 * 24 * 3600_000;
    expect((await searchToEnd(service)).fromCache).toBe(false);
    expect(source.calls).toBe(2);
  });
});

describe('LyricsService with Spotify', () => {
  it('passes the Spotify track to the sources', async () => {
    let seen: SpotifyTrack | null | undefined;
    const source: LyricsProvider = {
      name: 'ttml-db',
      async search(_snapshot, found, context) {
        seen = await context?.spotify;
        found(lyrics('ttml-db', true));
      },
    };
    const service = new LyricsService([source], null, 0);
    await searchToEnd(service, { spotify: Promise.resolve(spotifyTrack) });
    expect(seen?.id).toBe('abc');
  });

  it('searches again once after connecting Spotify, then uses the cache', async () => {
    const source = provider('lrclib', 0, lyrics('lrclib', false));
    const service = new LyricsService([source], new LyricsCache(memoryCacheStorage()), 0);
    await searchToEnd(service);
    // 連結前的快取沒用 Spotify 查過：重找
    expect((await searchToEnd(service, { spotify: Promise.resolve(spotifyTrack) })).fromCache).toBe(false);
    expect((await searchToEnd(service, { spotify: Promise.resolve(spotifyTrack) })).fromCache).toBe(true);
    // 沒連結時照樣用快取
    expect((await searchToEnd(service)).fromCache).toBe(true);
    expect(source.calls).toBe(2);
  });

  it('does not mark the cache as checked when the Spotify lookup failed', async () => {
    const source = provider('lrclib', 0, lyrics('lrclib', false));
    const service = new LyricsService([source], new LyricsCache(memoryCacheStorage()), 0);
    await searchToEnd(service, { spotify: Promise.reject(new Error('429')) });
    expect((await searchToEnd(service, { spotify: Promise.resolve(spotifyTrack) })).fromCache).toBe(false);
  });

  it('uses lyrics prefetched from the queue even if SMTC writes the artists differently', async () => {
    const source = provider('qq', 0, lyrics('qq', true));
    const service = new LyricsService([source], new LyricsCache(memoryCacheStorage()), 0);
    const queued: PlayerSnapshot = { ...snapshot, artist: 'Example Band, Guest', durationMs: 200_300 };
    expect(await service.prefetch(queued, { spotify: Promise.resolve(spotifyTrack) })).toBe(1);
    // 已經找好了：不再找
    expect(await service.prefetch(queued)).toBe(-1);

    const playing: PlayerSnapshot = { ...snapshot, artist: 'Example Band & Guest' };
    const update = await searchToEnd(service, undefined, playing);
    expect(update).toMatchObject({ prefetched: true, fromCache: true });
    expect(update.results[0].source).toBe('qq');
    expect(source.calls).toBe(1);
    // 也寫了一份實際播放那首的快取
    expect((await searchToEnd(service, undefined, playing)).fromCache).toBe(true);
  });

  it('never shows partial results while prefetching', async () => {
    const service = new LyricsService([provider('qq', 0, lyrics('qq', true))], null, 0);
    const updates: SearchUpdate[] = [];
    const cancel = service.search(snapshot, (u) => updates.push(u));
    cancel();
    await service.prefetch({ ...snapshot, title: 'Other Song' });
    expect(updates).toEqual([]);
  });
});
