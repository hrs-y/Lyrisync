import { beforeAll, describe, expect, it } from 'vitest';
import { loadChineseConverter } from './chinese';
import { isCreditLine, isTitleLine, removeCredits } from './credits';

beforeAll(async () => {
  await loadChineseConverter();
});

describe('isCreditLine', () => {
  it('recognises credit lines in Chinese and English', () => {
    for (const text of ['作词 : 某人', '作曲：某人', '编曲 Arranger：某人', 'Composed by：Someone', 'Lyrics by: Someone', 'TME享有本翻译作品的著作权']) {
      expect(isCreditLine(text), text).toBe(true);
    }
  });

  it('leaves ordinary lines alone', () => {
    for (const text of ['我說：你好', 'Music is all I need', '曲終人散', 'OPEN the door']) {
      expect(isCreditLine(text), text).toBe(false);
    }
  });
});

describe('isTitleLine', () => {
  it('spots an "artist - title" line', () => {
    expect(isTitleLine('Test Artist - Night Drive', 'Night Drive', 'Test Artist')).toBe(true);
    expect(isTitleLine('测试歌手 - 夜车', '夜車', '測試歌手')).toBe(true);
  });

  it('needs a dash, the title and the artist', () => {
    expect(isTitleLine('Night Drive', 'Night Drive', 'Test Artist')).toBe(false);
    expect(isTitleLine('Another - Thing', 'Night Drive', 'Test Artist')).toBe(false);
  });
});

describe('removeCredits', () => {
  const line = (text: string, startMs: number) => ({ startMs, endMs: startMs + 1000, text });

  it('drops the title line and credits', () => {
    const lines = [line('Test Artist - Night Drive', 0), line('作词：某人', 1000), line('第一句', 2000), line('第二句', 3000)];
    expect(removeCredits(lines, 'Night Drive', 'Test Artist').map((l) => l.text)).toEqual(['第一句', '第二句']);
  });

  it('keeps everything when nothing would be left', () => {
    const lines = [line('作词：某人', 0)];
    expect(removeCredits(lines, 'Night Drive', 'Test Artist')).toEqual(lines);
  });
});
