import { beforeAll, describe, expect, it } from 'vitest';
import { hasKana, isJapanese, loadChineseConverter, toSimplified, toTraditionalLyrics } from './chinese';
import type { LyricLine, Lyrics } from './model';

beforeAll(async () => {
  await loadChineseConverter();
});

const lyricsOf = (lines: LyricLine[]): Lyrics => ({ synced: true, source: 'netease', lines });
const wordsOf = (chars: string[]) => chars.map((text, i) => ({ text, startMs: i * 100, endMs: i * 100 + 100 }));

describe('hasKana', () => {
  it('finds hiragana and katakana, including half-width', () => {
    expect(hasKana('ひらがな')).toBe(true);
    expect(hasKana('カタカナ')).toBe(true);
    expect(hasKana('ﾃｽﾄ')).toBe(true);
  });

  it('does not count ・ or ー, which Chinese lyrics use too', () => {
    expect(hasKana('甲・乙ー丙')).toBe(false);
  });
});

describe('isJapanese', () => {
  const line = (text: string): LyricLine => ({ startMs: 0, endMs: 0, text });

  it('needs kana in at least a fifth of the lines', () => {
    expect(isJapanese([line('こんにちは'), line('永遠'), line('明日')])).toBe(true);
    expect(isJapanese([line('一'), line('二'), line('三'), line('四'), line('五'), line('六'), line('ね')])).toBe(false);
  });
});

describe('toTraditionalLyrics', () => {
  it('converts the whole line so phrases resolve, then keeps the word split', () => {
    const out = toTraditionalLyrics(
      lyricsOf([{ startMs: 0, endMs: 400, text: '头发很长', words: wordsOf(['头', '发', '很', '长']) }]),
    );
    expect(out.lines[0].text).toBe('頭髮很長');
    expect(out.lines[0].words?.map((w) => w.text)).toEqual(['頭', '髮', '很', '長']);
    expect(out.lines[0].words?.[1].startMs).toBe(100);
  });

  it('leaves Japanese songs alone but converts their translations', () => {
    const out = toTraditionalLyrics(
      lyricsOf([
        { startMs: 0, endMs: 1, text: 'こんにちは', translation: '你好' },
        { startMs: 1, endMs: 2, text: '永远', translation: '永远' },
      ]),
    );
    expect(out.lines[1].text).toBe('永远');
    expect(out.lines[1].translation).toBe('永遠');
  });

  it('does not touch text that is already Traditional', () => {
    const lyrics = lyricsOf([{ startMs: 0, endMs: 1, text: '頭髮很長' }]);
    expect(toTraditionalLyrics(lyrics).lines[0].text).toBe('頭髮很長');
  });
});

describe('toSimplified', () => {
  it('converts search keywords', () => {
    expect(toSimplified('測試樂團 - 夜車')).toBe('测试乐团 - 夜车');
    expect(toSimplified('Night Drive')).toBe('Night Drive');
  });
});
