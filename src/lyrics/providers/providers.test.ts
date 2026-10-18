import { beforeAll, describe, expect, it } from 'vitest';
import type { HttpGet, HttpResponse } from '../../net/http';
import type { PlayerSnapshot } from '../../player/types';
import { encodeKrc } from '../../test/krcFixture';
import { loadChineseConverter } from '../chinese';
import type { Lyrics } from '../model';
import type { LyricsProvider } from '../service';
import { createKugouProvider } from './kugou';
import { createLrclibProvider } from './lrclib';
import { createNeteaseProvider, createTtmlDbProvider, NeteaseLookup } from './netease';

const baseSnapshot: PlayerSnapshot = {
  appId: 'Spotify.exe',
  title: 'Night Drive',
  artist: '測試樂團',
  album: 'Somewhere',
  status: 'playing',
  positionMs: 0,
  durationMs: 200_500,
  lastUpdatedMs: 0,
};

type Route = [RegExp, (url: URL) => HttpResponse];

/** 依網址回應的假 HTTP；沒有對應的路徑回 404，並記下所有請求 */
function fakeHttp(routes: Route[]): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const http = async (url: string) => {
    calls.push(url);
    const route = routes.find(([pattern]) => pattern.test(url));
    return route ? route[1](new URL(url)) : { status: 404, body: 'not found' };
  };
  return Object.assign(http, { calls });
}

const json = (value: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(value) });

async function collect(provider: LyricsProvider, snapshot = baseSnapshot): Promise<Lyrics[]> {
  const found: Lyrics[] = [];
  await provider.search(snapshot, (lyrics) => found.push(lyrics));
  return found;
}

beforeAll(async () => {
  await loadChineseConverter();
});

describe('NetEase and AMLL TTML DB', () => {
  const routes: Route[] = [
    [
      /search\/get\/web/,
      () =>
        json({
          code: 200,
          result: {
            songs: [
              { id: 1, name: 'Night Drive', artists: [{ name: 'Cover Singer' }], duration: 200_500 },
              { id: 2, name: 'Night Drive', artists: [{ name: '测试乐团' }], duration: 200_400 },
            ],
          },
        }),
    ],
    [
      /song\/lyric\/v1/,
      (url) =>
        url.searchParams.get('id') === '2'
          ? json({
              code: 200,
              lrc: { lyric: '[00:01.00]第一行\n[00:03.00]第二行' },
              yrc: {
                lyric:
                  '{"t":0,"c":[{"tx":"作词: "},{"tx":"某人"}]}\n[1000,2000](1000,1000,0)第一(2000,1000,0)行\n[3000,2000](3000,2000,0)第二行',
              },
              tlyric: { lyric: '[00:01.00]first line\n[00:03.00]second line' },
            })
          : { status: 500, body: '' },
    ],
  ];

  it('picks the original artist over a cover and uses word timing with translations', async () => {
    const http = fakeHttp(routes);
    const [lyrics] = await collect(createNeteaseProvider(http, new NeteaseLookup(http)));
    expect(lyrics.source).toBe('netease');
    expect(lyrics.sourceId).toBe('2');
    expect(lyrics.lines.map((l) => l.text)).toEqual(['第一行', '第二行']);
    expect(lyrics.lines[0].words?.map((w) => w.text)).toEqual(['第一', '行']);
    expect(lyrics.lines.map((l) => l.translation)).toEqual(['first line', 'second line']);
  });

  it('falls back to line timing when the NetEase version is too long', async () => {
    const http = fakeHttp(routes);
    const [lyrics] = await collect(createNeteaseProvider(http, new NeteaseLookup(http)), {
      ...baseSnapshot,
      durationMs: 203_900,
    });
    expect(lyrics.lines[0].words).toBeUndefined();
    expect(lyrics.lines.map((l) => l.text)).toEqual(['第一行', '第二行']);
  });

  it('shares one NetEase search and treats 404 as not in the AMLL database', async () => {
    const http = fakeHttp(routes);
    const lookup = new NeteaseLookup(http);
    const [ttml, netease] = await Promise.all([
      collect(createTtmlDbProvider(http, lookup)),
      collect(createNeteaseProvider(http, lookup)),
    ]);
    expect(ttml).toEqual([]);
    expect(netease).toHaveLength(1);
    expect(http.calls.filter((url) => url.includes('search/get/web'))).toHaveLength(1);
  });

  it('fails when every AMLL source is unreachable', async () => {
    const http = fakeHttp([routes[0], [/ncm-lyrics/, () => ({ status: 503, body: '' })]]);
    await expect(collect(createTtmlDbProvider(http, new NeteaseLookup(http)))).rejects.toThrow('AMLL TTML DB 都連不上');
    expect(http.calls.filter((url) => url.includes('ncm-lyrics'))).toHaveLength(4);
  });

  it('finds nothing when only covers exist', async () => {
    const http = fakeHttp([
      [
        /search\/get\/web/,
        () => json({ code: 200, result: { songs: [{ id: 1, name: 'Night Drive', artists: [{ name: 'Cover Singer' }], duration: 200_500 }] } }),
      ],
    ]);
    expect(await collect(createNeteaseProvider(http, new NeteaseLookup(http)))).toEqual([]);
  });
});

describe('Kugou', () => {
  it('searches with a Simplified keyword and decodes KRC without the title line', async () => {
    const krc = await encodeKrc('[0,1000]<0,1000,0>测试乐团 - Night Drive\n[1000,1000]<0,500,0>Hel<500,500,0>lo');
    const http = fakeHttp([
      [
        /lyrics\.kugou\.com\/search/,
        () =>
          json({ status: 200, candidates: [{ id: '9', accesskey: 'k', song: 'Night Drive', singer: '测试乐团', duration: 200_000 }] }),
      ],
      [/lyrics\.kugou\.com\/download/, () => json({ status: 200, fmt: 'krc', content: krc })],
    ]);
    const [lyrics] = await collect(createKugouProvider(http));
    expect(new URL(http.calls[0]).searchParams.get('keyword')).toBe('测试乐团 - Night Drive');
    expect(lyrics.source).toBe('kugou');
    expect(lyrics.lines.map((l) => l.text)).toEqual(['Hello']);
    expect(lyrics.lines[0].words?.map((w) => w.text)).toEqual(['Hel', 'lo']);
  });

  it('skips candidates more than 3 seconds off', async () => {
    const http = fakeHttp([
      [
        /lyrics\.kugou\.com\/search/,
        () =>
          json({ status: 200, candidates: [{ id: '9', accesskey: 'k', song: 'Night Drive', singer: '测试乐团', duration: 204_000 }] }),
      ],
    ]);
    expect(await collect(createKugouProvider(http))).toEqual([]);
    expect(http.calls.some((url) => url.includes('/download'))).toBe(false);
  });
});

describe('LRCLIB', () => {
  const track = {
    id: 5,
    trackName: 'Night Drive',
    artistName: '測試樂團',
    duration: 200.4,
    instrumental: false,
    syncedLyrics: '[00:01.00]第一行\n[00:03.00]第二行',
    plainLyrics: '第一行\n第二行',
  };

  it('retries with the cleaned title and prefers synced lyrics', async () => {
    const http = fakeHttp([
      [/lrclib\.net\/api\/search/, (url) => json(url.searchParams.get('track_name') === 'Night Drive' ? [track] : [])],
    ]);
    const [lyrics] = await collect(createLrclibProvider(http), { ...baseSnapshot, title: 'Night Drive - Remastered 2011' });
    expect(lyrics.source).toBe('lrclib');
    expect(lyrics.synced).toBe(true);
    expect(lyrics.lines.map((l) => l.text)).toEqual(['第一行', '第二行']);
  });

  it('reports a failed request when nothing was found', async () => {
    const http = fakeHttp([[/lrclib\.net\/api\/search/, () => ({ status: 500, body: '' })]]);
    await expect(collect(createLrclibProvider(http))).rejects.toThrow('HTTP 500');
  });
});
