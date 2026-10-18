import { describe, expect, it } from 'vitest';
import { FrameMonitor, initialLevel, QUALITY_PROFILES } from './quality';

describe('initialLevel', () => {
  it('follows a manual choice', () => {
    expect(initialLevel('medium', { reducedMotion: true, webgl: false })).toBe('medium');
  });

  it('starts automatic mode from the environment', () => {
    expect(initialLevel('auto', { reducedMotion: false, webgl: true })).toBe('high');
    expect(initialLevel('auto', { reducedMotion: false, webgl: false })).toBe('medium');
    expect(initialLevel('auto', { reducedMotion: true, webgl: true })).toBe('low');
  });
});

describe('QUALITY_PROFILES', () => {
  it('only turns on the expensive effects at the high level', () => {
    expect(QUALITY_PROFILES.high).toMatchObject({ depthBlur: true, letterEmphasis: true, backgroundFps: 60 });
    expect(QUALITY_PROFILES.medium).toMatchObject({ depthBlur: false, letterEmphasis: false, backgroundFps: 30 });
    expect(QUALITY_PROFILES.low).toMatchObject({ background: 'static', springs: false, glow: false });
  });
});

describe('FrameMonitor', () => {
  const feed = (monitor: FrameMonitor, frameMs: number, totalMs: number, level: 'high' | 'medium' | 'low') => {
    let suggestion = null;
    for (let t = 0; t < totalMs; t += frameMs) suggestion = monitor.push(frameMs, level) ?? suggestion;
    return suggestion;
  };

  it('stays put while frames are fast enough', () => {
    expect(feed(new FrameMonitor(1000, 0), 16.7, 3000, 'high')).toBeNull();
  });

  it('suggests one level lower when the average frame is too slow', () => {
    expect(feed(new FrameMonitor(1000, 0), 28, 1100, 'high')).toBe('medium');
    expect(feed(new FrameMonitor(1000, 0), 40, 1100, 'medium')).toBe('low');
    expect(feed(new FrameMonitor(1000, 0), 60, 1100, 'low')).toBeNull();
  });

  it('ignores the warm-up period and one-off hitches', () => {
    const monitor = new FrameMonitor(1000, 500);
    expect(feed(monitor, 40, 480, 'high')).toBeNull();
    expect(monitor.push(1500, 'high')).toBeNull();
    expect(feed(monitor, 16, 1100, 'high')).toBeNull();
  });
});
