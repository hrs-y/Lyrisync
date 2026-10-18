import { describe, expect, it } from 'vitest';
import { synthesizeWords } from './writing';

// 測試用的文字都是自己編的
describe('synthesizeWords', () => {
  it('gives every CJK character its own slot, one after another from the start of the line', () => {
    const words = synthesizeWords('寫下來', 1000, 5000);
    expect(words.map((w) => w.text)).toEqual(['寫', '下', '來']);
    expect(words[0].startMs).toBe(1000);
    for (let i = 1; i < words.length; i++) expect(words[i].startMs).toBe(words[i - 1].endMs);
    // 一個字 230ms
    expect(words[2].endMs).toBe(1690);
  });

  it('keeps English words whole with their spaces and spends less time per letter', () => {
    const words = synthesizeWords('write it down', 0, 10_000);
    expect(words.map((w) => w.text)).toEqual(['write ', 'it ', 'down']);
    // write：5 個字母 × 0.4 = 2 個字的時間
    expect(words[0].endMs - words[0].startMs).toBe(460);
  });

  it('finishes within most of a short line', () => {
    const words = synthesizeWords('一二三四五六七八九十', 0, 1000);
    expect(words.at(-1)!.endMs).toBe(850);
  });

  it('gives punctuation a short slot and nothing to blank text', () => {
    const words = synthesizeWords('你好，世界', 0, 10_000);
    expect(words.map((w) => w.text)).toEqual(['你', '好', '，', '世', '界']);
    const length = (i: number) => words[i].endMs - words[i].startMs;
    expect(length(2)).toBeLessThan(length(1));
    expect(synthesizeWords('   ', 0, 1000)).toEqual([]);
  });
});
