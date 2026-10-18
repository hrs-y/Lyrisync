import { describe, expect, it } from 'vitest';
import { Spring } from './spring';

const run = (spring: Spring, frameMs: number, totalMs: number) => {
  for (let t = 0; t < totalMs; t += frameMs) spring.step(frameMs);
};

describe('Spring', () => {
  it('settles on the target within about a second', () => {
    const spring = new Spring(0);
    spring.target = 100;
    run(spring, 16.7, 1200);
    expect(spring.value).toBeCloseTo(100, 1);
    expect(spring.settled).toBe(true);
  });

  it('overshoots only slightly', () => {
    const spring = new Spring(0);
    spring.target = 100;
    let peak = 0;
    for (let t = 0; t < 1500; t += 4) {
      spring.step(4);
      peak = Math.max(peak, spring.value);
    }
    expect(peak).toBeGreaterThan(100);
    expect(peak).toBeLessThan(103);
  });

  it('moves the same way at 60 and 144 frames per second', () => {
    const at60 = new Spring(0);
    const at144 = new Spring(0);
    at60.target = at144.target = 100;
    run(at60, 1000 / 60, 300);
    run(at144, 1000 / 144, 300);
    expect(Math.abs(at60.value - at144.value)).toBeLessThan(1.5);
  });

  it('does not jump after a long pause', () => {
    const spring = new Spring(0);
    spring.target = 100;
    spring.step(5000);
    expect(spring.value).toBeLessThan(60);
  });

  it('snaps without animating', () => {
    const spring = new Spring(0);
    spring.target = 50;
    spring.step(16);
    spring.snap(20);
    expect(spring.value).toBe(20);
    expect(spring.target).toBe(20);
    expect(spring.settled).toBe(true);
  });
});
