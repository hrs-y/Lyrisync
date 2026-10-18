import { beforeAll, describe, expect, it } from 'vitest';
import type { HttpGet, HttpResponse } from '../../net/http';
import type { PlayerSnapshot } from '../../player/types';
import { encryptQrc, qrcXml } from '../../test/qrcFixture';
import { loadChineseConverter } from '../chinese';
import type { Lyrics } from '../model';
import { createQqProvider } from './qq';

const snapshot: PlayerSnapshot = {
  appId: 'Spotify.exe',
  title: 'Night Drive',
  artist: '測試樂團',
  album: 'Somewhere',
  status: 'playing',
  positionMs: 0,
  durationMs: 200_500,
  lastUpdatedMs: 0,
};

interface FakeSong {
  id: number;
  name: string;
  singer: string;
  interval: number;
}

/** 假的 QQ 音樂：搜尋回傳指定的歌，歌詞介面依歌曲 ID 回傳指定內容 */
function fakeQq(songs: FakeSong[], lyrics: Record<number, Record<string, string>>): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const json = (value: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(value) });
  const http: HttpGet = async (url) => {
    calls.push(url);
    if (url.includes('client_search_cp')) {
      const list = songs.map((s) => ({ id: s.id, name: s.name, singer: [{ name: s.singer }], interval: s.interval }));
      return json({ code: 0, data: { song: { list } } });
    }
    if (url.includes('musicu.fcg')) {
      const request = JSON.parse(new URL(url).searchParams.get('data') ?? '{}');
      const data = lyrics[request.req?.param?.songID] ?? { lyric: '', trans: '', roma: '' };
      return json({ code: 0, req: { code: 0, data } });
    }
    return { status: 404, body: '' };
  };
  return Object.assign(http, { calls });
}

async function collect(http: HttpGet, current = snapshot): Promise<Lyrics[]> {
  const found: Lyrics[] = [];
  await createQqProvider(http).search(current, (lyrics) => found.push(lyrics));
  return found;
}

beforeAll(async () => {
  await loadChineseConverter();
});

describe('QQ Music', () => {
  it('picks the original over a cover and decodes word timing, translation and romanization', async () => {
    const http = fakeQq(
      [
        { id: 1, name: 'Night Drive', singer: 'Cover Singer', interval: 200 },
        { id: 2, name: 'Night Drive', singer: '测试乐团', interval: 200 },
      ],
      {
        2: {
          lyric: await encryptQrc(qrcXml('[ti:Night Drive]\n[1000,2000]第一(1000,1000)行(2000,1000)\n[3000,2000]第二行(3000,2000)')),
          trans: await encryptQrc('[00:01.00]first line\n[00:03.00]second line'),
          roma: await encryptQrc(qrcXml('[1000,2000]dai (1000,500)ichi (1500,500)gyou(2000,1000)\n[3000,2000]dai ni gyou(3000,2000)')),
        },
      },
    );
    const [lyrics] = await collect(http);
    expect(lyrics.source).toBe('qq');
    expect(lyrics.sourceId).toBe('2');
    expect(lyrics.lines.map((l) => l.text)).toEqual(['第一行', '第二行']);
    expect(lyrics.lines[0].words?.map((w) => w.text)).toEqual(['第一', '行']);
    expect(lyrics.lines.map((l) => l.translation)).toEqual(['first line', 'second line']);
    expect(lyrics.lines[0].romanization).toBe('dai ichi gyou');
    expect(lyrics.lines[0].romanizationWords?.map((w) => [w.text, w.startMs])).toEqual([
      ['dai ', 1000],
      ['ichi ', 1500],
      ['gyou', 2000],
    ]);
    expect(http.calls.find((url) => url.includes('musicu.fcg'))).toContain('GetPlayLyricInfo');
  });

  it('recognises the notice QQ uses for instrumentals', async () => {
    const http = fakeQq([{ id: 3, name: 'Night Drive', singer: '测试乐团', interval: 200 }], {
      3: { lyric: await encryptQrc(qrcXml('[0,1000]此歌曲为没有填词的纯音乐，请您欣赏(0,1000)')), trans: '', roma: '' },
    });
    const [lyrics] = await collect(http);
    expect(lyrics.instrumental).toBe(true);
  });

  it('accepts an artist written in another script only when the length matches closely', async () => {
    const japanese = { ...snapshot, artist: 'ultra test band' };
    const lyric = { lyric: await encryptQrc(qrcXml('[0,1000]歌(0,1000)')), trans: '', roma: '' };
    const close = fakeQq([{ id: 4, name: 'Night Drive', singer: 'ウルトラテストバンド', interval: 200 }], { 4: lyric });
    expect(await collect(close, japanese)).toHaveLength(1);
    const far = fakeQq([{ id: 5, name: 'Night Drive', singer: 'ウルトラテストバンド', interval: 198 }], { 5: lyric });
    expect(await collect(far, japanese)).toEqual([]);
  });

  it('finds nothing when every candidate is a cover', async () => {
    const http = fakeQq([{ id: 6, name: 'Night Drive', singer: 'Cover Singer', interval: 200 }], {});
    expect(await collect(http)).toEqual([]);
    expect(http.calls.some((url) => url.includes('musicu.fcg'))).toBe(false);
  });
});
