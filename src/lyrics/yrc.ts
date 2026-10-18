import { joinWords, tidyWords, type LyricLine, type LyricWord } from './model';

const LINE_TAG = /^\[(\d+),(\d+)\]/;
/** 只有「(數字,數字,數字)」才是時間標記，「(oh)」這類括號是歌詞本身（v0.1 曾經把它吃掉） */
const WORD_TAG = /\((\d+),(\d+),\d+\)/;

/**
 * 解析網易雲的逐字歌詞（YRC）：`[行起點,行長](字起點,字長,0)字(字起點,字長,0)字…`，時間都是絕對毫秒。
 * 以「{」開頭的 JSON 行是製作人員資訊，略過。
 */
export function parseYrc(source: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const tag = LINE_TAG.exec(line);
    if (!tag) continue;
    const startMs = Number(tag[1]);
    const endMs = startMs + Number(tag[2]);

    // parts：[第一個標記前的文字, 起點, 長度, 文字, 起點, 長度, 文字, …]
    const parts = line.slice(tag[0].length).split(WORD_TAG);
    const words: LyricWord[] = [];
    for (let i = 1; i < parts.length; i += 3) {
      const wordStart = Number(parts[i]);
      words.push({ text: parts[i + 2] ?? '', startMs: wordStart, endMs: wordStart + Number(parts[i + 1]) });
    }
    if (parts[0] && words.length) words[0] = { ...words[0], text: parts[0] + words[0].text };

    const tidy = tidyWords(words);
    const text = tidy.length ? joinWords(tidy) : parts[0].trim();
    if (!text) continue;
    lines.push(tidy.length ? { startMs, endMs, text, words: tidy } : { startMs, endMs, text });
  }
  return lines.sort((a, b) => a.startMs - b.startMs);
}
