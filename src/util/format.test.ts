import { describe, expect, it } from 'vitest';
import { formatClock, formatTime, signed, signedSeconds } from './format';

describe('formatClock', () => {
  it('shows minutes and seconds, rounding down like Spotify', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59_999)).toBe('0:59');
    expect(formatClock(61_000)).toBe('1:01');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });

  it('treats invalid values as zero', () => {
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });
});

describe('debug formats', () => {
  it('keeps milliseconds and signs', () => {
    expect(formatTime(62_345)).toBe('1:02.345');
    expect(signed(120)).toBe('+120');
    expect(signedSeconds(-166)).toBe('-0.166s');
  });
});
