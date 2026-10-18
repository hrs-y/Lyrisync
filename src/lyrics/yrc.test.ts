import { describe, expect, it } from 'vitest';
import { parseYrc } from './yrc';

describe('parseYrc', () => {
  it('reads lines with absolute word times', () => {
    expect(parseYrc('[1000,2000](1000,500,0)Hel(1500,500,0)lo (2000,1000,0)world')).toEqual([
      {
        startMs: 1000,
        endMs: 3000,
        text: 'Hello world',
        words: [
          { text: 'Hel', startMs: 1000, endMs: 1500 },
          { text: 'lo ', startMs: 1500, endMs: 2000 },
          { text: 'world', startMs: 2000, endMs: 3000 },
        ],
      },
    ]);
  });

  it('skips JSON credit lines and blank lines', () => {
    const lines = parseYrc('{"t":0,"c":[{"tx":"作词: "},{"tx":"某人"}]}\n\n[500,1000](500,1000,0)唱');
    expect(lines.map((l) => l.text)).toEqual(['唱']);
  });

  it('keeps parentheses that belong to the lyrics', () => {
    const [line] = parseYrc('[0,3000](0,1000,0)走吧 (1000,1000,0)(oh)(2000,1000,0) 再見');
    expect(line.text).toBe('走吧 (oh) 再見');
    expect(line.words?.map((w) => w.text)).toEqual(['走吧 ', '(oh)', ' 再見']);
  });

  it('merges a whitespace-only word into the previous word', () => {
    const [line] = parseYrc('[0,2000](0,1000,0)Go(1000,0,0) (1000,1000,0)on');
    expect(line.words?.map((w) => w.text)).toEqual(['Go ', 'on']);
  });

  it('keeps lines without word tags and sorts by start time', () => {
    const lines = parseYrc('[5000,1000](5000,1000,0)後\n[0,1000]只有整行');
    expect(lines).toEqual([
      { startMs: 0, endMs: 1000, text: '只有整行' },
      { startMs: 5000, endMs: 6000, text: '後', words: [{ text: '後', startMs: 5000, endMs: 6000 }] },
    ]);
  });
});
