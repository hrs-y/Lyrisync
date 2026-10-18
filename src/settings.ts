import type { LanguageSetting } from './i18n';

export type QualitySetting = 'auto' | 'high' | 'medium' | 'low';
export type FontScale = 'small' | 'medium' | 'large';
/** fill：整段歌詞先顯示，唱到的字亮起；write：唱到才一個字一個字寫出來 */
export type LyricEffect = 'fill' | 'write';
/** 歌詞字體：中文、日文、英文（拉丁字母）各自選；字體清單在 ui/fonts.ts */
export type ZhFont = 'sans' | 'serif' | 'wenkai' | 'kai';
export type JaFont = 'gothic' | 'mincho' | 'klee' | 'maru';
export type LatinFont = 'sans' | 'garamond' | 'baskerville' | 'playfair';

export interface Settings {
  /** 介面語言；auto 跟隨系統 */
  language: LanguageSetting;
  /** 動畫品質；auto 會依裝置與實際影格率調整 */
  quality: QualitySetting;
  fontScale: FontScale;
  lyricEffect: LyricEffect;
  fontZh: ZhFont;
  fontJa: JaFont;
  fontLatin: LatinFont;
  /** 歌詞用粗體；關掉時用各字體較細的字重 */
  lyricBold: boolean;
  /** 景深模糊：離目前的行越遠越模糊（動畫品質為高時才有） */
  lyricBlur: boolean;
  /** 模糊程度倍率 */
  blurStrength: number;
  /** 目前這一行以外的歌詞亮度（0～1） */
  dimLevel: number;
  showTranslation: boolean;
  /** 羅馬拼音（日文、韓文歌的讀音） */
  showRomanization: boolean;
  /** 歌詞時間偏移（毫秒），正數代表歌詞提早 */
  offsetMs: number;
  showDebug: boolean;
  /** 連結 Spotify 時，預先找播放佇列裡下一首的歌詞 */
  spotifyPrefetch: boolean;
  /** 連結 Spotify 時，播放頁顯示按讚按鈕 */
  spotifyLike: boolean;
  /** 連結 Spotify 時，歌詞欄顯示待播清單按鈕 */
  spotifyQueue: boolean;
  /** 顯示桌面歌詞 */
  desktopLyrics: boolean;
  /** 桌面歌詞的效果，和主畫面分開選 */
  desktopEffect: LyricEffect;
  /** 鎖定後滑鼠會穿透桌面歌詞，不會擋到底下的視窗；要移動或調整時先解鎖 */
  desktopLocked: boolean;
  /** 桌面歌詞的字級倍率 */
  desktopScale: number;
  /** 桌面歌詞視窗左上角的位置（邏輯像素）；null 代表用預設位置（螢幕下方置中） */
  desktopX: number | null;
  desktopY: number | null;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  language: 'auto',
  quality: 'auto',
  fontScale: 'medium',
  lyricEffect: 'fill',
  fontZh: 'sans',
  fontJa: 'gothic',
  fontLatin: 'sans',
  lyricBold: true,
  lyricBlur: true,
  blurStrength: 1,
  dimLevel: 0.3,
  showTranslation: true,
  showRomanization: true,
  offsetMs: 0,
  showDebug: false,
  spotifyPrefetch: true,
  spotifyLike: true,
  spotifyQueue: true,
  desktopLyrics: false,
  desktopEffect: 'fill',
  desktopLocked: false,
  desktopScale: 1,
  desktopX: null,
  desktopY: null,
};

export const OFFSET_LIMIT_MS = 2000;
export const BLUR_STRENGTH_MIN = 0.4;
export const BLUR_STRENGTH_MAX = 2;
export const DIM_LEVEL_MIN = 0.12;
export const DIM_LEVEL_MAX = 0.7;
export const DESKTOP_SCALE_MIN = 0.7;
export const DESKTOP_SCALE_MAX = 1.8;

const STORAGE_KEY = 'lyrics-app.settings';
/** 第一版各自分開存的設定，第一次啟動新版時搬過來 */
const LEGACY_KEYS = {
  offsetMs: 'lyrics-app.offsetMs',
  showTranslation: 'lyrics-app.showTranslation',
  showDebug: 'lyrics-app.debugVisible',
} as const;

const LANGUAGES: readonly LanguageSetting[] = ['auto', 'zh-TW', 'en', 'ja'];
const QUALITIES: readonly QualitySetting[] = ['auto', 'high', 'medium', 'low'];
const FONT_SCALES: readonly FontScale[] = ['small', 'medium', 'large'];
const LYRIC_EFFECTS: readonly LyricEffect[] = ['fill', 'write'];
export const ZH_FONTS: readonly ZhFont[] = ['sans', 'serif', 'wenkai', 'kai'];
export const JA_FONTS: readonly JaFont[] = ['gothic', 'mincho', 'klee', 'maru'];
export const LATIN_FONTS: readonly LatinFont[] = ['sans', 'garamond', 'baskerville', 'playfair'];

const bool = (candidate: unknown, fallback: boolean) => (typeof candidate === 'boolean' ? candidate : fallback);
/** 限制在範圍內，取到小數第二位；不是數字就用預設值 */
const ranged = (candidate: unknown, min: number, max: number, fallback: number) => {
  const value = Number(candidate);
  return Number.isFinite(value) && candidate !== null && candidate !== '' ? Math.round(Math.max(min, Math.min(max, value)) * 100) / 100 : fallback;
};
const coordinate = (candidate: unknown) =>
  typeof candidate === 'number' && Number.isFinite(candidate) ? Math.round(candidate) : null;

/** 從任意資料整理出合法的設定，不合法的欄位用預設值。 */
export function parseSettings(raw: unknown): Settings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const pick = <T>(candidate: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(candidate as T) ? (candidate as T) : fallback;
  const offset = Number(value.offsetMs);
  const scale = Number(value.desktopScale);
  return {
    language: pick(value.language, LANGUAGES, DEFAULT_SETTINGS.language),
    quality: pick(value.quality, QUALITIES, DEFAULT_SETTINGS.quality),
    fontScale: pick(value.fontScale, FONT_SCALES, DEFAULT_SETTINGS.fontScale),
    lyricEffect: pick(value.lyricEffect, LYRIC_EFFECTS, DEFAULT_SETTINGS.lyricEffect),
    fontZh: pick(value.fontZh, ZH_FONTS, DEFAULT_SETTINGS.fontZh),
    fontJa: pick(value.fontJa, JA_FONTS, DEFAULT_SETTINGS.fontJa),
    fontLatin: pick(value.fontLatin, LATIN_FONTS, DEFAULT_SETTINGS.fontLatin),
    lyricBold: bool(value.lyricBold, DEFAULT_SETTINGS.lyricBold),
    lyricBlur: bool(value.lyricBlur, DEFAULT_SETTINGS.lyricBlur),
    blurStrength: ranged(value.blurStrength, BLUR_STRENGTH_MIN, BLUR_STRENGTH_MAX, DEFAULT_SETTINGS.blurStrength),
    dimLevel: ranged(value.dimLevel, DIM_LEVEL_MIN, DIM_LEVEL_MAX, DEFAULT_SETTINGS.dimLevel),
    showTranslation: bool(value.showTranslation, DEFAULT_SETTINGS.showTranslation),
    showRomanization: bool(value.showRomanization, DEFAULT_SETTINGS.showRomanization),
    offsetMs: Number.isFinite(offset)
      ? Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, Math.round(offset)))
      : DEFAULT_SETTINGS.offsetMs,
    showDebug: bool(value.showDebug, DEFAULT_SETTINGS.showDebug),
    spotifyPrefetch: bool(value.spotifyPrefetch, DEFAULT_SETTINGS.spotifyPrefetch),
    spotifyLike: bool(value.spotifyLike, DEFAULT_SETTINGS.spotifyLike),
    spotifyQueue: bool(value.spotifyQueue, DEFAULT_SETTINGS.spotifyQueue),
    desktopLyrics: bool(value.desktopLyrics, DEFAULT_SETTINGS.desktopLyrics),
    desktopEffect: pick(value.desktopEffect, LYRIC_EFFECTS, DEFAULT_SETTINGS.desktopEffect),
    desktopLocked: bool(value.desktopLocked, DEFAULT_SETTINGS.desktopLocked),
    desktopScale: Number.isFinite(scale)
      ? Math.round(Math.max(DESKTOP_SCALE_MIN, Math.min(DESKTOP_SCALE_MAX, scale)) * 10) / 10
      : DEFAULT_SETTINGS.desktopScale,
    desktopX: coordinate(value.desktopX),
    desktopY: coordinate(value.desktopY),
  };
}

function sameSettings(a: Settings, b: Settings): boolean {
  return (Object.keys(a) as (keyof Settings)[]).every((key) => a[key] === b[key]);
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage 在某些情況會丟出錯誤（例如被停用），拿不到就回傳 null，設定只存在記憶體。 */
export function browserStorage(): KeyValueStorage | null {
  try {
    const storage = window.localStorage;
    storage.getItem(STORAGE_KEY);
    return storage;
  } catch {
    return null;
  }
}

type Listener = (settings: Settings, previous: Settings) => void;

export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly storage: KeyValueStorage | null) {
    this.value = this.load();
  }

  get(): Settings {
    return this.value;
  }

  update(patch: Partial<Settings>): void {
    const next = parseSettings({ ...this.value, ...patch });
    if (sameSettings(next, this.value)) return;
    this.set(next);
    this.save();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 主視窗和桌面歌詞共用同一份設定。另一個視窗改了設定時，瀏覽器會在這個視窗發出 storage 事件
   * （改的那個視窗自己不會收到），這時重新讀取並通知。
   */
  listenToOtherWindows(target: Pick<Window, 'addEventListener'> = window): void {
    target.addEventListener('storage', (event) => {
      const { key, newValue } = event as StorageEvent;
      if (key !== STORAGE_KEY || newValue === null) return;
      let next: Settings;
      try {
        next = parseSettings(JSON.parse(newValue));
      } catch {
        return;
      }
      if (!sameSettings(next, this.value)) this.set(next);
    });
  }

  private set(next: Settings): void {
    const previous = this.value;
    this.value = next;
    for (const listener of this.listeners) listener(next, previous);
  }

  private load(): Settings {
    const raw = this.read(STORAGE_KEY);
    if (raw !== null) {
      try {
        return parseSettings(JSON.parse(raw));
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    }
    // 第一次啟動新版：搬移使用者自己調過的舊設定。
    // 除錯面板不搬：第一版啟動時一律會寫入「顯示」，那不是使用者的選擇，新版預設隱藏
    const legacyOffset = this.read(LEGACY_KEYS.offsetMs);
    const legacyTranslation = this.read(LEGACY_KEYS.showTranslation);
    const migrated = parseSettings({
      offsetMs: legacyOffset === null ? undefined : Number(legacyOffset),
      showTranslation: legacyTranslation === null ? undefined : legacyTranslation !== '0',
    });
    this.value = migrated;
    this.save();
    for (const key of Object.values(LEGACY_KEYS)) this.remove(key);
    return migrated;
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // 存不了就只留在記憶體，下次啟動回到預設值
    }
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private remove(key: string): void {
    try {
      this.storage?.removeItem(key);
    } catch {
      // 刪不掉也無妨
    }
  }
}
