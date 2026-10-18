import { isCreditLine } from './credits';
import { parseLrc } from './lrc';
import type { LyricLine } from './model';

/** 翻譯行的時間和主歌詞差超過這個值，就不算同一行 */
const MAX_ATTACH_DIFF_MS = 1000;

/**
 * 依時間把附加的行（翻譯或羅馬拼音）對到最接近的主歌詞行，每一行附加內容只用一次。
 * 兩邊都要依時間排序。
 */
function matchByTime<T extends { startMs: number }>(lines: LyricLine[], extra: readonly T[], apply: (line: LyricLine, match: T) => void): void {
  if (!extra.length) return;
  let j = 0;
  let lastUsed = -1;
  for (const line of lines) {
    // 往後找，直到下一行不會更接近
    while (j + 1 < extra.length && Math.abs(extra[j + 1].startMs - line.startMs) <= Math.abs(extra[j].startMs - line.startMs)) {
      j++;
    }
    if (j !== lastUsed && Math.abs(extra[j].startMs - line.startMs) <= MAX_ATTACH_DIFF_MS) {
      apply(line, extra[j]);
      lastUsed = j;
    }
  }
}

/**
 * 把另一份 LRC（翻譯或羅馬拼音）依時間對到最接近的行。
 * 網易雲的翻譯和 LRC 時間一致，和逐字歌詞（YRC）則可能差幾百毫秒。
 */
export function attachByTime(lines: LyricLine[], lrc: string | undefined, field: 'translation' | 'romanization'): void {
  if (!lrc) return;
  const extra = parseLrc(lrc).lines.filter((line) => {
    const text = line.text.trim();
    return text && text !== '//' && !isCreditLine(text);
  });
  matchByTime(lines, extra, (line, match) => {
    line[field] = match.text;
  });
}

/** 有逐字時間的羅馬拼音（例如 QQ 音樂的 roma QRC）：連同每個音節的時間一起對到最接近的行。 */
export function attachRomanizationLines(lines: LyricLine[], romanization: readonly LyricLine[]): void {
  const extra = romanization.filter((line) => line.text.trim() && !isCreditLine(line.text));
  matchByTime(lines, extra, (line, match) => {
    line.romanization = match.text;
    if (match.words?.length) line.romanizationWords = match.words;
  });
}
