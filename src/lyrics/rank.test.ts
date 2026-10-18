import { describe, expect, it } from 'vitest';
import type { PlayerSnapshot } from '../player/types';
import type { Lyrics, LyricsSource } from './model';
import { isBestPossible, rankLyrics } from './rank';

const snapshot = { durationMs: 200_000 } as PlayerSnapshot;

function lyrics(source: LyricsSource, kind: 'word' | 'line' | 'plain', durationMs = 200_000): Lyrics {
  const word = { text: '字', startMs: 0, endMs: 100 };
  return {
    source,
    synced: kind !== 'plain',
    lines: [{ startMs: 0, endMs: 100, text: '字', ...(kind === 'word' ? { words: [word] } : {}) }],
    matched: { title: 't', artist: 'a', durationMs },
  };
}

const order = (list: Lyrics[]) => rankLyrics(list, snapshot).map((l) => `${l.source}:${l.lines[0].words ? 'word' : l.synced ? 'line' : 'plain'}`);

describe('rankLyrics', () => {
  it('prefers word timing over line timing over plain text', () => {
    expect(order([lyrics('lrclib', 'plain'), lyrics('lrclib', 'line'), lyrics('kugou', 'word')])).toEqual([
      'kugou:word',
      'lrclib:line',
      'lrclib:plain',
    ]);
  });

  it('prefers AMLL, then NetEase, then Kugou for word timing', () => {
    expect(order([lyrics('kugou', 'word'), lyrics('ttml-db', 'word'), lyrics('netease', 'word')])).toEqual([
      'ttml-db:word',
      'netease:word',
      'kugou:word',
    ]);
  });

  it('prefers a closer duration within the same level', () => {
    expect(order([lyrics('netease', 'line', 203_000), lyrics('lrclib', 'line', 200_000)])).toEqual([
      'lrclib:line',
      'netease:line',
    ]);
  });

  it('does not change the input array', () => {
    const list = [lyrics('lrclib', 'line'), lyrics('kugou', 'word')];
    rankLyrics(list, snapshot);
    expect(list[0].source).toBe('lrclib');
  });
});

describe('isBestPossible', () => {
  it('is only true for AMLL word timing', () => {
    expect(isBestPossible(lyrics('ttml-db', 'word'))).toBe(true);
    expect(isBestPossible(lyrics('ttml-db', 'line'))).toBe(false);
    expect(isBestPossible(lyrics('netease', 'word'))).toBe(false);
  });
});
