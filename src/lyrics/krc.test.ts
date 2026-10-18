import { describe, expect, it } from 'vitest';
import { encodeKrc, utf8ToBase64 } from '../test/krcFixture';
import { decodeKrc, parseKrc } from './krc';

describe('decodeKrc', () => {
  it('reverses the XOR and zlib layers', async () => {
    const text = '[ar:測試]\n[0,1000]<0,500,0>字';
    expect(await decodeKrc(await encodeKrc(text))).toBe(text);
  });

  it('rejects data without the krc1 header', async () => {
    await expect(decodeKrc(btoa('nope'))).rejects.toThrow('不是 KRC 格式');
  });
});

describe('parseKrc', () => {
  it('turns word offsets into absolute times', () => {
    const { lines } = parseKrc('[1000,2000]<0,500,0>Hel<500,500,0>lo <1000,1000,0>there');
    expect(lines[0].text).toBe('Hello there');
    expect(lines[0].words).toEqual([
      { text: 'Hel', startMs: 1000, endMs: 1500 },
      { text: 'lo ', startMs: 1500, endMs: 2000 },
      { text: 'there', startMs: 2000, endMs: 3000 },
    ]);
  });

  it('attaches translations from the language tag in line order', () => {
    const language = utf8ToBase64(
      JSON.stringify({ content: [{ language: 0, type: 1, lyricContent: [['第一行的翻譯'], ['第二行的翻譯']] }], version: 1 }),
    );
    const { lines } = parseKrc(`[language:${language}]\n[0,1000]<0,1000,0>one\n[1000,1000]<0,1000,0>two`);
    expect(lines.map((l) => l.translation)).toEqual(['第一行的翻譯', '第二行的翻譯']);
  });

  it('times each romanization fragment like the word it belongs to', () => {
    const language = utf8ToBase64(
      JSON.stringify({ content: [{ language: 0, type: 0, lyricContent: [['a ', 'ri '], ['x ']] }], version: 1 }),
    );
    const { lines } = parseKrc(`[language:${language}]\n[0,1000]<0,500,0>あ<500,500,0>り\n[1000,1000]<0,500,0>か<500,500,0>な`);
    expect(lines[0].romanization).toBe('a ri');
    expect(lines[0].romanizationWords).toEqual([
      { text: 'a ', startMs: 0, endMs: 500 },
      { text: 'ri ', startMs: 500, endMs: 1000 },
    ]);
    // 數量對不上時只有整行的文字
    expect(lines[1].romanization).toBe('x');
    expect(lines[1].romanizationWords).toBeUndefined();
  });

  it('shows lyrics earlier for a positive offset', () => {
    const { lines, tags } = parseKrc('[offset:300]\n[1000,1000]<0,1000,0>字');
    expect(tags.offset).toBe('300');
    expect(lines[0].startMs).toBe(700);
    expect(lines[0].words?.[0].startMs).toBe(700);
  });
});
