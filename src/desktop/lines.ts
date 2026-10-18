import { findLineIndex, type LyricLine, type LyricWord, type Lyrics } from '../lyrics/model';

export type SecondaryKind = 'romanization' | 'translation' | 'next' | 'none';

export interface DesktopLines {
  /** 目前的行在 lyrics.lines 裡的索引；還沒唱到第一行時是 -1（先顯示第一行，但還沒亮） */
  index: number;
  line: LyricLine | null;
  secondary: string;
  secondaryKind: SecondaryKind;
  /** 第二行的逐字時間（羅馬拼音有提供時），書寫效果用 */
  secondaryWords?: LyricWord[];
}

export interface LineOptions {
  showTranslation: boolean;
  showRomanization: boolean;
  /** 沒有羅馬拼音、翻譯時預告下一句；書寫效果時關掉，還沒唱到的歌詞不先出現 */
  previewNext?: boolean;
}

/**
 * 桌面歌詞要顯示的兩行：主行是最後一個開始唱的行（間奏時停在唱完的那一行）；
 * 第二行依序用羅馬拼音、翻譯（各自有開關），都沒有時預告下一句。
 */
export function pickLines(lyrics: Lyrics, timeMs: number, options: LineOptions): DesktopLines {
  const lines = lyrics.lines;
  if (!lyrics.synced || !lines.length) return { index: -1, line: null, secondary: '', secondaryKind: 'none' };
  const index = findLineIndex(lines, timeMs);
  const current = Math.max(0, index);
  const line = lines[current];
  if (options.showRomanization && line.romanization) {
    return { index, line, secondary: line.romanization, secondaryKind: 'romanization', secondaryWords: line.romanizationWords };
  }
  if (options.showTranslation && line.translation) {
    return { index, line, secondary: line.translation, secondaryKind: 'translation' };
  }
  const next = options.previewNext === false ? undefined : lines[current + 1];
  return next ? { index, line, secondary: next.text, secondaryKind: 'next' } : { index, line, secondary: '', secondaryKind: 'none' };
}
