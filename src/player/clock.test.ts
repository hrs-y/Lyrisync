import { describe, expect, it } from 'vitest';
import { PlaybackClock, type ClockTime } from './clock';

function fakeTime(): ClockTime & { advance(ms: number): void } {
  let perf = 1000;
  let wall = 1_700_000_000_000;
  return {
    perf: () => perf,
    wall: () => wall,
    advance(ms) {
      perf += ms;
      wall += ms;
    },
  };
}

describe('PlaybackClock', () => {
  it('adds the time since Spotify last updated the position', () => {
    const time = fakeTime();
    const clock = new PlaybackClock(time);
    clock.sync({ positionMs: 5000, lastUpdatedMs: time.wall() - 2000, playing: true, durationMs: 60_000 });
    expect(clock.now()).toBe(7000);
    time.advance(1500);
    expect(clock.now()).toBe(8500);
  });

  it('stands still while paused', () => {
    const time = fakeTime();
    const clock = new PlaybackClock(time);
    clock.sync({ positionMs: 5000, lastUpdatedMs: time.wall() - 2000, playing: false, durationMs: 60_000 });
    time.advance(3000);
    expect(clock.now()).toBe(5000);
  });

  it('eases small drift in instead of jumping', () => {
    const time = fakeTime();
    const clock = new PlaybackClock(time);
    clock.sync({ positionMs: 10_000, lastUpdatedMs: time.wall(), playing: true, durationMs: 60_000 });
    time.advance(1000);
    const drift = clock.sync({ positionMs: 11_100, lastUpdatedMs: time.wall(), playing: true, durationMs: 60_000 });
    expect(drift).toBe(100);
    expect(clock.now()).toBe(11_000);
    time.advance(300);
    expect(clock.now()).toBe(11_350);
    time.advance(300);
    expect(clock.now()).toBe(11_700);
  });

  it('jumps when the drift is large', () => {
    const time = fakeTime();
    const clock = new PlaybackClock(time);
    clock.sync({ positionMs: 10_000, lastUpdatedMs: time.wall(), playing: true, durationMs: 60_000 });
    clock.sync({ positionMs: 40_000, lastUpdatedMs: time.wall(), playing: true, durationMs: 60_000 });
    expect(clock.now()).toBe(40_000);
  });

  it('never runs past the end of the track', () => {
    const time = fakeTime();
    const clock = new PlaybackClock(time);
    clock.sync({ positionMs: 59_000, lastUpdatedMs: time.wall(), playing: true, durationMs: 60_000 });
    time.advance(5000);
    expect(clock.now()).toBe(60_000);
  });
});
