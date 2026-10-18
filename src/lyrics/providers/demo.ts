import { parseLrc } from '../lrc';
import type { Lyrics } from '../model';
import type { LyricsProvider } from '../service';
import { parseTtml } from '../ttml';

export interface DemoTrack {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  lrc?: string;
  ttml?: string;
}

/** 瀏覽器預覽用的示範歌曲；歌詞都是自己寫的測試文字。 */
export const DEMO_TRACKS: DemoTrack[] = [
  {
    title: '示範歌曲（一）',
    artist: '測試樂團',
    album: '瀏覽器預覽',
    durationMs: 34_000,
    lrc: [
      '[ti:示範歌曲（一）]',
      '[00:00.80]（瀏覽器預覽用的示範歌詞）',
      '[00:03.00]第一行從這裡開始',
      '[00:05.50]每隔幾秒換到下一行',
      '[00:08.00]目前這一行會亮起來',
      '[00:10.50]其他行維持半透明',
      '[00:13.00]點任何一行都可以跳過去',
      '[00:15.50]',
      '[00:19.00]剛才那段空白是間奏',
      '[00:21.50]A longer English line to check how wrapping behaves when the window gets narrow',
      '[00:25.00]視窗縮小時不能跑版',
      '[00:27.50]最後幾行用來測試捲動',
      '[00:30.00]示範到這裡結束',
    ].join('\n'),
  },
  {
    title: 'Demo Song Two',
    artist: 'Preview Band',
    album: 'Browser Preview',
    durationMs: 30_000,
    ttml: buildDemoTtml(),
  },
  // 沒有歌詞的示範：用來預覽「找不到歌詞」時封面置中的版面
  {
    title: '沒有歌詞的示範',
    artist: '測試樂團',
    album: '瀏覽器預覽',
    durationMs: 20_000,
  },
];

/** 逐字示範：英文分音節、中文逐字、長音、背景人聲、對唱、翻譯 */
function buildDemoTtml(): string {
  const t = (ms: number) => {
    const s = ms / 1000;
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;
  };
  const span = (text: string, start: number, end: number) => `<span begin="${t(start)}" end="${t(end)}">${text}</span>`;
  const words = (list: Array<[string, number, number]>) => list.map(([w, s, e]) => span(w, s, e)).join('');
  const p = (start: number, end: number, body: string, agent = 'v1') =>
    `<p begin="${t(start)}" end="${t(end)}" ttm:agent="${agent}">${body}</p>`;

  const lines = [
    p(1000, 3600, words([['This ', 1000, 1400], ['line ', 1400, 1800], ['has ', 1800, 2200], ['word ', 2200, 2600], ['tim', 2600, 3000], ['ing', 3000, 3600]]) +
      '<span ttm:role="x-translation" xml:lang="zh-TW">這一行有逐字時間</span>'),
    p(4000, 7200, words([['逐', 4000, 4400], ['字', 4400, 4800], ['填', 4800, 5200], ['色', 5200, 5600], ['測', 5600, 6000], ['試', 6000, 7200]])),
    p(7600, 11000, words([['A ', 7600, 7900], ['long ', 7900, 8300], ['note ', 8300, 8700], ['glo', 8700, 9000], ['ws', 9000, 11000]]) +
      `<span ttm:role="x-bg" begin="${t(9200)}" end="${t(10800)}">${words([['(soft ', 9200, 9800], ['echo)', 9800, 10800]])}</span>`),
    p(11400, 14200, words([['對', 11400, 11800], ['唱', 11800, 12200], ['的', 12200, 12600], ['人', 12600, 13000], ['在', 13000, 13400], ['右', 13400, 13800], ['邊', 13800, 14200]]), 'v2'),
    p(14600, 17400, words([['Back ', 14600, 15000], ['to ', 15000, 15300], ['the ', 15300, 15600], ['left ', 15600, 16200], ['side', 16200, 17400]])),
    p(22000, 25000, words([['間', 22000, 22400], ['奏', 22400, 22800], ['之', 22800, 23200], ['後', 23200, 23600], ['繼', 23600, 24000], ['續', 24000, 25000]]) +
      '<span ttm:role="x-translation" xml:lang="en">Carrying on after the interlude</span>'),
    p(25400, 28400, words([['示範', 25400, 26200], ['到這裡', 26200, 27200], ['結束', 27200, 28400]])),
  ];
  return [
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">',
    '<head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/></metadata></head>',
    `<body dur="${t(30_000)}"><div>${lines.join('')}</div></body></tt>`,
  ].join('');
}

export const demoProvider: LyricsProvider = {
  name: 'demo',
  async search(snapshot, found) {
    const track = DEMO_TRACKS.find((t) => t.title === snapshot.title && t.artist === snapshot.artist);
    if (!track || (!track.lrc && !track.ttml)) return;
    await new Promise((resolve) => setTimeout(resolve, 250)); // 模擬網路延遲
    const base: Pick<Lyrics, 'source' | 'matched'> = {
      source: 'demo',
      matched: { title: track.title, artist: track.artist, durationMs: track.durationMs },
    };
    if (track.ttml) {
      found({ ...base, synced: true, lines: parseTtml(track.ttml) });
    } else {
      const parsed = parseLrc(track.lrc ?? '', snapshot.durationMs);
      found({ ...base, synced: parsed.synced, lines: parsed.lines });
    }
  },
};
