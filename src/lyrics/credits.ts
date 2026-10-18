import { normalizeForCompare, searchTitles, splitArtists } from './match';
import type { LyricLine } from './model';

/** 製作人員資訊的開頭；後面接冒號才算（「作词：某人」「Composed by：某人」） */
const CREDIT_KEYWORDS = [
  '作词', '作詞', '作曲', '编曲', '編曲', '词曲', '詞曲', '词', '詞', '曲',
  '制作人', '製作人', '制作', '製作', '监制', '監製', '出品', '发行', '發行', '企划', '企劃', '统筹', '統籌',
  '混音', '母带', '母帶', '录音', '錄音', '和声', '和聲', '合声', '合聲', '配唱', '原唱', '演唱',
  '吉他', '贝斯', '貝斯', '鼓', '键盘', '鍵盤', '弦乐', '弦樂', '版权', '版權', 'OP', 'SP',
  '作詞者', '作曲者', '編曲者',
  'lyrics', 'lyricist', 'lyrics by', 'composer', 'composed by', 'music', 'music by', 'written by',
  'arranger', 'arranged by', 'producer', 'produced by', 'mixed by', 'mastered by', 'recorded by',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 關鍵字後面可以再接一段英文說明（「作词 Lyricist：」） */
const CREDIT_LINE = new RegExp(
  `^\\s*(?:${[...CREDIT_KEYWORDS].sort((a, b) => b.length - a.length).map(escape).join('|')})(?:\\s*[/／]?\\s*[A-Za-z ]+)?\\s*[:：]`,
  'i',
);
/** 網易雲翻譯開頭的版權聲明 */
const COPYRIGHT_NOTICE = /著作权|著作權/;

export function isCreditLine(text: string): boolean {
  return CREDIT_LINE.test(text) || COPYRIGHT_NOTICE.test(text);
}

/** 來源用一行說明代替歌詞，表示這首是純音樂 */
const INSTRUMENTAL_NOTICE = /纯音乐[，,]?\s*请(您)?欣赏|純音樂[，,]?\s*請(您)?欣賞|没有填词的纯音乐|沒有填詞的純音樂/;

export function isInstrumentalNotice(text: string): boolean {
  return INSTRUMENTAL_NOTICE.test(text);
}

/** 酷狗等來源開頭常有一行「歌手 - 歌名」 */
export function isTitleLine(text: string, title: string, artist: string): boolean {
  if (!/[-－–—]/.test(text)) return false;
  const normalized = normalizeForCompare(text);
  const has = (part: string) => {
    const n = normalizeForCompare(part);
    return n.length > 0 && normalized.includes(n);
  };
  return searchTitles(title).some(has) && splitArtists(artist).some(has);
}

/** 標題行只會出現在最前面幾行 */
const TITLE_LINE_SCAN = 3;

/** 去掉製作人員資訊和開頭的標題行；全部都被去掉（不太可能）時保留原本的。 */
export function removeCredits(lines: LyricLine[], title: string, artist: string): LyricLine[] {
  const kept = lines.filter(
    (line, i) => !isCreditLine(line.text) && !(i < TITLE_LINE_SCAN && isTitleLine(line.text, title, artist)),
  );
  return kept.length ? kept : lines;
}
