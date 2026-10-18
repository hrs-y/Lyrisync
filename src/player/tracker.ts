import { formatTime, signed } from '../util/format';
import { JUMP_THRESHOLD_MS, PlaybackClock, systemTime, type ClockTime } from './clock';
import { trackKey, type PlayerSnapshot, type SnapshotEvent } from './types';

export type LogKind = 'track' | 'status' | 'position' | 'hold' | 'command' | 'lyrics' | 'spotify' | 'error';

export interface LogEntry {
  /** 系統時間（Unix 毫秒） */
  atMs: number;
  kind: LogKind;
  message: string;
}

/** 進度掉回這個值以下、歌名卻沒變時，先觀望一下。 */
const RESET_POSITION_MS = 1500;
/** 推算位置要超過這個值，「掉回開頭」才算可疑。 */
const RESET_FROM_MS = 3000;
/** 觀望這麼久還沒換歌，就當成真的是從頭播放。 */
const RESET_GRACE_MS = 800;
/** 自己送出跳轉之後這段時間內，跳到目標附近的回報不需要觀望。 */
const LOCAL_SEEK_WINDOW_MS = 1500;
/**
 * 換歌或跳轉之後 Spotify 會緩衝一下，前幾份回報的進度幾乎不動，推算值會超前 100～230ms。
 * 這段時間內的誤差直接套用、不做平滑，讓歌詞馬上對準。
 */
const SETTLE_MS = 1500;
/** 最多保留幾筆進度回報時間（給除錯面板算平均間隔） */
const MAX_REPORTS = 200;

export interface TrackerOptions {
  onTrackChange(snapshot: PlayerSnapshot | null): void;
  onLog(entry: LogEntry): void;
  time?: ClockTime;
}

/**
 * 把 SMTC 快照整理成「現在是哪首歌、播到哪裡」，並記錄事件先後順序供 Phase 0 量測。
 *
 * 換歌時 SMTC 可能先把進度歸零、歌名晚一點才變，舊歌詞會因此被捲回頂部。
 * 所以同一首歌突然掉回開頭時，先觀望 RESET_GRACE_MS 再套用。
 */
export class PlayerTracker {
  readonly clock: PlaybackClock;
  /** 播放中收到進度回報的時間（Unix 毫秒），用來算 Spotify 多久回報一次 */
  readonly positionReports: number[] = [];
  current: PlayerSnapshot | null = null;

  private readonly time: ClockTime;
  private lastCapturedMs = 0;
  private pending: { snapshot: PlayerSnapshot; timer: ReturnType<typeof setTimeout> } | null = null;
  private localSeek: { targetMs: number; at: number } | null = null;
  private settleUntil = -Infinity;

  constructor(private readonly options: TrackerOptions) {
    this.time = options.time ?? systemTime;
    this.clock = new PlaybackClock(this.time);
  }

  /** 自己送出跳轉前呼叫；之後回報的進度如果就是這個目標，就不會被當成換歌的前兆。 */
  noteLocalSeek(targetMs: number): void {
    this.localSeek = { targetMs, at: this.time.perf() };
    this.settleUntil = this.time.perf() + SETTLE_MS;
  }

  private isOwnSeek(positionMs: number): boolean {
    const seek = this.localSeek;
    return (
      seek !== null &&
      this.time.perf() - seek.at <= LOCAL_SEEK_WINDOW_MS &&
      Math.abs(positionMs - seek.targetMs) < RESET_POSITION_MS
    );
  }

  handle(event: SnapshotEvent): void {
    // 比已處理過的還舊（例如補抓的初始狀態比事件晚到），直接丟掉
    if (event.capturedMs < this.lastCapturedMs) return;
    this.lastCapturedMs = event.capturedMs;

    const next = event.snapshot;
    const prev = this.pending?.snapshot ?? this.current;

    if (!next) {
      this.cancelPending();
      if (this.current) this.log(event.capturedMs, 'track', '偵測不到 Spotify');
      this.current = null;
      this.clock.sync({ positionMs: 0, lastUpdatedMs: 0, playing: false, durationMs: 0 }, true);
      this.options.onTrackChange(null);
      return;
    }

    if (!prev || trackKey(prev) !== trackKey(next)) {
      this.cancelPending();
      this.log(
        event.capturedMs,
        'track',
        `換歌：${next.title} — ${next.artist}（進度 ${formatTime(next.positionMs)}，長度 ${formatTime(next.durationMs)}）`,
      );
      this.apply(next, true);
      this.options.onTrackChange(next);
      return;
    }

    const suspicious =
      next.positionMs < RESET_POSITION_MS && this.clock.now() > RESET_FROM_MS && !this.isOwnSeek(next.positionMs);
    if (suspicious || (this.pending && next.positionMs < RESET_POSITION_MS)) {
      this.logChanges(event.capturedMs, prev, next, null);
      if (this.pending) {
        this.pending.snapshot = next;
      } else {
        this.log(event.capturedMs, 'hold', `進度掉回 ${formatTime(next.positionMs)} 但歌名沒變，先觀望 ${RESET_GRACE_MS}ms`);
        this.pending = { snapshot: next, timer: setTimeout(() => this.flushPending(), RESET_GRACE_MS) };
      }
      return;
    }

    this.cancelPending();
    const drift = this.apply(next, this.time.perf() < this.settleUntil);
    this.logChanges(event.capturedMs, prev, next, drift);
  }

  private apply(snapshot: PlayerSnapshot, forceJump: boolean): number {
    this.current = snapshot;
    const drift = this.clock.sync(
      {
        positionMs: snapshot.positionMs,
        lastUpdatedMs: snapshot.lastUpdatedMs,
        playing: snapshot.status === 'playing',
        durationMs: snapshot.durationMs,
      },
      forceJump,
    );
    // 換歌，或在 Spotify 裡拖了進度條（誤差大到直接跳過去）：接下來是緩衝期
    if (forceJump || Math.abs(drift) > JUMP_THRESHOLD_MS) this.settleUntil = this.time.perf() + SETTLE_MS;
    return drift;
  }

  private flushPending(): void {
    if (!this.pending) return;
    const { snapshot } = this.pending;
    this.pending = null;
    this.log(this.time.wall(), 'hold', '觀望結束，歌名沒變：當成從頭播放');
    this.apply(snapshot, true);
  }

  private cancelPending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private logChanges(atMs: number, prev: PlayerSnapshot, next: PlayerSnapshot, drift: number | null): void {
    if (prev.status !== next.status) this.log(atMs, 'status', `狀態：${prev.status} → ${next.status}`);
    if (prev.durationMs !== next.durationMs) {
      this.log(atMs, 'position', `長度：${formatTime(prev.durationMs)} → ${formatTime(next.durationMs)}`);
    }
    if (prev.positionMs !== next.positionMs || prev.lastUpdatedMs !== next.lastUpdatedMs) {
      if (next.status === 'playing') {
        this.positionReports.push(atMs);
        if (this.positionReports.length > MAX_REPORTS) this.positionReports.shift();
      }
      const age = next.lastUpdatedMs > 0 ? `${atMs - next.lastUpdatedMs}ms 前更新` : '沒有更新時間';
      const driftText = drift === null ? '' : `，誤差 ${signed(drift)}ms`;
      this.log(atMs, 'position', `進度回報：${formatTime(next.positionMs)}（${age}${driftText}）`);
    }
  }

  private log(atMs: number, kind: LogEntry['kind'], message: string): void {
    this.options.onLog({ atMs, kind, message });
  }
}
