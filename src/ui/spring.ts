export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass?: number;
}

/** 歌詞捲動：約 0.6 秒停穩，帶一點點過衝，比單純的緩動曲線更有重量感 */
export const LYRIC_SPRING: SpringConfig = { stiffness: 120, damping: 19 };

/** 單一數值的彈簧；用固定小步長積分，結果不受影格率影響。 */
export class Spring {
  value: number;
  target: number;
  velocity = 0;

  constructor(
    value = 0,
    private readonly config: SpringConfig = LYRIC_SPRING,
  ) {
    this.value = value;
    this.target = value;
  }

  /** 推進 dtMs 毫秒；單次最多推進 64ms，避免視窗切回來時一次跳太遠。 */
  step(dtMs: number): void {
    const { stiffness, damping, mass = 1 } = this.config;
    let remaining = Math.min(Math.max(dtMs, 0), 64) / 1000;
    while (remaining > 0) {
      const h = Math.min(remaining, 1 / 240);
      const force = -stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += (force / mass) * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
  }

  get settled(): boolean {
    return Math.abs(this.value - this.target) < 0.05 && Math.abs(this.velocity) < 0.05;
  }

  /** 直接停在某個位置，不做動畫。 */
  snap(value = this.target): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }
}
