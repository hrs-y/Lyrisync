// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import type { HttpGet } from '../../net/http';
import type { PlayerSnapshot } from '../../player/types';
import { loadChineseConverter } from '../chinese';
import type { Lyrics } from '../model';
import type { SpotifyTrack } from '../../spotify/api';
import { AmllSpotifyIndex, parseSpotifyIndex } from './amllIndex';
import { createTtmlDbProvider, NeteaseLookup } from './netease';

const snapshot: PlayerSnapshot = {
  appId: 'Spotify.exe',
  title: 'Night Drive',
  artist: 'Example Band',
  album: 'Somewhere',
  status: 'playing',
  positionMs: 0,
  durationMs: 200_500,
  lastUpdatedMs: 0,
};

const TTML =
  '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>' +
  '<p begin="00:01.000" end="00:02.000"><span begin="00:01.000" end="00:01.500">Hel</span><span begin="00:01.500" end="00:02.000">lo</span></p>' +
  '</div></body></tt>';

beforeAll(async () => {
  await loadChineseConverter();
});

describe('AMLL TTML DB', () => {
  it('uses whichever source answers first with the file', async () => {
    const calls: string[] = [];
    const http: HttpGet = async (url) => {
      calls.push(url);
      if (url.includes('search/get/web')) {
        return {
          status: 200,
          body: JSON.stringify({
            code: 200,
            result: { songs: [{ id: 42, name: 'Night Drive', artists: [{ name: 'Example Band' }], duration: 200_400 }] },
          }),
        };
      }
      // 第一個鏡像連不上，GitHub 有檔案
      if (url.includes('dimeta')) throw new Error('timeout');
      if (url.includes('githubusercontent') && url.endsWith('/42.ttml')) return { status: 200, body: TTML };
      return { status: 404, body: '' };
    };

    const found: Lyrics[] = [];
    await createTtmlDbProvider(http, new NeteaseLookup(http)).search(snapshot, (lyrics) => found.push(lyrics));
    expect(found).toHaveLength(1);
    expect(found[0].source).toBe('ttml-db');
    expect(found[0].sourceId).toBe('42');
    expect(found[0].lines[0].words?.map((w) => w.text)).toEqual(['Hel', 'lo']);
    expect(calls.some((url) => url.includes('bikonoo'))).toBe(false);
  });
});

const OTHER_TTML = TTML.replace('Hel', 'Bye').replace('lo<', 'bye<');

const track: SpotifyTrack = {
  id: 'spAAA',
  uri: 'spotify:track:spAAA',
  name: 'Night Drive',
  artists: ['Example Band'],
  album: 'Somewhere',
  durationMs: 200_500,
  isrc: 'TWA000000001',
};

/** 網易雲搜尋不到這首歌；AMLL TTML DB 只用 Spotify 的資料夾回答 */
function spotifyOnlyHttp(files: Record<string, string>, calls: string[] = []): HttpGet {
  return async (url) => {
    calls.push(url);
    if (url.includes('search/get/web')) return { status: 200, body: JSON.stringify({ code: 200, result: { songs: [] } }) };
    if (url.endsWith('index.jsonl')) return { status: 200, body: INDEX };
    const match = /spotify-lyrics\/(\w+)\.ttml$/.exec(url);
    if (match && files[match[1]]) return { status: 200, body: files[match[1]] };
    return { status: 404, body: '' };
  };
}

const INDEX = [
  JSON.stringify({ id: 'spBBB', metadata: [['musicName', ['Night Drive']], ['isrc', ['twa000000001']], ['spotifyId', ['spBBB']]] }),
  '{broken',
  JSON.stringify({ id: 'spCCC', metadata: [['isrc', ['USX000000002', 'USX000000003']]] }),
].join('\n');

describe('AMLL TTML DB by Spotify ID', () => {
  it('reads the ISRC index, upper-casing and skipping broken lines', () => {
    const index = parseSpotifyIndex(INDEX);
    expect(index.get('TWA000000001')).toBe('spBBB');
    expect(index.get('USX000000003')).toBe('spCCC');
    expect(index.size).toBe(3);
  });

  it('finds lyrics straight from the Spotify track ID, without matching titles', async () => {
    const http = spotifyOnlyHttp({ spAAA: TTML });
    const found: Lyrics[] = [];
    await createTtmlDbProvider(http, new NeteaseLookup(http)).search(snapshot, (l) => found.push(l), {
      spotify: Promise.resolve(track),
    });
    expect(found).toHaveLength(1);
    expect(found[0].sourceId).toBe('spotify:spAAA');
    expect(found[0].matched).toEqual({ title: 'Night Drive', artist: 'Example Band', durationMs: 200_500 });
  });

  it('falls back to another Spotify ID of the same recording through the ISRC index', async () => {
    const calls: string[] = [];
    const http = spotifyOnlyHttp({ spBBB: TTML }, calls);
    const found: Lyrics[] = [];
    await createTtmlDbProvider(http, new NeteaseLookup(http), new AmllSpotifyIndex(http)).search(snapshot, (l) => found.push(l), {
      spotify: Promise.resolve(track),
    });
    expect(found.map((l) => l.sourceId)).toEqual(['spotify:spBBB']);
    expect(calls.filter((url) => url.endsWith('index.jsonl'))).toHaveLength(1);
  });

  it('reports the same file found through NetEase and Spotify only once, but keeps different ones', async () => {
    const both = (spotifyFile: string): HttpGet => async (url) => {
      if (url.includes('search/get/web')) {
        return {
          status: 200,
          body: JSON.stringify({
            code: 200,
            result: { songs: [{ id: 42, name: 'Night Drive', artists: [{ name: 'Example Band' }], duration: 200_400 }] },
          }),
        };
      }
      if (url.endsWith('ncm-lyrics/42.ttml')) return { status: 200, body: TTML };
      if (url.endsWith('spotify-lyrics/spAAA.ttml')) return { status: 200, body: spotifyFile };
      return { status: 404, body: '' };
    };
    for (const [file, count] of [
      [TTML, 1],
      [OTHER_TTML, 2],
    ] as const) {
      const http = both(file);
      const found: Lyrics[] = [];
      await createTtmlDbProvider(http, new NeteaseLookup(http)).search(snapshot, (l) => found.push(l), {
        spotify: Promise.resolve(track),
      });
      expect(found).toHaveLength(count);
    }
  });

  it('skips the Spotify path when not connected or when the lookup failed', async () => {
    const calls: string[] = [];
    const http = spotifyOnlyHttp({ spAAA: TTML }, calls);
    await createTtmlDbProvider(http, new NeteaseLookup(http)).search(snapshot, () => {});
    await createTtmlDbProvider(http, new NeteaseLookup(http)).search(snapshot, () => {}, { spotify: Promise.reject(new Error('x')) });
    expect(calls.some((url) => url.includes('spotify-lyrics'))).toBe(false);
  });
});
