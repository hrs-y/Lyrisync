import { en } from './en';
import { ja } from './ja';
import { zhTW } from './zh-TW';

export type Locale = 'zh-TW' | 'en' | 'ja';
export type LanguageSetting = 'auto' | Locale;
export type MessageKey = keyof typeof zhTW;
/** 其他語言的字典：鍵要和繁體中文一樣，少一個型別檢查就會擋下 */
export type Messages = Record<MessageKey, string>;

export const LOCALES: readonly Locale[] = ['zh-TW', 'en', 'ja'];
/** 語言選單裡用該語言自己的寫法 */
export const LOCALE_NAMES: Record<Locale, string> = { 'zh-TW': '繁體中文', en: 'English', ja: '日本語' };
/** 對應 <html lang>：決定中日文的字形與換行規則 */
const HTML_LANG: Record<Locale, string> = { 'zh-TW': 'zh-Hant-TW', en: 'en', ja: 'ja' };

const DICTIONARIES: Record<Locale, Messages> = { 'zh-TW': zhTW, en, ja };

let current: Locale = 'zh-TW';

/** 「跟隨系統」時依系統語言決定：中文（不分繁簡）用繁體中文，日文用日文，其他用英文。 */
export function resolveLocale(setting: LanguageSetting, preferred: readonly string[] = navigatorLanguages()): Locale {
  if (setting !== 'auto') return setting;
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('zh')) return 'zh-TW';
    if (lower.startsWith('ja')) return 'ja';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}

function navigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export function setLocale(locale: Locale): void {
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[locale];
}

export function locale(): Locale {
  return current;
}

/** 取得目前語言的文字；{name} 換成 params 裡的值。 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = DICTIONARIES[current][key] ?? zhTW[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/**
 * 翻譯 HTML 裡寫好的元素：data-i18n 換文字，data-i18n-label 換 aria-label，data-i18n-title 換滑鼠提示。
 */
export function translateDom(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as MessageKey);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel as MessageKey));
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle as MessageKey);
}

/**
 * 歌詞來源附的翻譯都是中文：只在繁體中文介面顯示。英文、日文介面拿掉翻譯按鈕與開關，也不顯示翻譯。
 */
export function showsChineseTranslations(): boolean {
  return current === 'zh-TW';
}

/** 依目前語言格式化日期（設定頁的授權期限） */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(HTML_LANG[current]);
}
