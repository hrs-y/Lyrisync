import type { PlayerSnapshot } from '../player/types';
import { toSimplified } from './chinese';

/** 長度差超過這個值就不採用（LRCLIB 自己的精確查詢容許 ±2 秒） */
export const MAX_DURATION_DIFF_MS = 4000;
/** 逐字歌詞要求長度更接近：版本不同的話，時間軸會整段偏掉 */
export const WORD_MAX_DURATION_DIFF_MS = 3000;
/** 歌手名稱寫法不同（例如英文對日文）時沒辦法比對歌手，改要求長度幾乎一樣，避免抓到翻唱 */
const CROSS_SCRIPT_MAX_DIFF_MS = 1500;

/** 「- Remastered 2011」「- Live」「- From "電影"」這類版本後綴 */
const VERSION_SUFFIX =
  /\s+-\s+[^-]*\b(remaster(ed)?|live|version|edit|mix|mono|stereo|acoustic|demo|instrumental|bonus|deluxe|single|radio|from|feat\.?|ft\.?)\b.*$/i;
/** 「(feat. X)」「[Live]」「（Remastered）」這類括號資訊 */
const BRACKETED_INFO =
  /\s*[(\[（【][^)\]）】]*\b(feat\.?|ft\.?|with|live|remaster(ed)?|version|edit|mix|acoustic|demo|instrumental)\b[^)\]）】]*[)\]）】]/gi;
/** 日文歌名常見的「～副標題～」 */
const WAVE_SUBTITLE = /\s*[～〜~][^～〜~]+[～〜~]?\s*$/;
/** 多位歌手之間的分隔：逗號、頓號、斜線、&、feat.、with… */
const ARTIST_SEPARATOR = /\s*[,，、;；/／&＆+＋×]\s*|\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+/i;

/** 比對用的正規化：全形轉半形、簡繁統一、轉小寫、去掉標點和空白。 */
export function normalizeForCompare(value: string): string {
  const folded = toSimplified(value.normalize('NFKC')).toLowerCase();
  const stripped = folded.replace(/[\s\p{P}\p{S}]+/gu, '');
  // 歌名全是符號時（例如「!!!」）就不要去掉，否則會變成空字串
  return stripped || folded.trim();
}

/** 搜尋用的歌名：原始歌名，加上去掉版本資訊、日文副標題後的歌名（不重複）。 */
export function searchTitles(title: string): string[] {
  const original = title.trim();
  const cleaned = original.replace(BRACKETED_INFO, '').replace(VERSION_SUFFIX, '').trim();
  const noSubtitle = cleaned.replace(WAVE_SUBTITLE, '').trim();
  return [...new Set([original, cleaned, noSubtitle].filter(Boolean))];
}

export function splitArtists(artist: string): string[] {
  return artist
    .split(ARTIST_SEPARATOR)
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * cross-script：Spotify 顯示的是拉丁字母（羅馬拼音、英文名），來源用的是原文
 * （例如「ultra chotokkyu」對「ウルトラ超特急」），無法比對歌手。
 * 反過來的情況（Spotify 是中文、來源是英文名）多半是翻唱，不放寬。
 */
export type ArtistMatch = 'match' | 'partial' | 'cross-script' | 'mismatch' | 'unknown';

const LATIN_LETTER = /\p{Script=Latin}/u;
const OTHER_LETTER = /(?!\p{Script=Latin})\p{L}/u;

/** 一組名稱用的是拉丁字母、其他文字，還是兩者都有 */
function writingSystem(names: readonly string[]): 'latin' | 'other' | 'mixed' {
  const latin = names.some((name) => LATIN_LETTER.test(name));
  const other = names.some((name) => OTHER_LETTER.test(name));
  if (latin && other) return 'mixed';
  return latin ? 'latin' : 'other';
}

/** 候選的歌手（可能好幾位、含別名）裡，有沒有一位是正在播放的歌手。 */
export function compareArtists(candidate: readonly string[], wanted: string): ArtistMatch {
  const haveNames = candidate.flatMap(splitArtists);
  const wantNames = splitArtists(wanted);
  const have = haveNames.map(normalizeForCompare).filter(Boolean);
  const want = wantNames.map(normalizeForCompare).filter(Boolean);
  if (!have.length || !want.length) return 'unknown';
  if (have.some((name) => want.includes(name))) return 'match';
  const contains = (a: string, b: string) => Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a));
  if (have.some((a) => want.some((b) => contains(a, b)))) return 'partial';
  if (writingSystem(wantNames) === 'latin' && writingSystem(haveNames) === 'other') return 'cross-script';
  return 'mismatch';
}

export interface Candidate {
  title: string;
  /** 歌手名稱，可以包含別名 */
  artists: readonly string[];
  durationMs?: number;
}

export interface MatchOptions {
  maxDurationDiffMs?: number;
}

/** 分數越高越好；回傳 null 代表不是這首歌（歌名、長度對不上，或歌手不同，多半是翻唱）。 */
export function scoreCandidate(candidate: Candidate, snapshot: PlayerSnapshot, options: MatchOptions = {}): number | null {
  const maxDiff = options.maxDurationDiffMs ?? MAX_DURATION_DIFF_MS;
  let score = 0;
  let durationDiff: number | null = null;

  if (candidate.durationMs && snapshot.durationMs > 0) {
    durationDiff = Math.abs(candidate.durationMs - snapshot.durationMs);
    if (durationDiff > maxDiff) return null;
    score += 40 * (1 - durationDiff / maxDiff);
  }

  const titles = searchTitles(candidate.title).map(normalizeForCompare);
  const wanted = searchTitles(snapshot.title).map(normalizeForCompare);
  const contains = (a: string, b: string) => Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a));
  if (titles.some((t) => wanted.includes(t))) score += 40;
  else if (titles.some((t) => wanted.some((w) => contains(t, w)))) score += 15;
  else return null;

  switch (compareArtists(candidate.artists, snapshot.artist)) {
    case 'match':
      score += 25;
      break;
    case 'partial':
      score += 12;
      break;
    case 'cross-script':
      if (durationDiff === null || durationDiff > CROSS_SCRIPT_MAX_DIFF_MS) return null;
      break;
    case 'mismatch':
      return null;
    case 'unknown':
      break;
  }
  return score;
}

export function pickBest<T extends Candidate>(
  candidates: readonly T[],
  snapshot: PlayerSnapshot,
  options?: MatchOptions,
): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, snapshot, options);
    if (score !== null && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
