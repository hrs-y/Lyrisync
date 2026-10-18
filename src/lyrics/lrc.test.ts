import { describe, expect, it } from 'vitest';
import { parseLrc } from './lrc';

describe('parseLrc', () => {
  it('parses line timestamps and ends each line where the next one starts', () => {
    const { synced, lines } = parseLrc('[00:01.00]第一行\n[00:03.50]第二行', 10_000);
    expect(synced).toBe(true);
    expect(lines).toEqual([
      { startMs: 1000, endMs: 3500, text: '第一行' },
      { startMs: 3500, endMs: 10_000, text: '第二行' },
    ]);
  });

  it('reads fractions of any length and colon separators', () => {
    const { lines } = parseLrc(['[00:01.5]a', '[00:02.05]b', '[00:03.123]c', '[01:02]d', '[00:04:50]e'].join('\n'));
    expect(lines.map((l) => l.startMs)).toEqual([1500, 2050, 3123, 4500, 62_000]);
  });

  it('repeats a line that has several timestamps and sorts by time', () => {
    const { lines } = parseLrc('[00:01.00][00:10.00]副歌\n[00:05.00]主歌');
    expect(lines.map((l) => [l.startMs, l.text])).toEqual([
      [1000, '副歌'],
      [5000, '主歌'],
      [10_000, '副歌'],
    ]);
  });

  it('collects tags and shows lyrics earlier for a positive offset', () => {
    const { tags, lines } = parseLrc('[ar:測試歌手]\n[offset:500]\n[00:02.00]歌詞');
    expect(tags).toEqual({ ar: '測試歌手', offset: '500' });
    expect(lines[0].startMs).toBe(1500);
  });

  it('uses an empty timestamped line only to end the previous line', () => {
    const { lines } = parseLrc('[00:01.00]間奏前\n[00:04.00]\n[00:09.00]間奏後');
    expect(lines).toHaveLength(2);
    expect(lines[0].endMs).toBe(4000);
    expect(lines[1].startMs).toBe(9000);
  });

  it('keeps the spaces between words in enhanced LRC', () => {
    const { lines } = parseLrc('[00:01.00]<00:01.00>Hello <00:01.60>there<00:02.20>');
    expect(lines[0].text).toBe('Hello there');
    expect(lines[0].words).toEqual([
      { text: 'Hello ', startMs: 1000, endMs: 1600 },
      { text: 'there', startMs: 1600, endMs: 2200 },
    ]);
  });

  it('treats text without timestamps as unsynced lyrics', () => {
    const { synced, lines } = parseLrc('沒有時間軸的第一行\n第二行\n');
    expect(synced).toBe(false);
    expect(lines.map((l) => l.text)).toEqual(['沒有時間軸的第一行', '第二行']);
  });

  it('handles CRLF and drops untimed lines inside synced lyrics', () => {
    const { lines } = parseLrc('[00:01.00]A\r\n[Chorus]\r\n[00:02.00]B\r\n');
    expect(lines.map((l) => l.text)).toEqual(['A', 'B']);
  });
});
