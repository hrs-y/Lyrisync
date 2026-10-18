import { attachRomanizationLines } from './attach';
import type { LyricLine, Lyrics } from './model';

/** 不到這個比例的行有羅馬拼音，就當成這份沒有、要去借 */
const BORROW_BELOW = 0.2;
/** 至少這個比例的行有羅馬拼音，才拿來借 */
const DONOR_AT_LEAST = 0.5;

/** 有幾成的行附了羅馬拼音 */
export function romanizationCoverage(lyrics: Lyrics): number {
  if (!lyrics.lines.length) return 0;
  return lyrics.lines.filter((line) => line.romanization).length / lyrics.lines.length;
}

/** 依排名找第一份可以借羅馬拼音的版本；這份自己夠用或沒有可借的時回傳 null。 */
export function findRomanizationDonor(target: Lyrics, others: readonly Lyrics[]): Lyrics | null {
  if (!target.synced || romanizationCoverage(target) >= BORROW_BELOW) return null;
  return others.find((other) => other !== target && other.synced && romanizationCoverage(other) >= DONOR_AT_LEAST) ?? null;
}

/**
 * 顯示的版本沒有羅馬拼音、但同一首歌的其他版本有時（例如逐字歌詞來自 AMLL、羅馬字在 QQ 音樂），
 * 依時間把那一份的羅馬拼音（含逐字時間）借過來。只借一份，避免不同來源的拼法混在一起。
 * 回傳新的物件，不改動原本的歌詞。
 */
export function borrowRomanization(target: Lyrics, donor: Lyrics | null): Lyrics {
  if (!donor) return target;
  const lines: LyricLine[] = target.lines.map((line) => ({ ...line }));
  const romanized: LyricLine[] = donor.lines
    .filter((line) => line.romanization)
    .map((line) => ({ startMs: line.startMs, endMs: line.endMs, text: line.romanization!, words: line.romanizationWords }));
  attachRomanizationLines(lines, romanized);
  return { ...target, lines };
}
