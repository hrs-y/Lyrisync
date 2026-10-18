import type { QualitySetting } from '../settings';

export type QualityLevel = 'high' | 'medium' | 'low';

/** 每個動畫品質等級開哪些效果 */
export interface QualityProfile {
  level: QualityLevel;
  /** 背景：流動的封面色彩（WebGL），或一張靜態的模糊封面 */
  background: 'animated' | 'static';
  /** 流動背景的更新率 */
  backgroundFps: number;
  /** 歌詞每一行各自用彈簧物理移動；關掉就整塊一起滑動 */
  springs: boolean;
  /** 換行時下面的行依序錯開跟上 */
  stagger: boolean;
  /** 離目前那一行越遠越模糊 */
  depthBlur: boolean;
  /** 唱到的字微微上浮 */
  wordLift: boolean;
  /** 長音的字發光 */
  glow: boolean;
  /** 長音逐個字母浮起 */
  letterEmphasis: boolean;
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
  high: {
    level: 'high',
    background: 'animated',
    backgroundFps: 60,
    springs: true,
    stagger: true,
    depthBlur: true,
    wordLift: true,
    glow: true,
    letterEmphasis: true,
  },
  medium: {
    level: 'medium',
    background: 'animated',
    backgroundFps: 30,
    springs: true,
    stagger: true,
    depthBlur: false,
    wordLift: true,
    glow: true,
    letterEmphasis: false,
  },
  low: {
    level: 'low',
    background: 'static',
    backgroundFps: 0,
    springs: false,
    stagger: false,
    depthBlur: false,
    wordLift: false,
    glow: false,
    letterEmphasis: false,
  },
};

export interface QualityEnvironment {
  /** 系統設定了「減少動態效果」 */
  reducedMotion: boolean;
  /** 能建立 WebGL */
  webgl: boolean;
}

/** 起始等級：手動選的就照選的；「自動」看系統是否要求減少動態、能不能用 WebGL。 */
export function initialLevel(setting: QualitySetting, env: QualityEnvironment): QualityLevel {
  if (setting !== 'auto') return setting;
  if (env.reducedMotion) return 'low';
  return env.webgl ? 'high' : 'medium';
}

/** 平均影格時間超過這個值就降一級（高：低於約 45fps；中：低於約 33fps） */
const DOWNGRADE_FRAME_MS: Record<QualityLevel, number> = { high: 22, medium: 30, low: Infinity };
/** 超過這個值的影格當成偶發卡頓（例如視窗剛切回來），不列入計算 */
const HITCH_MS = 200;

/**
 * 「自動」模式的掉幀偵測：每累積一段時間算一次平均影格時間，太慢就建議降一級。
 * 只會往下降，避免在兩個等級之間來回跳。
 */
export class FrameMonitor {
  private total = 0;
  private count = 0;
  private warmup: number;

  constructor(
    private readonly windowMs = 4000,
    private readonly warmupMs = 2000,
  ) {
    this.warmup = warmupMs;
  }

  /** 換等級後重新開始量（新等級的前幾秒通常有編譯著色器等額外負擔）。 */
  reset(): void {
    this.total = 0;
    this.count = 0;
    this.warmup = this.warmupMs;
  }

  /** 每個影格呼叫一次；建議降級時回傳新的等級。 */
  push(frameMs: number, level: QualityLevel): QualityLevel | null {
    if (frameMs <= 0 || frameMs > HITCH_MS) return null;
    if (this.warmup > 0) {
      this.warmup -= frameMs;
      return null;
    }
    this.total += frameMs;
    this.count++;
    if (this.total < this.windowMs) return null;
    const average = this.total / this.count;
    this.total = 0;
    this.count = 0;
    if (average <= DOWNGRADE_FRAME_MS[level]) return null;
    return level === 'high' ? 'medium' : 'low';
  }
}
