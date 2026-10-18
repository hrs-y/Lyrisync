import type { LyricWord } from '../lyrics/model';
import { synthesizeWords } from '../ui/writing';

/** 剛寫下的字從微微模糊、稍低的位置落定所花的時間（和主畫面的書寫效果一樣） */
const INK_MS = 420;

interface InkWord {
  el: HTMLElement;
  startMs: number;
  endMs: number;
  /** 已經寫進 CSS 變數的值；-1 代表還沒寫過 */
  fill: number;
  ink: number;
  dry: boolean;
}

/**
 * 桌面歌詞的書寫效果：還沒唱到的字看不到，唱到的字由左往右寫出來（--p），
 * 剛寫下的字從微微模糊、稍低的位置落定（--ink）。寫完、墨跡也落定的字拿掉遮罩與濾鏡（.dry），省得每個影格重畫。
 * 沒有逐字時間的文字（逐行歌詞、翻譯）依字數估計每個字的時間。
 */
export class WritingLine {
  readonly el = document.createElement('div');
  private words: InkWord[] = [];

  constructor(className = '') {
    this.el.className = className ? `ink-line ${className}` : 'ink-line';
  }

  /** 換成另一段文字；words 為空時依字數在 startMs～endMs 之間估計每個字的時間。 */
  set(text: string, words: readonly LyricWord[] | undefined, startMs: number, endMs: number): void {
    this.words = [];
    this.el.replaceChildren();
    const timed = words?.length ? words : synthesizeWords(text, startMs, endMs);
    for (const word of timed) {
      // 字前後的空白拆成文字節點：inline-block 會把結尾的空白吃掉，單字就黏在一起了
      const [, leading, core, trailing] = /^(\s*)([\s\S]*?)(\s*)$/.exec(word.text)!;
      if (leading) this.el.append(leading);
      if (core) {
        const span = document.createElement('span');
        span.className = 'ink-w';
        span.textContent = core;
        this.el.append(span);
        this.words.push({ el: span, startMs: word.startMs, endMs: word.endMs, fill: -1, ink: -1, dry: false });
      }
      if (trailing) this.el.append(trailing);
    }
  }

  /** 每個影格呼叫。 */
  update(timeMs: number): void {
    for (const word of this.words) {
      const duration = word.endMs - word.startMs;
      const elapsed = timeMs - word.startMs;
      const fill = duration > 0 ? clamp01(elapsed / duration) : elapsed >= 0 ? 1 : 0;
      const ink = smoothstep(clamp01(elapsed / INK_MS));
      word.fill = writeVar(word.el, '--p', fill, word.fill);
      word.ink = writeVar(word.el, '--ink', ink, word.ink);
      // 往回跳轉時要再變回沒寫過
      const dry = word.fill === 1 && word.ink === 1;
      if (dry !== word.dry) {
        word.dry = dry;
        word.el.classList.toggle('dry', dry);
      }
    }
  }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** 緩起緩停 */
const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** 寫入 CSS 變數（取到小數第三位）；和上次寫的一樣就不碰 DOM。回傳這次的值。 */
function writeVar(el: HTMLElement, name: string, value: number, previous: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded !== previous) el.style.setProperty(name, String(rounded));
  return rounded;
}
