import { t, type MessageKey } from '../i18n';
import { hasKana } from '../lyrics/chinese';
import type { JaFont, LatinFont, Settings, ZhFont } from '../settings';

/** 一行歌詞用哪一種語言的字體：日文、韓文、中文，或只有拉丁字母（英文等） */
export type LyricLanguage = 'zh' | 'ja' | 'ko' | 'en';

/** 打包的字型每個字重一個 CSS（@fontsource），用到時才載入 */
type WeightLoaders = Readonly<Record<number, () => Promise<unknown>>>;

export interface FontOption<T extends string> {
  id: T;
  /** 設定頁上的名稱：翻譯的鍵，或不翻譯的字型名（例如 Garamond） */
  label: MessageKey | { text: string };
  /** 名稱下面的字型全名 */
  detail: MessageKey | { text: string };
  /** CSS font-family（不含後備字型） */
  family: string;
  /** 粗體與一般的字重：明體、楷體不必太粗；沒有粗體的字型兩個一樣，免得被硬加粗 */
  bold: number;
  regular: number;
  /** 字距：黑體稍微收緊，襯線體維持原本的 */
  tracking: string;
  /** 只有英文的行放大多少：Garamond 的小寫字母比較矮，同樣字級看起來比中文小一號 */
  scale?: number;
  /** 打包進程式的開源字型（SIL OFL） */
  load?: WeightLoaders;
}

const SANS_TRACKING = '-0.012em';
const name = (text: string) => ({ text });

// 字型檔用 @fontsource 打包（SIL Open Font License 1.1），中日文字型依 unicode-range 拆成小檔，只會載入用到的字
export const ZH_FONT_OPTIONS: ReadonlyArray<FontOption<ZhFont>> = [
  {
    id: 'sans',
    label: 'font.zh.sans',
    detail: 'font.zh.sans.detail',
    family: '"Microsoft JhengHei UI", "Microsoft JhengHei", "PingFang TC", "Noto Sans TC"',
    bold: 700,
    regular: 400,
    tracking: SANS_TRACKING,
  },
  {
    id: 'serif',
    label: 'font.zh.serif',
    detail: 'font.zh.serif.detail',
    family: '"Noto Serif TC"',
    bold: 600,
    regular: 400,
    tracking: '0.01em',
    load: {
      400: () => import('@fontsource/noto-serif-tc/400.css'),
      600: () => import('@fontsource/noto-serif-tc/600.css'),
    },
  },
  {
    id: 'wenkai',
    label: 'font.zh.wenkai',
    detail: 'font.zh.wenkai.detail',
    family: '"LXGW WenKai TC"',
    bold: 700,
    regular: 400,
    tracking: '0.01em',
    load: {
      400: () => import('@fontsource/lxgw-wenkai-tc/400.css'),
      700: () => import('@fontsource/lxgw-wenkai-tc/700.css'),
    },
  },
  {
    // Windows 繁體中文版內建；沒有粗體
    id: 'kai',
    label: 'font.zh.kai',
    detail: 'font.zh.kai.detail',
    family: '"DFKai-SB", "BiauKai", "標楷體"',
    bold: 400,
    regular: 400,
    tracking: '0.02em',
  },
];

export const JA_FONT_OPTIONS: ReadonlyArray<FontOption<JaFont>> = [
  {
    id: 'gothic',
    label: 'font.ja.gothic',
    detail: name('Yu Gothic'),
    family: '"Yu Gothic UI", "Yu Gothic", "Meiryo UI", "Hiragino Sans"',
    bold: 700,
    regular: 500,
    tracking: SANS_TRACKING,
  },
  {
    id: 'mincho',
    label: 'font.ja.mincho',
    detail: name('Shippori Mincho'),
    family: '"Shippori Mincho"',
    bold: 600,
    regular: 400,
    tracking: '0.01em',
    load: {
      400: () => import('@fontsource/shippori-mincho/400.css'),
      600: () => import('@fontsource/shippori-mincho/600.css'),
    },
  },
  {
    id: 'klee',
    label: 'font.ja.klee',
    detail: name('Klee One'),
    family: '"Klee One"',
    bold: 600,
    regular: 400,
    tracking: '0.01em',
    load: {
      400: () => import('@fontsource/klee-one/400.css'),
      600: () => import('@fontsource/klee-one/600.css'),
    },
  },
  {
    id: 'maru',
    label: 'font.ja.maru',
    detail: name('Zen Maru Gothic'),
    family: '"Zen Maru Gothic"',
    bold: 700,
    regular: 500,
    tracking: '0',
    load: {
      500: () => import('@fontsource/zen-maru-gothic/500.css'),
      700: () => import('@fontsource/zen-maru-gothic/700.css'),
    },
  },
];

/** 拉丁字母的字型排在中日文字型前面，所以中日文歌詞裡的英文字也會用它（字重跟著那一行） */
export const LATIN_FONT_OPTIONS: ReadonlyArray<FontOption<LatinFont>> = [
  {
    id: 'sans',
    label: 'font.latin.sans',
    detail: name('Segoe UI'),
    family: '"Segoe UI Variable Display", "Segoe UI"',
    bold: 700,
    regular: 500,
    tracking: SANS_TRACKING,
  },
  {
    id: 'garamond',
    label: name('Garamond'),
    detail: name('EB Garamond'),
    family: '"EB Garamond"',
    bold: 600,
    regular: 400,
    tracking: '0',
    scale: 1.1,
    load: {
      400: () => import('@fontsource/eb-garamond/400.css'),
      600: () => import('@fontsource/eb-garamond/600.css'),
      700: () => import('@fontsource/eb-garamond/700.css'),
    },
  },
  {
    id: 'baskerville',
    label: name('Baskerville'),
    detail: name('Libre Baskerville'),
    family: '"Libre Baskerville"',
    bold: 600,
    regular: 400,
    tracking: '0',
    load: {
      400: () => import('@fontsource/libre-baskerville/400.css'),
      600: () => import('@fontsource/libre-baskerville/600.css'),
      700: () => import('@fontsource/libre-baskerville/700.css'),
    },
  },
  {
    id: 'playfair',
    label: name('Playfair'),
    detail: name('Playfair Display'),
    family: '"Playfair Display"',
    bold: 600,
    regular: 400,
    tracking: '0.005em',
    load: {
      400: () => import('@fontsource/playfair-display/400.css'),
      600: () => import('@fontsource/playfair-display/600.css'),
      700: () => import('@fontsource/playfair-display/700.css'),
    },
  },
];

/** 選的字體還沒載入、或缺字時的後備 */
const FALLBACK_ZH = '"Microsoft JhengHei UI", "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
const FALLBACK_JA = '"Yu Gothic UI", "Yu Gothic", "Meiryo UI", "Microsoft JhengHei UI", sans-serif';
const KOREAN = '"Malgun Gothic", "Apple SD Gothic Neo"';

const HAN = /\p{Script=Han}/u;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const LETTER = /\p{L}/u;

/**
 * 一行歌詞的語言：有假名是日文、有諺文是韓文、有漢字是中文（日文歌裡只有漢字的行仍算日文），
 * 其他有字母的行（英文、西班牙文等）用英文字體。
 */
export function lineLanguage(text: string, japaneseSong = false): LyricLanguage {
  if (hasKana(text)) return 'ja';
  if (HANGUL.test(text)) return 'ko';
  if (HAN.test(text)) return japaneseSong ? 'ja' : 'zh';
  if (LETTER.test(text)) return 'en';
  return japaneseSong ? 'ja' : 'zh';
}

/** 寫在元素 lang 屬性上的值：中文明確標成繁體，介面語言是英文時中文行也不會被當成英文 */
export const LANG_ATTRIBUTE: Record<LyricLanguage, string> = { zh: 'zh-Hant', ja: 'ja', ko: 'ko', en: 'en' };

export function optionLabel(option: FontOption<string>): string {
  return typeof option.label === 'string' ? t(option.label) : option.label.text;
}

export function optionDetail(option: FontOption<string>): string {
  return typeof option.detail === 'string' ? t(option.detail) : option.detail.text;
}

export function weightOf(option: FontOption<string>, bold: boolean): number {
  return bold ? option.bold : option.regular;
}

function pick<T extends string>(options: ReadonlyArray<FontOption<T>>, id: T): FontOption<T> {
  return options.find((option) => option.id === id) ?? options[0];
}

export type FontSettings = Pick<Settings, 'fontZh' | 'fontJa' | 'fontLatin' | 'lyricBold'>;

export interface LyricFonts {
  zh: FontOption<ZhFont>;
  ja: FontOption<JaFont>;
  latin: FontOption<LatinFont>;
  bold: boolean;
}

export function selectedFonts(settings: FontSettings): LyricFonts {
  return {
    zh: pick(ZH_FONT_OPTIONS, settings.fontZh),
    ja: pick(JA_FONT_OPTIONS, settings.fontJa),
    latin: pick(LATIN_FONT_OPTIONS, settings.fontLatin),
    bold: settings.lyricBold,
  };
}

/**
 * 每種語言的字型、字重、字距，寫成 CSS 變數（--lyric-family-zh 等）。
 * 拉丁字型一律排第一個：中日文字型也有英文字母，排在後面才不會蓋過使用者選的英文字體。
 */
export function lyricFontVariables(fonts: LyricFonts): Record<string, string> {
  const { zh, ja, latin, bold } = fonts;
  return {
    '--lyric-family-zh': `${latin.family}, ${zh.family}, ${FALLBACK_ZH}`,
    '--lyric-weight-zh': String(weightOf(zh, bold)),
    '--lyric-tracking-zh': zh.tracking,
    '--lyric-family-ja': `${latin.family}, ${ja.family}, ${FALLBACK_JA}`,
    '--lyric-weight-ja': String(weightOf(ja, bold)),
    '--lyric-tracking-ja': ja.tracking,
    '--lyric-family-ko': `${latin.family}, ${KOREAN}, ${FALLBACK_ZH}`,
    '--lyric-weight-ko': bold ? '700' : '400',
    '--lyric-tracking-ko': SANS_TRACKING,
    '--lyric-family-en': `${latin.family}, ${zh.family}, ${FALLBACK_ZH}`,
    '--lyric-weight-en': String(weightOf(latin, bold)),
    '--lyric-tracking-en': latin.tracking,
    '--lyric-scale-en': String(latin.scale ?? 1),
  };
}

const loaded = new Map<() => Promise<unknown>, Promise<void>>();

/** 最接近的打包字重（例如要 700 但只有 600、400 時用 600） */
function nearestLoader(load: WeightLoaders, weight: number): (() => Promise<unknown>) | undefined {
  const weights = Object.keys(load).map(Number);
  if (!weights.length) return undefined;
  const nearest = weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));
  return load[nearest];
}

/** 載入打包字型的某些字重（同一個檔只載一次）；失敗時用後備字型，不影響歌詞顯示。 */
export function loadFont(option: FontOption<string>, weights: readonly number[]): Promise<void> {
  if (!option.load) return Promise.resolve();
  const loaders = new Set(weights.map((weight) => nearestLoader(option.load!, weight)).filter((l) => l !== undefined));
  return Promise.all(
    [...loaders].map((loader) => {
      let promise = loaded.get(loader);
      if (!promise) {
        promise = loader()
          .then(() => undefined)
          .catch((e: unknown) => {
            loaded.delete(loader);
            console.warn(`無法載入字型 ${optionDetail(option)}`, e);
          });
        loaded.set(loader, promise);
      }
      return promise;
    }),
  ).then(() => undefined);
}

/** 套用歌詞字體：寫入 CSS 變數，並載入選到的開源字型（拉丁字型也要能配合中日文行的字重）。 */
export function applyLyricFonts(settings: FontSettings, root: HTMLElement): Promise<void> {
  const fonts = selectedFonts(settings);
  for (const [property, value] of Object.entries(lyricFontVariables(fonts))) root.style.setProperty(property, value);
  const { zh, ja, latin, bold } = fonts;
  return Promise.all([
    loadFont(zh, [weightOf(zh, bold)]),
    loadFont(ja, [weightOf(ja, bold)]),
    loadFont(latin, [weightOf(latin, bold), weightOf(zh, bold), weightOf(ja, bold)]),
  ]).then(() => undefined);
}
