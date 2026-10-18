import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClockTime } from './clock';
import { PlayerTracker } from './tracker';
import type { PlayerSnapshot } from './types';

function setup() {
  let perf = 1000;
  let wall = 1_700_000_000_000;
  const time: ClockTime = { perf: () => perf, wall: () => wall };
  const changes: Array<string | null> = [];
  const tracker = new PlayerTracker({
    time,
    onTrackChange: (snapshot) => changes.push(snapshot?.title ?? null),
    onLog: () => {},
  });
  const advance = (ms: number) => {
    perf += ms;
    wall += ms;
    vi.advanceTimersByTime(ms);
  };
  const send = (overrides: Partial<PlayerSnapshot>) =>
    tracker.handle({
      capturedMs: wall,
      snapshot: {
        appId: 'Spotify.exe',
        title: '歌曲 A',
        artist: '歌手',
        album: '專輯',
        status: 'playing',
        positionMs: 0,
        durationMs: 200_000,
        lastUpdatedMs: wall,
        ...overrides,
      },
    });
  return { tracker, changes, advance, send };
}

describe('PlayerTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds a reset to zero until the title catches up', () => {
    const { tracker, changes, advance, send } = setup();
    send({ positionMs: 60_000 });
    advance(2000);
    send({ positionMs: 0 }); // 歌名還沒變，進度先歸零
    expect(tracker.clock.now()).toBe(62_000);
    advance(300);
    send({ title: '歌曲 B', positionMs: 0 });
    expect(changes).toEqual(['歌曲 A', '歌曲 B']);
    expect(tracker.clock.now()).toBe(0);
    advance(1000);
    expect(tracker.clock.now()).toBe(1000); // 觀望計時器已取消，不會再跳一次
  });

  it('treats the reset as a restart when the title never changes', () => {
    const { tracker, changes, advance, send } = setup();
    send({ positionMs: 60_000 });
    advance(2000);
    send({ positionMs: 0 });
    advance(800);
    expect(changes).toEqual(['歌曲 A']);
    expect(tracker.clock.now()).toBe(800);
  });

  it('applies a reset right away when this app asked to seek there', () => {
    const { tracker, advance, send } = setup();
    send({ positionMs: 60_000 });
    advance(2000);
    tracker.noteLocalSeek(0);
    send({ positionMs: 0 });
    expect(tracker.clock.now()).toBe(0);
  });

  it('still holds a reset when the recent seek went somewhere else', () => {
    const { tracker, advance, send } = setup();
    send({ positionMs: 60_000 });
    advance(2000);
    tracker.noteLocalSeek(30_000);
    send({ positionMs: 30_000 });
    advance(500);
    send({ positionMs: 0 }); // 跳轉後馬上按下一首
    expect(tracker.clock.now()).toBe(30_500);
  });

  it('applies buffering drift right after a seek instead of easing it in', () => {
    const { tracker, advance, send } = setup();
    send({ positionMs: 60_000 });
    advance(5000);
    tracker.noteLocalSeek(100_000);
    send({ positionMs: 100_000, lastUpdatedMs: 1_700_000_005_000 });
    advance(100);
    // Spotify 還在緩衝：進度只走了 9ms，推算值超前約 90ms
    send({ positionMs: 100_009 });
    expect(tracker.clock.now()).toBe(100_009);
  });

  it('eases small drift in once playback has settled', () => {
    const { tracker, advance, send } = setup();
    send({ positionMs: 60_000 });
    advance(2000); // 已經過了換歌後的緩衝期
    send({ positionMs: 62_100 });
    expect(tracker.clock.now()).toBe(62_000);
  });

  it('ignores events older than the last one handled', () => {
    const { tracker, changes, send } = setup();
    send({ positionMs: 60_000 });
    tracker.handle({ capturedMs: 0, snapshot: null });
    expect(changes).toEqual(['歌曲 A']);
  });
});
