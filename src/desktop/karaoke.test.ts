// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { LyricLine } from '../lyrics/model';
import { KaraokeLine, type Measure } from './karaoke';

/** 假的排版：每個字寬度 = 字數 × 10px，依序排開；整行的寬度是所有字加起來 */
const fakeMeasure: Measure = (el) => {
  if (el.classList.contains('karaoke-base')) return { left: 0, width: (el.textContent ?? '').length * 10 };
  let left = 0;
  for (let sibling = el.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    left += (sibling.textContent ?? '').length * 10;
  }
  return { left, width: (el.textContent ?? '').length * 10 };
};

const x = (karaoke: KaraokeLine) => karaoke.el.style.getPropertyValue('--x');

// 自己編的歌詞：「ab」1000～2000ms、「cdef」2000～4000ms
const wordLine: LyricLine = {
  startMs: 1000,
  endMs: 4000,
  text: 'abcdef',
  words: [
    { text: 'ab', startMs: 1000, endMs: 2000 },
    { text: 'cdef', startMs: 2000, endMs: 4000 },
  ],
};

describe('KaraokeLine', () => {
  it('fills word by word, stopping inside the word being sung', () => {
    const karaoke = new KaraokeLine(fakeMeasure);
    karaoke.set(wordLine);
    karaoke.update(500);
    expect(x(karaoke)).toBe('0px');
    karaoke.update(1500);
    expect(x(karaoke)).toBe('10px');
    karaoke.update(2000);
    expect(x(karaoke)).toBe('20px');
    karaoke.update(3000);
    expect(x(karaoke)).toBe('40px');
    karaoke.update(9000);
    expect(x(karaoke)).toBe('60px');
  });

  it('lights a line without word timing all at once when it starts', () => {
    const karaoke = new KaraokeLine(fakeMeasure);
    karaoke.set({ startMs: 1000, endMs: 4000, text: 'abc' });
    karaoke.update(999);
    expect(x(karaoke)).toBe('0px');
    karaoke.update(1000);
    expect(x(karaoke)).toBe('30px');
  });

  it('shows plain text without filling', () => {
    const karaoke = new KaraokeLine(fakeMeasure);
    karaoke.set(null, '歌名');
    karaoke.update(60_000);
    expect(x(karaoke)).toBe('0px');
    expect(karaoke.el.querySelector('.karaoke-base')?.textContent).toBe('歌名');
    expect(karaoke.el.querySelector('.karaoke-fill')?.textContent).toBe('歌名');
  });

  it('keeps both layers in sync and hides the overlay from screen readers', () => {
    const karaoke = new KaraokeLine(fakeMeasure);
    karaoke.set(wordLine);
    const base = karaoke.el.querySelector('.karaoke-base')!;
    const fill = karaoke.el.querySelector('.karaoke-fill')!;
    expect(base.textContent).toBe('abcdef');
    expect(fill.textContent).toBe('abcdef');
    expect(fill.getAttribute('aria-hidden')).toBe('true');
  });
});
