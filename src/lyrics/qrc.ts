import { joinWords, tidyWords, type LyricLine, type LyricWord } from './model';
import { desTransform } from './qrcDes';

/** QQ 音樂的 QRC 金鑰：依序「解密、加密、解密」（各家歌詞工具都用這組公開的固定值） */
const QRC_KEYS = ['!@#)(NHL', '123ZXC!@', '!@#)(*$%'] as const;

const LINE_TAG = /^\[(\d+),(\d+)\]/;
/** QRC 的字在前、時間在後：`字(起點,長度)`，時間是絕對毫秒 */
const WORD_TAG = /\((\d+),(\d+)\)/;
const HEX = /^[0-9a-f]+$/i;

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).text();
}

/**
 * DES 以 8 位元組為一組，壓縮資料後面補了 0～7 個位元組。瀏覽器的解壓會把補的位元組當成多餘資料而報錯，
 * 所以從尾端逐一去掉再試：剛好去掉補的部分時才會成功（去太多會變成資料不完整）。
 */
async function inflatePadded(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  let lastError: unknown = new Error('沒有資料');
  for (let trim = 0; trim < 8 && trim < bytes.length; trim++) {
    try {
      return await inflate(bytes.slice(0, bytes.length - trim));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** 解開 QQ 音樂的加密歌詞（十六進位字串）：DES 三次 → zlib 解壓。 */
export async function decryptQrc(hex: string): Promise<string> {
  const value = hex.trim();
  if (!HEX.test(value) || value.length % 16 !== 0) throw new Error('不是 QRC 加密格式');
  const bytes = hexToBytes(value);
  desTransform(bytes, QRC_KEYS[0], false);
  desTransform(bytes, QRC_KEYS[1], true);
  desTransform(bytes, QRC_KEYS[2], false);
  const text = await inflatePadded(bytes);
  return text.replace(/^﻿/, '');
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return XML_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

/**
 * 解密後的逐字歌詞包在 XML 的 LyricContent 屬性裡。這裡不用 XML 解析器：
 * 屬性值裡的換行會被解析器正規化成空白，行的結構就不見了。不是 XML 時原樣回傳（例如翻譯是一般的 LRC）。
 */
export function extractQrcContent(text: string): string {
  const match = /LyricContent="([\s\S]*?)"\s*\/>/.exec(text);
  return match ? unescapeXml(match[1]) : text;
}

/** 解析 QRC：`[行起點,行長]字(起點,長度)字(起點,長度)…`；[ti:] 之類的標籤略過。 */
export function parseQrc(content: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const tag = LINE_TAG.exec(line);
    if (!tag) continue;
    const startMs = Number(tag[1]);
    const endMs = startMs + Number(tag[2]);

    // parts：[字, 起點, 長度, 字, 起點, 長度, …, 最後一個時間之後的文字]
    const parts = line.slice(tag[0].length).split(WORD_TAG);
    const words: LyricWord[] = [];
    for (let i = 0; i + 2 < parts.length; i += 3) {
      const wordStart = Number(parts[i + 1]);
      words.push({ text: parts[i], startMs: wordStart, endMs: wordStart + Number(parts[i + 2]) });
    }
    const tail = parts[parts.length - 1];
    if (words.length && tail) {
      const last = words[words.length - 1];
      words[words.length - 1] = { ...last, text: last.text + tail };
    }

    const tidy = tidyWords(words);
    const text = tidy.length ? joinWords(tidy) : parts.join('').trim();
    if (!text) continue;
    lines.push(tidy.length ? { startMs, endMs, text, words: tidy } : { startMs, endMs, text });
  }
  return lines.sort((a, b) => a.startMs - b.startMs);
}

/** 內容是 QRC（每行開頭是 [起點,長度]）還是一般的 LRC */
export function isQrcContent(content: string): boolean {
  return /^\[\d+,\d+\]/m.test(content);
}
