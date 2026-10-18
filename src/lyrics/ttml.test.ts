// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseTtml, parseTtmlTime } from './ttml';

const TTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
<head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/><ttm:agent type="group" xml:id="v1000"/></metadata></head>
<body><div>
<p begin="00:01.000" end="00:03.000" ttm:agent="v1"><span begin="00:01.000" end="00:01.500">Hel</span><span begin="00:01.500" end="00:02.000">lo</span> <span begin="00:02.000" end="00:03.000">there</span><span ttm:role="x-translation" xml:lang="zh-TW">你好</span></p>
<p begin="00:04.000" end="00:06.000" ttm:agent="v2"><span begin="00:04.000" end="00:05.000">Second</span><span begin="00:05.000" end="00:06.000"> voice</span><span ttm:role="x-bg" begin="00:05.500" end="00:06.500"><span begin="00:05.500" end="00:06.000">(echo</span><span begin="00:06.000" end="00:06.500"> back)</span></span></p>
<p begin="00:07.000" end="00:08.000" ttm:agent="v1000"><span begin="00:07.000" end="00:08.000">Everyone</span></p>
<p begin="9.5" end="11s">Line level only</p>
</div></body></tt>`;

describe('parseTtmlTime', () => {
  it('reads clock and offset times', () => {
    expect(parseTtmlTime('01:02.345')).toBe(62_345);
    expect(parseTtmlTime('1:02:03.5')).toBe(3_723_500);
    expect(parseTtmlTime('9.5')).toBe(9500);
    expect(parseTtmlTime('12.5s')).toBe(12_500);
    expect(parseTtmlTime('350ms')).toBe(350);
  });

  it('returns null for anything else', () => {
    expect(parseTtmlTime('')).toBeNull();
    expect(parseTtmlTime(null)).toBeNull();
    expect(parseTtmlTime('soon')).toBeNull();
  });
});

describe('parseTtml', () => {
  const lines = parseTtml(TTML);

  it('reads words and keeps the space between them', () => {
    expect(lines[0].text).toBe('Hello there');
    expect(lines[0].words?.map((w) => w.text)).toEqual(['Hel', 'lo ', 'there']);
    expect(lines[0].words?.[2]).toEqual({ text: 'there', startMs: 2000, endMs: 3000 });
    expect(lines[0].translation).toBe('你好');
    expect(lines[0].alignEnd).toBeUndefined();
  });

  it('puts the second singer on the right, but not the group', () => {
    expect(lines[1].alignEnd).toBe(true);
    expect(lines[2].alignEnd).toBeUndefined();
  });

  it('reads background vocals without their brackets', () => {
    expect(lines[1].text).toBe('Second voice');
    expect(lines[1].background).toEqual({
      text: 'echo back',
      startMs: 5500,
      endMs: 6500,
      words: [
        { text: 'echo', startMs: 5500, endMs: 6000 },
        { text: ' back', startMs: 6000, endMs: 6500 },
      ],
    });
  });

  it('reads line-level paragraphs', () => {
    expect(lines[3]).toEqual({ startMs: 9500, endMs: 11_000, text: 'Line level only' });
  });
});
