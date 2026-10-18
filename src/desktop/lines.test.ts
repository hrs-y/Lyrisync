import { describe, expect, it } from 'vitest';
import type { LyricLine, Lyrics } from '../lyrics/model';
import { pickLines } from './lines';

// 測試用的歌詞都是自己編的
const line = (startMs: number, text: string, extra: Partial<LyricLine> = {}): LyricLine => ({
  startMs,
  endMs: startMs + 3000,
  text,
  ...extra,
});

const lyrics = (lines: LyricLine[], synced = true): Lyrics => ({ source: 'demo', synced, lines });

const both = { showTranslation: true, showRomanization: true };

describe('pickLines', () => {
  const song = lyrics([
    line(1000, '第一句', { romanization: 'dai ichi ku', translation: 'line one' }),
    line(5000, '第二句', { translation: 'line two' }),
    line(9000, '第三句'),
  ]);

  it('shows the first line (not yet lit) before the song reaches it', () => {
    const picked = pickLines(song, 0, both);
    expect(picked.index).toBe(-1);
    expect(picked.line?.text).toBe('第一句');
  });

  it('prefers romanization, then translation, then previews the next line', () => {
    expect(pickLines(song, 1500, both)).toMatchObject({ index: 0, secondary: 'dai ichi ku', secondaryKind: 'romanization' });
    expect(pickLines(song, 5500, both)).toMatchObject({ index: 1, secondary: 'line two', secondaryKind: 'translation' });
    expect(pickLines(song, 1500, { showTranslation: true, showRomanization: false })).toMatchObject({
      secondary: 'line one',
      secondaryKind: 'translation',
    });
    expect(pickLines(song, 1500, { showTranslation: false, showRomanization: false })).toMatchObject({
      secondary: '第二句',
      secondaryKind: 'next',
    });
  });

  it('does not preview the next line for the writing effect, but still writes romanization or a translation', () => {
    const writing = { showTranslation: false, showRomanization: false, previewNext: false };
    expect(pickLines(song, 1500, writing)).toMatchObject({ secondary: '', secondaryKind: 'none' });
    expect(pickLines(song, 5500, { ...both, previewNext: false })).toMatchObject({ secondaryKind: 'translation' });
  });

  it('passes on word timing for romanization', () => {
    const romaWords = [
      { text: 'ko ', startMs: 1000, endMs: 1500 },
      { text: 'ko', startMs: 1500, endMs: 2000 },
    ];
    const timed = lyrics([line(1000, 'ここ', { romanization: 'ko ko', romanizationWords: romaWords })]);
    expect(pickLines(timed, 1200, both).secondaryWords).toBe(romaWords);
  });

  it('keeps the last sung line during a break and has nothing to preview after the last line', () => {
    expect(pickLines(song, 4900, both).line?.text).toBe('第一句');
    expect(pickLines(song, 20_000, both)).toMatchObject({ index: 2, secondary: '', secondaryKind: 'none' });
  });

  it('returns nothing for unsynced or empty lyrics', () => {
    expect(pickLines(lyrics([line(0, '純文字')], false), 0, both)).toEqual({
      index: -1,
      line: null,
      secondary: '',
      secondaryKind: 'none',
    });
    expect(pickLines(lyrics([]), 0, both).line).toBeNull();
  });
});
