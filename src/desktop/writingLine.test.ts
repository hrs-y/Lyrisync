// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { WritingLine } from './writingLine';

const vars = (line: WritingLine, name: string) =>
  Array.from(line.el.querySelectorAll<HTMLElement>('.ink-w'), (w) => w.style.getPropertyValue(name));
const dry = (line: WritingLine) => Array.from(line.el.querySelectorAll('.ink-w'), (w) => w.classList.contains('dry'));

// 測試用的歌詞都是自己編的
describe('WritingLine', () => {
  const words = [
    { text: 'hold ', startMs: 1000, endMs: 2000 },
    { text: 'on', startMs: 2000, endMs: 4000 },
  ];

  it('writes each word from left to right as it is sung, invisible before', () => {
    const line = new WritingLine();
    line.set('hold on', words, 1000, 4000);
    line.update(500);
    expect(vars(line, '--p')).toEqual(['0', '0']);
    line.update(1500);
    expect(vars(line, '--p')).toEqual(['0.5', '0']);
    line.update(3000);
    expect(vars(line, '--p')).toEqual(['1', '0.5']);
  });

  it('settles fresh ink, then drops the mask once a word is written', () => {
    const line = new WritingLine();
    line.set('hold on', words, 1000, 4000);
    line.update(1210);
    expect(vars(line, '--ink')[0]).toBe('0.5');
    expect(dry(line)).toEqual([false, false]);
    line.update(2500);
    expect(dry(line)).toEqual([true, false]);
    // 往回跳轉：又變回沒寫過
    line.update(1100);
    expect(dry(line)).toEqual([false, false]);
  });

  it('keeps the spaces between words outside the word boxes', () => {
    const line = new WritingLine();
    line.set('hold on', words, 1000, 4000);
    expect(line.el.textContent).toBe('hold on');
    expect(Array.from(line.el.querySelectorAll('.ink-w'), (w) => w.textContent)).toEqual(['hold', 'on']);
  });

  it('estimates the timing of text without word timing, one CJK character at a time', () => {
    const line = new WritingLine('sub');
    line.set('慢慢寫', undefined, 1000, 5000);
    expect(line.el.className).toBe('ink-line sub');
    expect(line.el.querySelectorAll('.ink-w')).toHaveLength(3);
    // 一個字約 230ms：第二個字在 1230ms 開始
    line.update(1230);
    expect(vars(line, '--p')).toEqual(['1', '0', '0']);
  });
});
