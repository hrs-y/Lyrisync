// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n';
import { SettingsStore } from '../settings';
import { UNAVAILABLE_STATUS, type SpotifyStatus } from '../spotify/api';
import { SettingsPanel, type SpotifyActions } from './settingsPanel';

let root: HTMLElement;
let store: SettingsStore;
let panel: SettingsPanel;
let clearCache: ReturnType<typeof vi.fn<() => Promise<number>>>;
const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;

beforeEach(() => {
  document.body.innerHTML = '<div class="settings" hidden></div>';
  root = document.querySelector<HTMLElement>('.settings')!;
  store = new SettingsStore(null);
  clearCache = vi.fn(async () => 7);
  panel = new SettingsPanel(root, store, { clearCache });
});

describe('SettingsPanel', () => {
  it('changes the animation quality from the segmented control', () => {
    $<HTMLButtonElement>('.quality-options [data-value="low"]').click();
    expect(store.get().quality).toBe('low');
    expect($('.quality-options [data-value="low"]').getAttribute('aria-checked')).toBe('true');
    expect($('.quality-hint').textContent).toContain('最省電');
  });

  it('switches the lyric effect and explains it', () => {
    expect($('.effect-hint').textContent).toContain('亮起');
    $<HTMLButtonElement>('.effect-options [data-value="write"]').click();
    expect(store.get().lyricEffect).toBe('write');
    expect($('.effect-options [data-value="write"]').getAttribute('aria-checked')).toBe('true');
    expect($('.effect-hint').textContent).toContain('寫出');
  });

  it('picks lyric typefaces from cards that preview each font', () => {
    const latin = $('.latin-typefaces');
    expect(latin.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(latin.querySelector<HTMLElement>('[data-value="garamond"] .typeface-sample')?.style.fontFamily).toContain('EB Garamond');
    $<HTMLButtonElement>('.latin-typefaces [data-value="garamond"]').click();
    $<HTMLButtonElement>('.zh-typefaces [data-value="wenkai"]').click();
    $<HTMLButtonElement>('.ja-typefaces [data-value="mincho"]').click();
    expect(store.get()).toMatchObject({ fontLatin: 'garamond', fontZh: 'wenkai', fontJa: 'mincho' });
    expect($('.latin-typefaces [data-value="garamond"]').getAttribute('aria-checked')).toBe('true');
    expect($('.latin-typefaces [data-value="sans"]').getAttribute('aria-checked')).toBe('false');
  });

  it('shows the level automatic mode is using', () => {
    panel.setEffectiveLevel('medium', true);
    expect($('.quality-current').textContent).toBe('目前：中');
  });

  it('toggles switches and reflects outside changes', () => {
    $<HTMLButtonElement>('.translation-switch').click();
    expect(store.get().showTranslation).toBe(false);
    store.update({ showDebug: true });
    expect($('.debug-switch').getAttribute('aria-checked')).toBe('true');
  });

  it('updates the time offset from the slider and resets it', () => {
    const input = $<HTMLInputElement>('#offset-input');
    input.value = '250';
    input.dispatchEvent(new Event('input'));
    expect(store.get().offsetMs).toBe(250);
    expect($('.offset-value').textContent).toBe('+250 ms・歌詞提早');
    $<HTMLButtonElement>('.offset-reset').click();
    expect(store.get().offsetMs).toBe(0);
  });

  it('controls the desktop lyrics window', () => {
    $<HTMLButtonElement>('.desktop-switch').click();
    $<HTMLButtonElement>('.desktop-lock-switch').click();
    expect(store.get()).toMatchObject({ desktopLyrics: true, desktopLocked: true });

    const input = $<HTMLInputElement>('#desktop-scale-input');
    input.value = '1.3';
    input.dispatchEvent(new Event('input'));
    expect(store.get().desktopScale).toBe(1.3);
    expect($('.desktop-scale-input-value').textContent).toBe('130%');

    // 桌面歌詞視窗被拖曳過，再按「回到預設位置」
    store.update({ desktopX: 300, desktopY: 900 });
    $<HTMLButtonElement>('.desktop-reset').click();
    expect(store.get()).toMatchObject({ desktopX: null, desktopY: null });
  });

  it('chooses the desktop lyrics effect separately and explains it', () => {
    expect($('.desktop-effect-hint').textContent).toContain('預告下一句');
    $<HTMLButtonElement>('.desktop-effect-options [data-value="write"]').click();
    expect(store.get()).toMatchObject({ desktopEffect: 'write', lyricEffect: 'fill' });
    expect($('.desktop-effect-hint').textContent).toContain('寫出');
  });

  it('shows one category at a time and remembers it', () => {
    const visible = () => Array.from(root.querySelectorAll<HTMLElement>('.settings-page:not([hidden])'), (p) => p.dataset.page);
    expect(visible()).toEqual(['lyrics']);
    expect($('.page-title').textContent).toBe('歌詞');

    $<HTMLButtonElement>('[role="tab"][data-page="desktop"]').click();
    expect(visible()).toEqual(['desktop']);
    expect(panel.currentPage).toBe('desktop');
    expect($('.page-title').textContent).toBe('桌面歌詞');
    expect($('[role="tab"][data-page="desktop"]').getAttribute('aria-selected')).toBe('true');
    expect($('[role="tab"][data-page="lyrics"]').getAttribute('aria-selected')).toBe('false');

    panel.open();
    panel.close();
    panel.open();
    expect(visible()).toEqual(['desktop']);
    panel.open('about');
    expect(visible()).toEqual(['about']);
  });

  it('moves between categories with the arrow keys', () => {
    const tab = $<HTMLButtonElement>('[role="tab"][data-page="lyrics"]');
    tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(panel.currentPage).toBe('desktop');
    $('[role="tab"][data-page="desktop"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(panel.currentPage).toBe('about');
    $('[role="tab"][data-page="about"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(panel.currentPage).toBe('general');
  });

  it('fills the time offset slider from the middle', () => {
    store.update({ offsetMs: -1000 });
    const input = $<HTMLInputElement>('#offset-input');
    expect(input.style.getPropertyValue('--from')).toBe('0.250');
    expect(input.style.getPropertyValue('--to')).toBe('0.500');
  });

  it('clears the cache and reports how many songs were removed', async () => {
    $<HTMLButtonElement>('.cache-clear').click();
    await vi.waitFor(() => expect($('.cache-status').textContent).toBe('已清除 7 首歌的歌詞。'));
    expect(clearCache).toHaveBeenCalledOnce();
  });

  it('opens and closes', () => {
    panel.open();
    expect(panel.isOpen).toBe(true);
    expect(root.hidden).toBe(false);
    expect(root.classList.contains('open')).toBe(true);
    panel.close();
    expect(panel.isOpen).toBe(false);
    expect(root.classList.contains('open')).toBe(false);
  });
});

describe('SettingsPanel appearance and language', () => {
  it('switches bold and depth blur, and only lets you tune the blur while it is on', () => {
    $<HTMLButtonElement>('.bold-switch').click();
    expect(store.get().lyricBold).toBe(false);
    const blur = $<HTMLInputElement>('#blur-input');
    expect(blur.disabled).toBe(false);
    blur.value = '1.5';
    blur.dispatchEvent(new Event('input'));
    expect(store.get().blurStrength).toBe(1.5);
    expect($('.blur-input-value').textContent).toBe('150%');
    $<HTMLButtonElement>('.blur-switch').click();
    expect(store.get().lyricBlur).toBe(false);
    expect(blur.disabled).toBe(true);
    expect($('.blur-strength-row').classList.contains('disabled')).toBe(true);
  });

  it('sets how bright the other lines are', () => {
    const dim = $<HTMLInputElement>('#dim-input');
    dim.value = '0.5';
    dim.dispatchEvent(new Event('input'));
    expect(store.get().dimLevel).toBe(0.5);
    expect($('.dim-input-value').textContent).toBe('50%');
  });

  it('chooses the interface language from cards that name each language in itself', () => {
    const names = Array.from(root.querySelectorAll('.language-options .typeface-name'), (name) => name.textContent);
    expect(names).toEqual(['跟隨系統', '繁體中文', 'English', '日本語']);
    expect($('.language-options [data-value="ja"] .typeface-detail').textContent).toBe('日文');
    $<HTMLButtonElement>('.language-options [data-value="ja"]').click();
    expect(store.get().language).toBe('ja');
    expect($('.language-options [data-value="ja"]').getAttribute('aria-checked')).toBe('true');
  });

  it('leaves out the Chinese translation switch and shortcut outside the Chinese interface', () => {
    expect($('.translation-switch').closest<HTMLElement>('.row')!.hidden).toBe(false);
    setLocale('en');
    try {
      document.body.innerHTML = '<div class="settings" hidden></div>';
      root = document.querySelector<HTMLElement>('.settings')!;
      new SettingsPanel(root, new SettingsStore(null), { clearCache: vi.fn(async () => 0) });
      expect($('.translation-switch').closest<HTMLElement>('.row')!.hidden).toBe(true);
      expect(root.textContent).not.toContain('Show/hide translation');
      expect(root.textContent).toContain('Show/hide romanization');
    } finally {
      setLocale('zh-TW');
    }
  });
});

describe('SettingsPanel Spotify page', () => {
  const status = (patch: Partial<SpotifyStatus>): SpotifyStatus => ({ ...UNAVAILABLE_STATUS, ...patch });
  let spotify: { [K in keyof SpotifyActions]: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    document.body.innerHTML = '<div class="settings" hidden></div>';
    root = document.querySelector<HTMLElement>('.settings')!;
    store = new SettingsStore(null);
    spotify = { login: vi.fn(async () => {}), cancelLogin: vi.fn(async () => {}), logout: vi.fn(async () => {}), openDashboard: vi.fn(async () => {}) };
    panel = new SettingsPanel(root, store, { clearCache: vi.fn(async () => 0), spotify: spotify as unknown as SpotifyActions });
  });

  it('asks for a Client ID while disconnected and checks its shape before opening the browser', () => {
    panel.setSpotifyStatus(status({ state: 'disconnected' }));
    expect($('.spotify-connect').hidden).toBe(false);
    expect($('.spotify-connected').hidden).toBe(true);
    const input = $<HTMLInputElement>('#spotify-client-id');
    input.value = 'not-an-id';
    $<HTMLButtonElement>('.spotify-login').click();
    expect(spotify.login).not.toHaveBeenCalled();
    expect($('.spotify-error').textContent).toContain('32');

    input.value = ' 0123456789abcdef0123456789abcdef ';
    $<HTMLButtonElement>('.spotify-login').click();
    expect(spotify.login).toHaveBeenCalledWith('0123456789abcdef0123456789abcdef');
  });

  it('shows who is connected and lets you disconnect', () => {
    panel.setSpotifyStatus(status({ state: 'connected', userName: '測試帳號', clientId: 'abc', expiresAt: Date.UTC(2027, 3, 18) }));
    expect($('.spotify-pill').textContent).toBe('已連結');
    expect($('.spotify-user').textContent).toBe('已連結：測試帳號');
    expect($('.spotify-expiry').textContent).toContain('2027');
    expect($('.spotify-connect').hidden).toBe(true);
    $<HTMLButtonElement>('.spotify-logout').click();
    expect(spotify.logout).toHaveBeenCalledOnce();
  });

  it('keeps the Client ID when the authorization expired, so reconnecting is one click', () => {
    panel.setSpotifyStatus(status({ state: 'expired', clientId: '0123456789abcdef0123456789abcdef', error: '授權已過期' }));
    expect($<HTMLInputElement>('#spotify-client-id').value).toBe('0123456789abcdef0123456789abcdef');
    expect($('.spotify-pill').textContent).toBe('需要重新連結');
    expect($('.spotify-error-row').hidden).toBe(false);
  });

  it('shows a cancel button while waiting for the browser login', () => {
    panel.setSpotifyStatus(status({ state: 'logging-in' }));
    expect($('.spotify-waiting').hidden).toBe(false);
    $<HTMLButtonElement>('.spotify-cancel').click();
    expect(spotify.cancelLogin).toHaveBeenCalledOnce();
  });

  it('toggles prefetching and the like button', () => {
    $<HTMLButtonElement>('.spotify-prefetch-switch').click();
    $<HTMLButtonElement>('.spotify-like-switch').click();
    expect(store.get()).toMatchObject({ spotifyPrefetch: false, spotifyLike: false });
  });
});

describe('SettingsPanel without Spotify (browser preview)', () => {
  it('says Spotify is unavailable and disables the form', () => {
    expect($('.spotify-pill').textContent).toBe('無法使用');
    expect($<HTMLInputElement>('#spotify-client-id').disabled).toBe(true);
  });
});
