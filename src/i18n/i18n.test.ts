// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en';
import { locale, resolveLocale, setLocale, t, translateDom } from './index';
import { ja } from './ja';
import { zhTW } from './zh-TW';

afterEach(() => setLocale('zh-TW'));

describe('resolveLocale', () => {
  it('follows the system language: any Chinese, Japanese, otherwise English', () => {
    expect(resolveLocale('auto', ['zh-TW'])).toBe('zh-TW');
    expect(resolveLocale('auto', ['zh-CN', 'en-US'])).toBe('zh-TW');
    expect(resolveLocale('auto', ['ja-JP'])).toBe('ja');
    expect(resolveLocale('auto', ['fr-FR', 'en-GB'])).toBe('en');
    expect(resolveLocale('auto', ['ko-KR'])).toBe('en');
    expect(resolveLocale('ja', ['zh-TW'])).toBe('ja');
  });
});

describe('t', () => {
  it('fills in values and switches languages, updating <html lang>', () => {
    expect(t('settings.spotify.connectedAs', { name: '測試' })).toBe('已連結：測試');
    setLocale('en');
    expect(locale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(t('settings.spotify.connectedAs', { name: 'Pat' })).toBe('Connected as Pat');
    setLocale('ja');
    expect(t('lyrics.otherVersion', { index: 2, count: 3 })).toBe('ほかのバージョン 2/3');
  });

  it('leaves unknown placeholders alone', () => {
    expect(t('lyrics.credit')).toBe('歌詞來源：{source}');
  });
});

describe('dictionaries', () => {
  it('translate every key, with the same placeholders', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const dict of [en, ja]) {
      for (const [key, text] of Object.entries(zhTW)) {
        const translated = dict[key as keyof typeof zhTW];
        expect(translated, key).toBeTruthy();
        expect(placeholders(translated), key).toBe(placeholders(text));
      }
    }
  });
});

describe('translateDom', () => {
  it('fills text, aria-label and title from data attributes', () => {
    document.body.innerHTML = `<button data-i18n="player.searchAgain" data-i18n-label="player.next" data-i18n-title="titlebar.close"></button>`;
    setLocale('en');
    translateDom(document);
    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('Search again');
    expect(button.getAttribute('aria-label')).toBe('Next');
    expect(button.title).toBe('Close');
  });
});
