import { joinWords, tidyWords, type LyricLine, type LyricWord } from './model';

export interface ParsedLrc {
  synced: boolean;
  lines: LyricLine[];
  /** [ti:]、[ar:]、[offset:] 之類的標籤，key 一律小寫 */
  tags: Record<string, string>;
}

const TIME_TAG = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const META_TAG = /^\[([a-zA-Z#]+):([^\]]*)\]$/;
/** 增強型 LRC 的逐字時間 <mm:ss.xx>，split 後的分組依序是 分、秒、小數 */
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/;
/** 最後一行沒有下一行可參考、也不知道歌曲長度時，預設顯示多久 */
const LAST_LINE_MS = 5000;

function toMs(minutes: string, seconds: string, fraction: string | undefined): number {
  // 小數位數不固定：.5 = 500ms、.05 = 50ms、.123 = 123ms
  const millis = fraction ? Number(fraction.padEnd(3, '0').slice(0, 3)) : 0;
  return Number(minutes) * 60_000 + Number(seconds) * 1000 + millis;
}

/**
 * 解析 LRC，支援一行多個時間標籤、[offset:]、增強型 LRC 的逐字時間。
 * 完全沒有時間標籤時當成純文字歌詞（synced = false）。
 */
export function parseLrc(source: string, durationMs = 0): ParsedLrc {
  const tags: Record<string, string> = {};
  const timed: Array<{ startMs: number; text: string; order: number }> = [];
  const plain: string[] = [];

  source.split(/\r?\n/).forEach((raw, order) => {
    const line = raw.trim();
    if (!line) return;
    const meta = META_TAG.exec(line);
    if (meta) {
      tags[meta[1].toLowerCase()] = meta[2].trim();
      return;
    }
    const times: number[] = [];
    let rest = line;
    for (let m = TIME_TAG.exec(rest); m; m = TIME_TAG.exec(rest)) {
      times.push(toMs(m[1], m[2], m[3]));
      rest = rest.slice(m[0].length);
    }
    if (times.length === 0) {
      plain.push(line);
      return;
    }
    for (const startMs of times) timed.push({ startMs, text: rest, order });
  });

  if (timed.length === 0) {
    return { synced: false, tags, lines: plain.map((text) => ({ startMs: 0, endMs: 0, text })) };
  }

  // [offset:+500] 代表歌詞要提早 500ms 出現
  const offset = Number(tags.offset) || 0;
  timed.sort((a, b) => a.startMs - b.startMs || a.order - b.order);

  const lines: LyricLine[] = [];
  timed.forEach((entry, i) => {
    const startMs = Math.max(0, entry.startMs - offset);
    const nextStart = i + 1 < timed.length ? Math.max(0, timed[i + 1].startMs - offset) : null;
    const endMs = nextStart ?? (durationMs > startMs ? durationMs : startMs + LAST_LINE_MS);
    const { text, words } = parseWords(entry.text, startMs, endMs, offset);
    // 空白行只用來標出上一行在哪裡結束（間奏），本身不顯示
    if (!text.trim()) return;
    lines.push(words ? { startMs, endMs, text: text.trim(), words } : { startMs, endMs, text: text.trim() });
  });

  return { synced: true, tags, lines };
}

function parseWords(text: string, lineStart: number, lineEnd: number, offset: number): { text: string; words?: LyricWord[] } {
  const parts = text.split(WORD_TAG);
  if (parts.length === 1) return { text };

  // parts：[第一個標籤前的文字, 分, 秒, 小數, 文字, 分, 秒, 小數, 文字, …]
  const marks: Array<{ time: number; text: string }> = [];
  if (parts[0]) marks.push({ time: lineStart, text: parts[0] });
  for (let i = 1; i < parts.length; i += 4) {
    marks.push({ time: Math.max(0, toMs(parts[i], parts[i + 1], parts[i + 2]) - offset), text: parts[i + 3] ?? '' });
  }

  // 行尾常有一個只有時間的標籤，代表最後一個字在哪裡結束
  const words: LyricWord[] = [];
  marks.forEach((mark, i) => {
    if (!mark.text) return;
    const end = i + 1 < marks.length ? marks[i + 1].time : lineEnd;
    words.push({ text: mark.text, startMs: mark.time, endMs: Math.max(mark.time, end) });
  });
  const tidy = tidyWords(words);
  return tidy.length ? { text: joinWords(tidy), words: tidy } : { text: '' };
}
