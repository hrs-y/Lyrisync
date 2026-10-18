import { joinWords, tidyWords, type LyricLine, type LyricWord } from './model';

/** 酷狗 KRC 的 XOR 金鑰（各家歌詞工具都用這組公開的固定值） */
const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

const LINE_TAG = /^\[(\d+),(\d+)\]/;
/** 字的時間是相對於行起點的毫秒 */
const WORD_TAG = /<(\d+),(\d+),\d+>/;
const META_TAG = /^\[([a-z]+):(.*)\]$/i;

/** [language:] 標籤裡的 JSON：type 1 是翻譯、type 0 是羅馬拼音，每一列對應一行歌詞 */
interface KrcLanguage {
  content?: { type: number; lyricContent?: string[][] }[];
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 酷狗下載的 KRC：base64 → 去掉「krc1」標頭 → XOR → zlib 解壓。 */
export async function decodeKrc(base64: string): Promise<string> {
  const raw = base64ToBytes(base64);
  if (raw.length < 4 || String.fromCharCode(raw[0], raw[1], raw[2], raw[3]) !== 'krc1') {
    throw new Error('不是 KRC 格式');
  }
  const body = new Uint8Array(raw.length - 4);
  for (let i = 0; i < body.length; i++) body[i] = raw[i + 4] ^ KRC_KEY[i % KRC_KEY.length];
  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate'));
  const text = await new Response(stream).text();
  return text.replace(/^﻿/, '');
}

export interface ParsedKrc {
  lines: LyricLine[];
  /** [ar:]、[ti:]、[offset:] 之類的標籤，key 一律小寫 */
  tags: Record<string, string>;
}

/** 解析解壓後的 KRC 文字：`[行起點,行長]<字偏移,字長,0>字…`。 */
export function parseKrc(source: string): ParsedKrc {
  const tags: Record<string, string> = {};
  // 先保留每一個有時間的行（包含空行），翻譯要照順序對上
  const all: LyricLine[] = [];
  // 每一行整理前的字（羅馬拼音是對著這些字一個一個給的）
  const rawWords: LyricWord[][] = [];

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const tag = LINE_TAG.exec(line);
    if (!tag) {
      const meta = META_TAG.exec(line);
      if (meta) tags[meta[1].toLowerCase()] = meta[2];
      continue;
    }
    const startMs = Number(tag[1]);
    const endMs = startMs + Number(tag[2]);
    const parts = line.slice(tag[0].length).split(WORD_TAG);
    const words: LyricWord[] = [];
    for (let i = 1; i < parts.length; i += 3) {
      const wordStart = startMs + Number(parts[i]);
      words.push({ text: parts[i + 2] ?? '', startMs: wordStart, endMs: wordStart + Number(parts[i + 1]) });
    }
    if (parts[0] && words.length) words[0] = { ...words[0], text: parts[0] + words[0].text };
    const tidy = tidyWords(words);
    const text = tidy.length ? joinWords(tidy) : parts[0].trim();
    all.push(tidy.length ? { startMs, endMs, text, words: tidy } : { startMs, endMs, text });
    rawWords.push(words);
  }

  const language = decodeLanguage(tags.language);
  const rows = (type: number) => language?.content?.find((c) => c.type === type)?.lyricContent;
  const translations = rows(1);
  const romanizations = rows(0);
  all.forEach((line, i) => {
    const translation = translations?.[i]?.join('').trim();
    if (translation) line.translation = translation;
    const parts = romanizations?.[i];
    const romanization = parts?.join('').replace(/\s+/g, ' ').trim();
    if (!parts || !romanization) return;
    line.romanization = romanization;
    // 羅馬拼音一個字一個字對應原文（每段後面自帶空格）：數量一致時沿用原文每個字的時間，就能跟著歌聲填色
    const raw = rawWords[i];
    if (raw.length && parts.length === raw.length) {
      const words = tidyWords(raw.map((word, k) => ({ text: parts[k], startMs: word.startMs, endMs: word.endMs })));
      if (words.length) line.romanizationWords = words;
    }
  });

  // [offset:+500] 代表歌詞要提早 500ms 出現
  const offset = Number(tags.offset) || 0;
  const lines = all
    .filter((line) => line.text)
    .map((line) => (offset ? shiftLine(line, -offset) : line))
    .sort((a, b) => a.startMs - b.startMs);
  return { lines, tags };
}

function decodeLanguage(value: string | undefined): KrcLanguage | null {
  if (!value) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64ToBytes(value))) as KrcLanguage;
  } catch {
    return null;
  }
}

function shiftLine(line: LyricLine, deltaMs: number): LyricLine {
  const shift = (ms: number) => Math.max(0, ms + deltaMs);
  const shiftWords = (words: LyricWord[] | undefined) =>
    words?.map((word) => ({ ...word, startMs: shift(word.startMs), endMs: shift(word.endMs) }));
  return {
    ...line,
    startMs: shift(line.startMs),
    endMs: shift(line.endMs),
    words: shiftWords(line.words),
    romanizationWords: shiftWords(line.romanizationWords),
  };
}
