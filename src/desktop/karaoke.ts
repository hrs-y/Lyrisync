import type { LyricLine } from '../lyrics/model';

export interface WordBox {
  left: number;
  width: number;
}

/** 量一個元素在行內的位置（測試時可以換成假的） */
export type Measure = (el: HTMLElement) => WordBox;

const layoutMeasure: Measure = (el) => ({ left: el.offsetLeft, width: el.offsetWidth });

interface WordSlot {
  startMs: number;
  endMs: number;
  span: HTMLElement;
  box: WordBox;
}

/**
 * 桌面歌詞的一行，卡拉 OK 式填色：底下一層是白字（有深色描邊，任何桌布上都看得清楚），
 * 上面疊一層同樣的字、塗成強調色，再用遮罩只露出唱過的部分。遮罩的位置由每個字的位置與演唱進度算出，
 * 所以填色會停在字的中間、跟著歌聲前進。只有逐行時間的行，開唱時整行一起亮。
 */
export class KaraokeLine {
  readonly el = document.createElement('div');
  private readonly base = document.createElement('span');
  private readonly fill = document.createElement('span');
  private words: WordSlot[] = [];
  private line: LyricLine | null = null;
  private width = 0;
  private written = NaN;

  constructor(private readonly measure: Measure = layoutMeasure) {
    this.el.className = 'karaoke';
    this.base.className = 'karaoke-base';
    this.fill.className = 'karaoke-fill';
    this.fill.setAttribute('aria-hidden', 'true');
    this.el.append(this.base, this.fill);
  }

  /** 換成另一行；line 為 null 時顯示一般文字（例如歌名），不會填色。 */
  set(line: LyricLine | null, text = ''): void {
    this.line = line;
    this.words = [];
    this.base.replaceChildren();
    this.fill.replaceChildren();
    if (line?.words?.length) {
      for (const word of line.words) {
        const span = document.createElement('span');
        span.textContent = word.text;
        this.base.append(span);
        const copy = document.createElement('span');
        copy.textContent = word.text;
        this.fill.append(copy);
        this.words.push({ startMs: word.startMs, endMs: word.endMs, span, box: { left: 0, width: 0 } });
      }
    } else {
      const content = line?.text ?? text;
      this.base.textContent = content;
      this.fill.textContent = content;
    }
    this.remeasure();
  }

  /** 字型或字級改變後，重新量每個字的位置 */
  remeasure(): void {
    for (const word of this.words) word.box = this.measure(word.span);
    this.width = this.measure(this.base).width;
    this.written = NaN;
  }

  /** 每個影格呼叫：算出唱到行內哪個位置（像素），寫進 --x。 */
  update(timeMs: number): void {
    const x = this.sungWidth(timeMs);
    const rounded = Math.round(x * 10) / 10;
    if (rounded === this.written) return;
    this.written = rounded;
    this.el.style.setProperty('--x', `${rounded}px`);
  }

  private sungWidth(timeMs: number): number {
    const line = this.line;
    if (!line) return 0;
    if (!this.words.length) return timeMs >= line.startMs ? this.width : 0;
    let x = 0;
    for (const word of this.words) {
      if (timeMs >= word.endMs) {
        x = word.box.left + word.box.width;
        continue;
      }
      if (timeMs > word.startMs) {
        const progress = (timeMs - word.startMs) / Math.max(1, word.endMs - word.startMs);
        x = word.box.left + progress * word.box.width;
      }
      break;
    }
    return x;
  }
}
