import { describe, expect, it } from 'vitest';
import { attachByTime } from './attach';
import type { LyricLine } from './model';

const line = (startMs: number, text: string): LyricLine => ({ startMs, endMs: startMs + 1000, text });

describe('attachByTime', () => {
  it('attaches each translation to the nearest line within a second', () => {
    const lines = [line(1000, 'one'), line(3200, 'two'), line(9000, 'three')];
    attachByTime(lines, '[00:01.20]第一\n[00:03.00]第二\n[00:06.00]太遠了', 'translation');
    expect(lines.map((l) => l.translation)).toEqual(['第一', '第二', undefined]);
  });

  it('uses each translation once and skips blanks and notices', () => {
    const lines = [line(1000, 'one'), line(1300, 'two'), line(5000, 'three')];
    attachByTime(lines, '[00:00.00]TME享有本翻译作品的著作权\n[00:01.00]唯一\n[00:05.00]//', 'translation');
    expect(lines.map((l) => l.translation)).toEqual(['唯一', undefined, undefined]);
  });

  it('does nothing without extra lyrics', () => {
    const lines = [line(1000, 'one')];
    attachByTime(lines, undefined, 'romanization');
    expect(lines[0].romanization).toBeUndefined();
  });
});
