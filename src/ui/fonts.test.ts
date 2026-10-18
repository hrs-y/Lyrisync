import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { lineLanguage, lyricFontVariables, selectedFonts } from './fonts';

describe('lineLanguage', () => {
  it('tells Japanese, Korean, Chinese and Latin-only lines apart', () => {
    expect(lineLanguage('夜に駆ける')).toBe('ja');
    expect(lineLanguage('사랑해')).toBe('ko');
    expect(lineLanguage('一樣的月光')).toBe('zh');
    expect(lineLanguage('Moon river, wider than a mile')).toBe('en');
    expect(lineLanguage('Canción de amor')).toBe('en');
  });

  it('keeps mixed lines with the CJK language', () => {
    expect(lineLanguage('我們 say goodbye')).toBe('zh');
    expect(lineLanguage('Ready? 行くよ')).toBe('ja');
  });

  it('uses the Japanese font for kanji-only lines of a Japanese song', () => {
    expect(lineLanguage('永遠', true)).toBe('ja');
    expect(lineLanguage('永遠', false)).toBe('zh');
    expect(lineLanguage('Oh yeah', true)).toBe('en');
  });

  it('treats lines without letters as the song language', () => {
    expect(lineLanguage('……')).toBe('zh');
    expect(lineLanguage('♪', true)).toBe('ja');
  });
});

describe('lyricFontVariables', () => {
  it('puts the Latin font first so English words in CJK lines use it', () => {
    const vars = lyricFontVariables(selectedFonts({ fontZh: 'serif', fontJa: 'mincho', fontLatin: 'garamond', lyricBold: true }));
    expect(vars['--lyric-family-zh'].startsWith('"EB Garamond", "Noto Serif TC"')).toBe(true);
    expect(vars['--lyric-family-ja'].startsWith('"EB Garamond", "Shippori Mincho"')).toBe(true);
    expect(vars['--lyric-family-en'].startsWith('"EB Garamond"')).toBe(true);
    expect(vars['--lyric-weight-zh']).toBe('600');
    expect(vars['--lyric-weight-en']).toBe('600');
  });

  it('keeps the system kai font at its regular weight instead of a fake bold', () => {
    const vars = lyricFontVariables(selectedFonts({ ...DEFAULT_SETTINGS, fontZh: 'kai' }));
    expect(vars['--lyric-family-zh']).toContain('"DFKai-SB"');
    expect(vars['--lyric-weight-zh']).toBe('400');
  });

  it('uses each typeface’s lighter weight when bold is off', () => {
    const vars = lyricFontVariables(selectedFonts({ fontZh: 'serif', fontJa: 'maru', fontLatin: 'sans', lyricBold: false }));
    expect(vars['--lyric-weight-zh']).toBe('400');
    expect(vars['--lyric-weight-ja']).toBe('500');
    expect(vars['--lyric-weight-en']).toBe('500');
    expect(vars['--lyric-weight-ko']).toBe('400');
  });

  it('matches the previous look by default', () => {
    const vars = lyricFontVariables(selectedFonts(DEFAULT_SETTINGS));
    expect(vars['--lyric-family-zh'].startsWith('"Segoe UI Variable Display", "Segoe UI", "Microsoft JhengHei UI"')).toBe(true);
    expect(vars['--lyric-weight-zh']).toBe('700');
    expect(vars['--lyric-tracking-zh']).toBe('-0.012em');
  });
});
