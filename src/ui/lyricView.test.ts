// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lyrics } from '../lyrics/model';
import { clampScroll, LyricView } from './lyricView';
import { QUALITY_PROFILES } from './quality';

const lyrics: Lyrics = {
  source: 'demo',
  synced: true,
  lines: [
    {
      startMs: 1000,
      endMs: 3000,
      text: 'Hello there',
      words: [
        { text: 'Hel', startMs: 1000, endMs: 1500 },
        { text: 'lo', startMs: 1500, endMs: 2000 },
        { text: ' there', startMs: 2000, endMs: 3000 },
      ],
    },
    {
      startMs: 3000,
      endMs: 5000,
      text: '逐字',
      words: [
        { text: '逐', startMs: 3000, endMs: 4000 },
        { text: '字', startMs: 4000, endMs: 5000 },
      ],
      translation: '翻譯',
    },
    { startMs: 10_000, endMs: 12_000, text: '整行', alignEnd: true },
  ],
};

let root: HTMLElement;
let seek: ReturnType<typeof vi.fn<(ms: number) => void>>;
let switchVersion: ReturnType<typeof vi.fn<() => void>>;
let view: LyricView;

const lines = () => Array.from(root.querySelectorAll<HTMLElement>('.line'));
const words = (line: number) => Array.from(lines()[line].querySelectorAll<HTMLElement>('.w'));
const progress = (el: HTMLElement) => el.style.getPropertyValue('--p');
const lift = (el: HTMLElement) => Number(el.style.getPropertyValue('--lift'));
const isActive = (line: number) => lines()[line].classList.contains('active');

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('main');
  document.body.append(root);
  seek = vi.fn<(ms: number) => void>();
  switchVersion = vi.fn<() => void>();
  view = new LyricView(root, seek, switchVersion);
  view.setState({ kind: 'lyrics', lyrics });
});

describe('LyricView', () => {
  it('keeps the space before a word as text, so words never run together', () => {
    expect(lines()[0].querySelector('.main')?.textContent).toBe('Hello there');
  });

  it('marks each line with its language so it gets the chosen typeface', () => {
    expect(lines().map((line) => line.lang)).toEqual(['en', 'zh-Hant', 'zh-Hant']);
    // 日文歌：只有漢字的行也用日文字體
    view.setState({
      kind: 'lyrics',
      lyrics: {
        source: 'demo',
        synced: true,
        lines: [
          { startMs: 0, endMs: 1000, text: '夜に駆ける' },
          { startMs: 1000, endMs: 2000, text: '永遠' },
          { startMs: 2000, endMs: 3000, text: 'Oh yeah' },
        ],
      },
    });
    expect(lines().map((line) => line.lang)).toEqual(['ja', 'ja', 'en']);
  });

  it('keeps the syllables of one word together but lets CJK characters wrap', () => {
    expect(Array.from(lines()[0].querySelectorAll('.run'), (run) => run.textContent)).toEqual(['Hello', 'there']);
    expect(lines()[1].querySelectorAll('.run')).toHaveLength(0);
    expect(words(1)).toHaveLength(2);
  });

  it('fills the words that are being sung', () => {
    view.update(1250);
    expect(isActive(0)).toBe(true);
    expect(progress(words(0)[0])).toBe('0.5');
    expect(progress(words(0)[1])).toBe('0');
    view.update(2500);
    expect(progress(words(0)[0])).toBe('1');
    expect(progress(words(0)[2])).toBe('0.5');
  });

  it('lifts each word with an ease-in-out curve that outlasts short words', () => {
    view.update(1250);
    // 「Hel」只唱 500ms，上浮用 650ms：唱到一半時才浮起三成，起步是緩的
    expect(lift(words(0)[0])).toBeCloseTo(0.33, 2);
    expect(lift(words(0)[1])).toBe(0);
    view.update(1500);
    // 這個字唱完了，上浮還在收尾，不會一下子停住
    expect(lift(words(0)[0])).toBeGreaterThan(0.8);
    expect(lift(words(0)[0])).toBeLessThan(1);
    view.update(1700);
    expect(lift(words(0)[0])).toBe(1);
  });

  it('moves to the next line and goes dark during a long interlude', () => {
    view.update(2999);
    expect(isActive(0)).toBe(true);
    view.update(3000);
    expect(isActive(0)).toBe(false);
    expect(isActive(1)).toBe(true);
    view.update(5500);
    expect(isActive(1)).toBe(false);
    expect(isActive(2)).toBe(false);
  });

  it('resets the words after seeking back before the line', () => {
    view.update(2500);
    view.update(500);
    expect(isActive(0)).toBe(false);
    expect(progress(words(0)[0])).toBe('0');
    expect(lift(words(0)[0])).toBe(0);
  });

  it('lights a line without word timing as a whole and puts duets on the right', () => {
    view.update(10_500);
    expect(isActive(2)).toBe(true);
    expect(lines()[2].classList.contains('no-words')).toBe(true);
    expect(lines()[2].classList.contains('duet')).toBe(true);
  });

  it('shows translations and can hide them', () => {
    expect(lines()[1].querySelector('.sub')?.textContent).toBe('翻譯');
    expect(view.hasTranslation).toBe(true);
    view.setTranslationVisible(false);
    expect(root.classList.contains('hide-translation')).toBe(true);
  });

  it('seeks to the start of a clicked line', () => {
    words(1)[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(seek).toHaveBeenCalledWith(3000);
  });

  it('adds breathing dots for a long gap and fills them as it passes', () => {
    const interlude = root.querySelector<HTMLElement>('.item.interlude')!;
    expect(interlude).not.toBeNull();
    // 間奏從 5000 到 9600（下一行開始前 400ms 退場），取中間點
    view.update(7300);
    expect(interlude.classList.contains('active')).toBe(true);
    const dots = Array.from(interlude.querySelectorAll<HTMLElement>('.dot'));
    expect(dots.map((dot) => dot.style.getPropertyValue('--fill'))).toEqual(['1.000', '0.500', '0.000']);
    view.update(9700);
    expect(interlude.classList.contains('active')).toBe(false);
  });

  it('blurs lines more the further they are from the current one, but never the source line', () => {
    view.update(1250);
    const items = Array.from(root.querySelectorAll<HTMLElement>('.item'));
    expect(items.map((item) => item.style.getPropertyValue('--blur'))).toEqual(['', '0.85px', '1.7px', '2.55px', '']);
  });

  it('sends a smooth wave through the letters of a long note', () => {
    const letters = lines()[0].querySelectorAll<HTMLElement>('.w.letters .ch');
    const bump = (k: number) => Number(letters[k].style.getPropertyValue('--bump'));
    expect(Array.from(letters, (ch) => ch.textContent).join('')).toBe('there');
    expect(lines()[0].querySelector('.main')?.textContent).toBe('Hello there');
    // 唱到一半：波峰在中間的字母，兩端的字母只被微微帶起，而且左右對稱
    view.update(2500);
    expect(bump(2)).toBe(1);
    expect(bump(0)).toBeCloseTo(0.19, 2);
    expect(bump(4)).toBeCloseTo(bump(0), 3);
    // 剛開唱、快唱完：波浪淡入淡出，字母不會一下子跳起來或停在半空中
    view.update(2010);
    expect(bump(0)).toBeLessThan(0.1);
    view.update(2995);
    expect(bump(4)).toBeLessThan(0.1);
  });

  it('drops the per-letter animation below the high quality level', () => {
    view.setQuality(QUALITY_PROFILES.medium);
    expect(root.querySelectorAll('.ch')).toHaveLength(0);
    expect(root.classList.contains('depth-blur')).toBe(false);
    expect(lines()[0].querySelector('.main')?.textContent).toBe('Hello there');
  });

  it('moves each line on its own with springs, or the whole list at the low level', () => {
    view.update(1250);
    expect(lines()[0].style.transform).toContain('translate3d');
    view.setQuality(QUALITY_PROFILES.low);
    view.update(1300);
    expect(lines()[0].style.transform).toBe('');
    expect(root.querySelector<HTMLElement>('.lyric-track')!.style.transform).toContain('translate3d');
  });

  it('ends with the lyrics source and a button to switch versions', () => {
    const footer = root.querySelector<HTMLElement>('.item.footer')!;
    const button = footer.querySelector<HTMLButtonElement>('.credit-switch')!;
    expect(root.querySelector('.lyric-track')!.lastElementChild).toBe(footer);
    expect(footer.hidden).toBe(true);

    view.setFooter({ source: '網易雲音樂（逐字）', version: { index: 0, count: 1 } });
    expect(footer.hidden).toBe(false);
    expect(footer.textContent).toContain('歌詞來源：網易雲音樂（逐字）');
    expect(button.hidden).toBe(true);

    view.setFooter({ source: '酷狗音樂（逐字）', version: { index: 1, count: 3 } });
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('其他版本 2/3');
    button.click();
    expect(switchVersion).toHaveBeenCalledOnce();
    expect(seek).not.toHaveBeenCalled();

    view.setFooter(null);
    expect(footer.hidden).toBe(true);
  });

  it('never focuses the source line, even after the last line', () => {
    view.setFooter({ source: '示範歌詞（逐字）' });
    view.update(60_000);
    expect(view.currentIndex).toBe(2);
  });

  it('shows romanization under the line and fills it word by word when it has timing', () => {
    view.setState({
      kind: 'lyrics',
      lyrics: {
        source: 'demo',
        synced: true,
        lines: [
          {
            startMs: 1000,
            endMs: 3000,
            text: 'いちに',
            words: [
              { text: 'いち', startMs: 1000, endMs: 2000 },
              { text: 'に', startMs: 2000, endMs: 3000 },
            ],
            romanization: 'ichi ni',
            romanizationWords: [
              { text: 'ichi ', startMs: 1000, endMs: 2000 },
              { text: 'ni', startMs: 2000, endMs: 3000 },
            ],
          },
          { startMs: 3000, endMs: 4000, text: 'さん', romanization: 'san' },
        ],
      },
    });
    expect(view.hasRomanization).toBe(true);
    const [first, second] = lines();
    const romaWords = Array.from(first.querySelectorAll<HTMLElement>('.roma .w'));
    expect(first.querySelector('.roma')?.textContent).toBe('ichi ni');
    expect(romaWords).toHaveLength(2);
    // 羅馬拼音不做長音效果
    expect(first.querySelectorAll('.roma .w.long')).toHaveLength(0);
    view.update(1500);
    expect(progress(romaWords[0])).toBe('0.5');
    expect(second.querySelector('.roma.plain')?.textContent).toBe('san');
    view.setRomanizationVisible(false);
    expect(root.classList.contains('hide-romanization')).toBe(true);
  });

  it('shows skeleton lines while loading and dots for instrumentals', () => {
    view.setState({ kind: 'loading' });
    expect(root.querySelectorAll('.skeleton-line')).toHaveLength(5);
    expect(root.querySelector('.item.footer')).toBeNull();
    view.setState({ kind: 'instrumental' });
    expect(root.querySelectorAll('.instrumental-dots .dot')).toHaveLength(3);
    expect(root.textContent).toContain('純音樂');
  });
});

describe('LyricView writing effect', () => {
  const unwritten = (line: number) => lines()[line].classList.contains('unwritten');
  const ink = (el: HTMLElement) => Number(el.style.getPropertyValue('--ink'));

  it('hides lines until they are sung, then writes each word as it starts', () => {
    view.setEffect('write');
    expect(root.classList.contains('writing')).toBe(true);
    view.update(500);
    expect([0, 1, 2].every(unwritten)).toBe(true);
    view.update(1250);
    expect(unwritten(0)).toBe(false);
    expect(unwritten(1)).toBe(true);
    // 正在唱的字墨跡正在落定，還沒唱到的字還沒開始寫
    const [hel, lo] = words(0);
    expect(ink(hel)).toBeGreaterThan(0);
    expect(ink(hel)).toBeLessThan(1);
    expect(ink(lo)).toBe(0);
  });

  it('splits a line without word timing into characters so it can be written one by one', () => {
    expect(words(2)).toHaveLength(0);
    view.setEffect('write');
    expect(words(2).map((w) => w.textContent)).toEqual(['整', '行']);
    expect(lines()[2].classList.contains('no-words')).toBe(false);
  });

  it('hides lines again after seeking back and shows everything when switched back', () => {
    view.setEffect('write');
    view.update(6000);
    expect(unwritten(1)).toBe(false);
    view.update(2000);
    expect(unwritten(1)).toBe(true);
    view.setEffect('fill');
    expect(root.classList.contains('writing')).toBe(false);
    expect([0, 1, 2].some(unwritten)).toBe(false);
    expect(words(2)).toHaveLength(0);
  });
});

describe('clampScroll', () => {
  it('keeps manual scrolling between the first and the last line', () => {
    expect(clampScroll(50, 200, -800)).toBe(50);
    expect(clampScroll(900, 200, -800)).toBe(200);
    expect(clampScroll(-2000, 200, -800)).toBe(-800);
    // 歌詞比畫面短：只能停在第一行的位置
    expect(clampScroll(-50, 200, 300)).toBe(200);
  });
});
