import type { ConverterFunction } from 'opencc-js';
import type { LyricLine, LyricWord, Lyrics } from './model';

let toTraditionalFn: ConverterFunction | null = null;
let toSimplifiedFn: ConverterFunction | null = null;
let loading: Promise<void> | null = null;

/** opencc-js 的字典約 1MB，第一次用到時才載入；載入失敗就不轉換，不影響其他功能。 */
export function loadChineseConverter(): Promise<void> {
  loading ??= import('opencc-js')
    .then((OpenCC) => {
      // 只轉字形與台灣異體字（例如「着」→「著」），不換用語（「软件」不會變成「軟體」），避免改動歌詞
      toTraditionalFn = OpenCC.Converter({ from: 'cn', to: 'tw' });
      toSimplifiedFn = OpenCC.Converter({ from: 'tw', to: 'cn' });
    })
    .catch((e: unknown) => {
      console.warn('無法載入簡繁轉換字典', e);
    });
  return loading;
}

/** 平假名、片假名（含半形）。「・」和「ー」中文歌詞也會用，不算（v0.1 曾因此誤判）。 */
const KANA = /[ぁ-ゖゝ-ゟァ-ヺヽ-ヿㇰ-ㇿｦ-ｯｱ-ﾝ]/;
const HAN = /\p{Script=Han}/u;

export function hasKana(text: string): boolean {
  return KANA.test(text);
}

/** 轉成簡體；搜尋酷狗、比對歌名時用。 */
export function toSimplified(text: string): string {
  return toSimplifiedFn && HAN.test(text) ? toSimplifiedFn(text) : text;
}

/** 轉成繁體；含假名的文字不轉（日文的漢字不能轉成繁體）。 */
export function toTraditional(text: string): string {
  return toTraditionalFn && HAN.test(text) && !hasKana(text) ? toTraditionalFn(text) : text;
}

/** 兩成以上的行含假名就當成日文歌，主歌詞整首都不轉換（全是漢字的行也一樣）。 */
export function isJapanese(lines: readonly LyricLine[]): boolean {
  const kanaLines = lines.filter((line) => hasKana(line.text)).length;
  return kanaLines > 0 && kanaLines >= Math.ceil(lines.length * 0.2);
}

/** 回傳轉成繁體的副本：主歌詞（日文歌除外）、背景人聲、翻譯都轉，逐字切分維持不變。 */
export function toTraditionalLyrics(lyrics: Lyrics): Lyrics {
  if (!toTraditionalFn) return lyrics;
  const japanese = isJapanese(lyrics.lines);
  return {
    ...lyrics,
    lines: lyrics.lines.map((line) => {
      const out: LyricLine = { ...line };
      if (!japanese) {
        out.text = toTraditional(line.text);
        if (line.words) out.words = convertWords(line.words);
        if (line.background) {
          out.background = {
            ...line.background,
            text: toTraditional(line.background.text),
            words: line.background.words && convertWords(line.background.words),
          };
        }
      }
      // 翻譯一律是中文，日文歌的翻譯也要轉
      if (line.translation) out.translation = toTraditional(line.translation);
      return out;
    }),
  };
}

/**
 * 整行一起轉，簡繁轉換才看得到上下文（「头」「发」分開轉會變成「頭發」，整行轉才是「頭髮」），
 * 再依原本每個字的長度切回去。長度對不上時退回逐字轉換。
 */
function convertWords(words: LyricWord[]): LyricWord[] {
  const joined = words.map((word) => word.text).join('');
  const converted = toTraditional(joined);
  if (converted === joined) return words;
  if (converted.length !== joined.length) return words.map((word) => ({ ...word, text: toTraditional(word.text) }));
  let offset = 0;
  return words.map((word) => {
    const text = converted.slice(offset, offset + word.text.length);
    offset += word.text.length;
    return { ...word, text };
  });
}
