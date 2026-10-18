import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, SettingsStore, type KeyValueStorage } from './settings';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('parseSettings', () => {
  it('fills in defaults for missing or invalid fields', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ quality: 'ultra', fontScale: 'huge', showTranslation: 'yes', offsetMs: 'soon' })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('keeps valid values and clamps the offset', () => {
    expect(parseSettings({ quality: 'low', fontScale: 'large', showTranslation: false, offsetMs: 9999, showDebug: true })).toEqual({
      ...DEFAULT_SETTINGS,
      quality: 'low',
      fontScale: 'large',
      showTranslation: false,
      offsetMs: 2000,
      showDebug: true,
    });
    expect(parseSettings({ offsetMs: -149.6 }).offsetMs).toBe(-150);
  });

  it('accepts the two lyric effects only', () => {
    expect(parseSettings({ lyricEffect: 'write' }).lyricEffect).toBe('write');
    expect(parseSettings({ lyricEffect: 'typewriter' }).lyricEffect).toBe('fill');
  });

  it('accepts only the listed lyric typefaces', () => {
    expect(parseSettings({ fontZh: 'wenkai', fontJa: 'klee', fontLatin: 'playfair' })).toMatchObject({
      fontZh: 'wenkai',
      fontJa: 'klee',
      fontLatin: 'playfair',
    });
    expect(parseSettings({ fontZh: 'comic', fontJa: 1, fontLatin: null })).toMatchObject({
      fontZh: 'sans',
      fontJa: 'gothic',
      fontLatin: 'sans',
    });
  });

  it('keeps the language, blur and dimming settings in range', () => {
    expect(parseSettings({ language: 'ja' }).language).toBe('ja');
    expect(parseSettings({ language: 'fr' }).language).toBe('auto');
    expect(parseSettings({ blurStrength: 9 }).blurStrength).toBe(2);
    expect(parseSettings({ blurStrength: 'x' }).blurStrength).toBe(1);
    expect(parseSettings({ dimLevel: 0 }).dimLevel).toBe(0.12);
    expect(parseSettings({ dimLevel: 0.456 }).dimLevel).toBe(0.46);
    expect(parseSettings({})).toMatchObject({ lyricBold: true, lyricBlur: true, spotifyQueue: true });
  });

  it('chooses the desktop lyrics effect separately from the main view', () => {
    expect(parseSettings({ lyricEffect: 'write' }).desktopEffect).toBe('fill');
    expect(parseSettings({ desktopEffect: 'write' })).toMatchObject({ lyricEffect: 'fill', desktopEffect: 'write' });
    expect(parseSettings({ desktopEffect: 'typewriter' }).desktopEffect).toBe('fill');
  });

  it('keeps the desktop lyrics scale in range and its position as whole pixels', () => {
    expect(parseSettings({ desktopScale: 5 }).desktopScale).toBe(1.8);
    expect(parseSettings({ desktopScale: 0.2 }).desktopScale).toBe(0.7);
    expect(parseSettings({ desktopScale: 1.23 }).desktopScale).toBe(1.2);
    expect(parseSettings({ desktopX: 120.6, desktopY: 'nope' })).toMatchObject({ desktopX: 121, desktopY: null });
  });
});

describe('SettingsStore', () => {
  it('saves updates and notifies listeners only on real changes', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    store.update({ quality: 'medium' });
    store.update({ quality: 'medium' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.data.get('lyrics-app.settings')!).quality).toBe('medium');
    expect(new SettingsStore(storage).get().quality).toBe('medium');
  });

  it('moves the settings saved by the first version and removes the old keys', () => {
    const storage = memoryStorage({
      'lyrics-app.offsetMs': '300',
      'lyrics-app.showTranslation': '0',
      'lyrics-app.debugVisible': '1',
    });
    const settings = new SettingsStore(storage).get();
    // 除錯面板不搬：第一版啟動時一律寫入「顯示」
    expect(settings).toMatchObject({ offsetMs: 300, showTranslation: false, showDebug: false });
    expect(storage.data.has('lyrics-app.offsetMs')).toBe(false);
    expect(storage.data.has('lyrics-app.debugVisible')).toBe(false);
    expect(storage.data.has('lyrics-app.settings')).toBe(true);
  });

  it('picks up changes another window saved', () => {
    const store = new SettingsStore(memoryStorage());
    const listener = vi.fn();
    store.subscribe(listener);
    const otherWindow = new EventTarget();
    store.listenToOtherWindows(otherWindow);
    const storageEvent = (key: string, newValue: string | null) => Object.assign(new Event('storage'), { key, newValue });

    otherWindow.dispatchEvent(storageEvent('lyrics-app.settings', JSON.stringify({ desktopLocked: true, desktopScale: 1.4 })));
    expect(store.get()).toMatchObject({ desktopLocked: true, desktopScale: 1.4 });
    expect(listener).toHaveBeenCalledTimes(1);

    // 其他鍵、壞掉的內容、沒有變化的內容都不通知
    otherWindow.dispatchEvent(storageEvent('something-else', '{}'));
    otherWindow.dispatchEvent(storageEvent('lyrics-app.settings', '{broken'));
    otherWindow.dispatchEvent(storageEvent('lyrics-app.settings', JSON.stringify(store.get())));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps working in memory when storage throws', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = new SettingsStore(broken);
    store.update({ fontScale: 'small' });
    expect(store.get().fontScale).toBe('small');
  });
});
