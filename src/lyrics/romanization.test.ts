import { describe, expect, it } from 'vitest';
import type { LyricLine, Lyrics, LyricsSource } from './model';
import { borrowRomanization, findRomanizationDonor, romanizationCoverage } from './romanization';

const line = (startMs: number, text: string, romanization?: string): LyricLine => ({
  startMs,
  endMs: startMs + 1000,
  text,
  ...(romanization ? { romanization, romanizationWords: [{ text: romanization, startMs, endMs: startMs + 1000 }] } : {}),
});

const lyrics = (source: LyricsSource, lines: LyricLine[], synced = true): Lyrics => ({ source, synced, lines });

describe('romanization borrowing', () => {
  const target = lyrics('ttml-db', [line(1000, 'いち'), line(3000, 'に')]);
  const donor = lyrics('qq', [line(1020, 'いち', 'ichi'), line(2980, 'に', 'ni')]);
  const partial = lyrics('netease', [line(1000, 'いち', 'ichi'), line(3000, 'に')]);

  it('measures how many lines have romanization', () => {
    expect(romanizationCoverage(target)).toBe(0);
    expect(romanizationCoverage(partial)).toBe(0.5);
    expect(romanizationCoverage(donor)).toBe(1);
  });

  it('borrows from the first version that covers at least half the lines', () => {
    expect(findRomanizationDonor(target, [target, partial, donor])).toBe(partial);
    expect(findRomanizationDonor(target, [target])).toBeNull();
    // 自己已經有羅馬拼音、或沒有時間軸時不借
    expect(findRomanizationDonor(donor, [donor, partial])).toBeNull();
    expect(findRomanizationDonor(lyrics('lrclib', [line(0, 'x')], false), [donor])).toBeNull();
  });

  it('attaches the donor romanization by time without changing the original', () => {
    const borrowed = borrowRomanization(target, donor);
    expect(borrowed.lines.map((l) => l.romanization)).toEqual(['ichi', 'ni']);
    expect(borrowed.lines[0].romanizationWords?.[0].startMs).toBe(1020);
    expect(target.lines[0].romanization).toBeUndefined();
    expect(borrowRomanization(target, null)).toBe(target);
  });
});
