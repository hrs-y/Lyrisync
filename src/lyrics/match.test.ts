import { beforeAll, describe, expect, it } from 'vitest';
import type { PlayerSnapshot } from '../player/types';
import { loadChineseConverter } from './chinese';
import { compareArtists, normalizeForCompare, pickBest, searchTitles, splitArtists } from './match';

const snapshot = (overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  appId: 'Spotify.exe',
  title: 'Night Drive',
  artist: 'Example Band',
  album: 'Somewhere',
  status: 'playing',
  positionMs: 0,
  durationMs: 200_500,
  lastUpdatedMs: 0,
  ...overrides,
});

const candidate = (title: string, durationMs: number, artists: string[] = ['Example Band']) => ({
  title,
  artists,
  durationMs,
});

beforeAll(async () => {
  await loadChineseConverter();
});

describe('searchTitles', () => {
  it('adds a title without Spotify version information', () => {
    expect(searchTitles('Night Drive - Remastered 2011')).toEqual(['Night Drive - Remastered 2011', 'Night Drive']);
    expect(searchTitles('Night Drive (feat. Someone)')).toEqual(['Night Drive (feat. Someone)', 'Night Drive']);
    expect(searchTitles('夜車（Live）')).toEqual(['夜車（Live）', '夜車']);
  });

  it('drops a Japanese-style ～subtitle～', () => {
    expect(searchTitles('START LINE　～はしれ！テスト～')).toEqual(['START LINE　～はしれ！テスト～', 'START LINE']);
  });

  it('leaves ordinary titles alone', () => {
    expect(searchTitles('Night Drive')).toEqual(['Night Drive']);
    expect(searchTitles('Live and Learn')).toEqual(['Live and Learn']);
    expect(searchTitles('Song - Part 2')).toEqual(['Song - Part 2']);
  });
});

describe('normalizeForCompare', () => {
  it('folds full-width characters, case, punctuation and spaces', () => {
    expect(normalizeForCompare('ＮＩＧＨＴ　Drive!')).toBe('nightdrive');
    expect(normalizeForCompare('夜車・Remix')).toBe(normalizeForCompare('夜车 remix'));
  });

  it('treats Traditional and Simplified Chinese as the same', () => {
    expect(normalizeForCompare('一樣的月光')).toBe(normalizeForCompare('一样的月光'));
    expect(normalizeForCompare('徐佳瑩')).toBe(normalizeForCompare('徐佳莹'));
  });

  it('keeps titles that are only symbols', () => {
    expect(normalizeForCompare('!!!')).toBe('!!!');
  });
});

describe('artists', () => {
  it('splits featured and joined artists', () => {
    expect(splitArtists('主唱一 with The Band')).toEqual(['主唱一', 'The Band']);
    expect(splitArtists('A, B & C feat. D')).toEqual(['A', 'B', 'C', 'D']);
    expect(splitArtists('甲、乙／丙')).toEqual(['甲', '乙', '丙']);
  });

  it('matches when any artist overlaps, in any order or script', () => {
    expect(compareArtists(['The Band', '主唱一'], '主唱一 with The Band')).toBe('match');
    expect(compareArtists(['测试歌手'], '測試歌手')).toBe('match');
    expect(compareArtists(['Someone Else'], 'Example Band')).toBe('mismatch');
    expect(compareArtists([], 'Example Band')).toBe('unknown');
  });

  it('cannot compare a romanized name with one written in the original script', () => {
    expect(compareArtists(['ウルトラテストバンド'], 'ultra test band')).toBe('cross-script');
    // 反過來（Spotify 是中文、來源是英文名）多半是翻唱，不放寬
    expect(compareArtists(['Cover Singer'], '測試樂團')).toBe('mismatch');
  });
});

describe('pickBest', () => {
  it('prefers the closest duration', () => {
    const best = pickBest([candidate('Night Drive', 197_000), candidate('Night Drive', 200_400)], snapshot());
    expect(best?.durationMs).toBe(200_400);
  });

  it('rejects candidates whose title or duration does not match', () => {
    expect(pickBest([candidate('Another Song', 200_500)], snapshot())).toBeNull();
    expect(pickBest([candidate('Night Drive', 206_000)], snapshot())).toBeNull();
  });

  it('accepts a romanized artist name only when the length is within 1.5 seconds', () => {
    const current = snapshot({ artist: 'ultra test band' });
    expect(pickBest([candidate('Night Drive', 201_500, ['ウルトラテストバンド'])], current)).not.toBeNull();
    expect(pickBest([candidate('Night Drive', 202_500, ['ウルトラテストバンド'])], current)).toBeNull();
  });

  it('rejects covers by other artists', () => {
    expect(pickBest([candidate('Night Drive (cover)', 200_500, ['Cover Singer'])], snapshot())).toBeNull();
  });

  it('applies a tighter duration limit when asked', () => {
    expect(pickBest([candidate('Night Drive', 203_800)], snapshot())).not.toBeNull();
    expect(pickBest([candidate('Night Drive', 203_800)], snapshot(), { maxDurationDiffMs: 3000 })).toBeNull();
  });

  it('matches against the cleaned title', () => {
    const best = pickBest([candidate('Night Drive', 200_000)], snapshot({ title: 'Night Drive - Remastered 2011' }));
    expect(best?.title).toBe('Night Drive');
  });
});
