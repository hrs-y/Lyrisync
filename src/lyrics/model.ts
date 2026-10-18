export interface LyricWord {
  /** 保留原本的空白（例如英文單字後面的空格），顯示時再拆出來 */
  text: string;
  startMs: number;
  endMs: number;
}

/** 背景人聲（和聲），顯示在主歌詞下方 */
export interface BackgroundVocal {
  text: string;
  startMs: number;
  endMs: number;
  words?: LyricWord[];
}

export interface LyricLine {
  startMs: number;
  endMs: number;
  text: string;
  /** 逐字時間軸；沒有代表只有逐行同步 */
  words?: LyricWord[];
  background?: BackgroundVocal;
  /** 對唱時另一位歌手唱的行，靠右顯示 */
  alignEnd?: boolean;
  translation?: string;
  romanization?: string;
  /** 羅馬拼音的逐字時間（QQ 音樂、酷狗有提供）；有的話羅馬拼音也會跟著歌聲填色 */
  romanizationWords?: LyricWord[];
}

export type LyricsSource = 'ttml-db' | 'qq' | 'netease' | 'kugou' | 'lrclib' | 'demo';

/** word：逐字同步；line：逐行同步；plain：純文字，沒有時間軸 */
export type Granularity = 'word' | 'line' | 'plain';

export interface Lyrics {
  /** false：純文字歌詞，沒有時間軸 */
  synced: boolean;
  /** 來源標記為純音樂 */
  instrumental?: boolean;
  lines: LyricLine[];
  source: LyricsSource;
  /** 來源上的資料編號，方便回報錯誤 */
  sourceId?: string;
  /** 實際比對到的歌曲資訊 */
  matched?: { title: string; artist: string; durationMs?: number };
}

/** 一半以上的行有逐字時間才算逐字歌詞。 */
export function granularity(lyrics: Lyrics): Granularity {
  if (!lyrics.synced) return 'plain';
  const timed = lyrics.lines.filter((line) => line.words?.length).length;
  return timed > 0 && timed >= lyrics.lines.length / 2 ? 'word' : 'line';
}

/** 整理逐字資料：只有空白的「字」併到前一個字後面，空字串丟掉。 */
export function tidyWords(words: readonly LyricWord[]): LyricWord[] {
  const out: LyricWord[] = [];
  for (const word of words) {
    if (!word.text) continue;
    const last = out[out.length - 1];
    if (!word.text.trim() && last) {
      out[out.length - 1] = { ...last, text: last.text + word.text };
    } else {
      out.push({ ...word });
    }
  }
  // 開頭如果是只有空白的字，前面沒有字可以併
  return out.filter((word) => word.text.trim());
}

export function joinWords(words: readonly LyricWord[]): string {
  return words
    .map((word) => word.text)
    .join('')
    .trim();
}

/** 回傳目前時間所在的行（最後一個 startMs <= timeMs 的行），還沒到第一行時回傳 -1。 */
export function findLineIndex(lines: readonly { startMs: number }[], timeMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].startMs <= timeMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
