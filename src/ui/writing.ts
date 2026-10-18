import type { LyricWord } from '../lyrics/model';

/** 寫一個中日韓文字大約花這麼久 */
const MS_PER_UNIT = 230;
/** 其他文字（英文等）每個字母算幾個單位：字母比漢字寫得快 */
const LETTER_UNITS = 0.4;
/** 只有標點的一段至少算這麼多單位 */
const MIN_UNITS = 0.3;
/** 最多花這一行長度的這個比例寫完，寫完後整行停留一下 */
const MAX_SHARE = 0.85;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** 一段：一個中日韓文字，或一串其他文字（英文單字、標點）；前後的空白跟著這一段 */
const TOKEN =
  /\s*(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+)\s*/gu;

/**
 * 只有逐行時間的歌詞沒有每個字的時間：依字數從這一行開始時平均分配，
 * 讓書寫效果一樣能一個字一個字寫出來。中日韓文一個字一段，其他文字一個單字一段。
 */
export function synthesizeWords(text: string, startMs: number, endMs: number): LyricWord[] {
  const tokens = text.match(TOKEN) ?? [];
  if (!tokens.length) return [];
  const units = tokens.map(unitsOf);
  const total = units.reduce((sum, value) => sum + value, 0);
  const natural = total * MS_PER_UNIT;
  const lineMs = endMs - startMs;
  const duration = lineMs > 0 ? Math.min(natural, lineMs * MAX_SHARE) : natural;
  let at = startMs;
  return tokens.map((token, i) => {
    const length = (duration * units[i]) / total;
    const word = { text: token, startMs: Math.round(at), endMs: Math.round(at + length) };
    at += length;
    return word;
  });
}

function unitsOf(token: string): number {
  const core = token.trim();
  if (CJK.test(core)) return 1;
  const letters = core.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return Math.max(MIN_UNITS, letters * LETTER_UNITS);
}
