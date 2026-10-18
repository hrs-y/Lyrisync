import type { PlayerSnapshot } from '../player/types';
import { granularity, type Lyrics, type LyricsSource } from './model';

/** 精細度永遠優先：逐字 > 逐行 > 純音樂標記 > 純文字 */
const GRANULARITY_SCORE = { word: 3000, line: 2000, plain: 1000 } as const;
const INSTRUMENTAL_SCORE = 1500;
/** 同樣精細度時偏好的來源：手工逐字（AMLL）> QQ 音樂 > 網易雲 > LRCLIB > 酷狗 */
const SOURCE_SCORE: Record<LyricsSource, number> = {
  'ttml-db': 400,
  qq: 350,
  netease: 300,
  lrclib: 250,
  kugou: 200,
  demo: 100,
};
/** 長度每差 1 秒扣 50 分（最多 4 秒），同一級裡長度越接近越好 */
const DURATION_PENALTY_PER_MS = 1 / 20;

export function rankScore(lyrics: Lyrics, snapshot: PlayerSnapshot): number {
  const base = lyrics.instrumental ? INSTRUMENTAL_SCORE : GRANULARITY_SCORE[granularity(lyrics)];
  const matched = lyrics.matched?.durationMs;
  const diff = matched && snapshot.durationMs > 0 ? Math.min(4000, Math.abs(matched - snapshot.durationMs)) : 0;
  return base + SOURCE_SCORE[lyrics.source] - diff * DURATION_PENALTY_PER_MS;
}

/** 由好到壞排序（不改動原陣列）。 */
export function rankLyrics(results: readonly Lyrics[], snapshot: PlayerSnapshot): Lyrics[] {
  return [...results].sort((a, b) => rankScore(b, snapshot) - rankScore(a, snapshot));
}

/** 已經是最好的那一級（社群手工對時的逐字歌詞），拿到就不必等其他來源。 */
export function isBestPossible(lyrics: Lyrics): boolean {
  return lyrics.source === 'ttml-db' && granularity(lyrics) === 'word';
}
