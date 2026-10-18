/** 誤差超過這個值就直接跳過去（例如使用者拖了進度條），否則慢慢追上。 */
export const JUMP_THRESHOLD_MS = 350;
/** 小誤差要花多久追平，避免歌詞抖動。 */
const SLEW_DURATION_MS = 600;

export interface ClockTime {
  /** 單調時間（毫秒），用來推算經過多久 */
  perf(): number;
  /** 系統時間（Unix 毫秒），用來換算 Spotify 回報的 lastUpdatedMs */
  wall(): number;
}

export const systemTime: ClockTime = {
  perf: () => performance.now(),
  wall: () => Date.now(),
};

export interface ProgressReport {
  positionMs: number;
  lastUpdatedMs: number;
  playing: boolean;
  durationMs: number;
}

/** 用 SMTC 偶爾回報的進度，推算「現在播到哪裡」。 */
export class PlaybackClock {
  private basePos = 0;
  private basePerf = 0;
  private playing = false;
  private durationMs = 0;
  private correction = 0;
  private correctionStart = 0;

  constructor(private readonly time: ClockTime = systemTime) {}

  /**
   * 用一份回報重新對時，回傳回報值減掉原本推算值的誤差（毫秒）。
   * 換歌時傳 `forceJump`，直接對齊、不做平滑。
   */
  sync(report: ProgressReport, forceJump = false): number {
    const perf = this.time.perf();
    let target = report.positionMs;
    if (report.playing && report.lastUpdatedMs > 0) {
      // 回報的是 lastUpdatedMs 那一刻的進度，要補上之後經過的時間
      target += Math.max(0, this.time.wall() - report.lastUpdatedMs);
    }
    if (report.durationMs > 0) target = Math.min(target, report.durationMs);
    target = Math.max(0, target);

    const current = this.now();
    const drift = target - current;
    const smooth = !forceJump && this.playing && report.playing && Math.abs(drift) <= JUMP_THRESHOLD_MS;
    if (smooth) {
      // 先停在目前位置，把誤差攤到接下來 SLEW_DURATION_MS 內補上
      this.basePos = current;
      this.correction = drift;
      this.correctionStart = perf;
    } else {
      this.basePos = target;
      this.correction = 0;
    }
    this.basePerf = perf;
    this.playing = report.playing;
    this.durationMs = report.durationMs;
    return drift;
  }

  /** 目前推算的播放位置（毫秒）。 */
  now(): number {
    const perf = this.time.perf();
    let pos = this.basePos;
    if (this.playing) pos += perf - this.basePerf;
    if (this.correction !== 0) {
      pos += this.correction * Math.min(1, (perf - this.correctionStart) / SLEW_DURATION_MS);
    }
    return this.durationMs > 0 ? Math.min(pos, this.durationMs) : pos;
  }
}
