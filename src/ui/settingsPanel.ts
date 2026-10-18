import {
  formatDate,
  LOCALE_NAMES,
  LOCALES,
  resolveLocale,
  showsChineseTranslations,
  t,
  type LanguageSetting,
  type Locale,
  type MessageKey,
} from '../i18n';
import {
  BLUR_STRENGTH_MAX,
  BLUR_STRENGTH_MIN,
  DESKTOP_SCALE_MAX,
  DESKTOP_SCALE_MIN,
  DIM_LEVEL_MAX,
  DIM_LEVEL_MIN,
  OFFSET_LIMIT_MS,
  type FontScale,
  type LyricEffect,
  type QualitySetting,
  type Settings,
  type SettingsStore,
} from '../settings';
import { REDIRECT_URI, UNAVAILABLE_STATUS, type SpotifyStatus } from '../spotify/api';
import { spotifyErrorText } from '../spotify/errors';
import { signed } from '../util/format';
import {
  JA_FONT_OPTIONS,
  LATIN_FONT_OPTIONS,
  loadFont,
  optionDetail,
  optionLabel,
  weightOf,
  ZH_FONT_OPTIONS,
  type FontOption,
} from './fonts';
import logoUrl from '../assets/logo.svg';
import { icon, type IconName } from './icons';
import type { QualityLevel } from './quality';

export interface SettingsActions {
  /** 清除所有歌詞快取，回傳刪了幾首 */
  clearCache(): Promise<number>;
  /** 連結 Spotify（瀏覽器預覽沒有） */
  spotify?: SpotifyActions;
}

export interface SpotifyActions {
  login(clientId: string): Promise<unknown>;
  cancelLogin(): Promise<void>;
  logout(): Promise<unknown>;
  openDashboard(): Promise<void>;
}

export type SettingsPage = 'general' | 'lyrics' | 'desktop' | 'spotify' | 'shortcuts' | 'advanced' | 'about';

const PAGES: ReadonlyArray<{ id: SettingsPage; icon: IconName }> = [
  { id: 'general', icon: 'sparkle' },
  { id: 'lyrics', icon: 'note' },
  { id: 'desktop', icon: 'desktopLyrics' },
  { id: 'spotify', icon: 'link' },
  { id: 'shortcuts', icon: 'keyboard' },
  { id: 'advanced', icon: 'terminal' },
  { id: 'about', icon: 'info' },
];

const QUALITIES: readonly QualitySetting[] = ['auto', 'high', 'medium', 'low'];
const FONT_SCALES: readonly FontScale[] = ['small', 'medium', 'large'];
const EFFECTS: readonly LyricEffect[] = ['fill', 'write'];
const LANGUAGES: readonly LanguageSetting[] = ['auto', ...LOCALES];
/** 每一項是可以互相替代的按鍵；同時按的組合用 + 連起來 */
const SHORTCUTS: ReadonlyArray<[string[], MessageKey]> = [
  [['key.space'], 'shortcut.playPause'],
  [['←', '→'], 'shortcut.seek'],
  [['S'], 'shortcut.nextVersion'],
  [['R'], 'shortcut.refetch'],
  [['T'], 'shortcut.translation'],
  [['J'], 'shortcut.romanization'],
  [['Q'], 'shortcut.queue'],
  [['L'], 'shortcut.desktop'],
  [['F11'], 'shortcut.fullscreen'],
  [['Ctrl+,'], 'shortcut.settings'],
  [['D'], 'shortcut.debug'],
];
const MOUSE_ACTIONS: readonly MessageKey[] = ['mouse.line', 'mouse.wheel', 'mouse.progress', 'mouse.cover', 'mouse.artist'];
/** 顯示在關於頁的版本（和 package.json、tauri.conf.json 的 0.1.0 一致） */
const APP_VERSION = 'v0.1';
/** 關於頁的致謝：名稱不翻譯，說明依介面語言 */
const THANKS: ReadonlyArray<[string, MessageKey]> = [
  ['Apple Music', 'about.thanks.appleMusic'],
  ['Tauri', 'about.thanks.tauri'],
  ['TypeScript・Vite・Vitest', 'about.thanks.web'],
  ['Windows SMTC', 'about.thanks.smtc'],
  ['Spotify Web API', 'about.thanks.spotify'],
  ['AMLL TTML DB・LRCLIB', 'about.thanks.lyrics'],
  ['opencc-js', 'about.thanks.opencc'],
  ['jixunmoe-go/qrc', 'about.thanks.qrc'],
  ['Fontsource', 'about.thanks.fonts'],
];
/** 字體卡片上的範例文字 */
const TYPEFACE_SAMPLES = { zh: '一樣的月光', ja: 'いい日旅立ち', latin: 'Moon River' } as const;
/** 語言卡片上的代表字，用那個語言的字型寫 */
const LANGUAGE_GLYPHS: Record<Locale, { text: string; font: string }> = {
  'zh-TW': { text: '文', font: '"Microsoft JhengHei UI", "Microsoft JhengHei", sans-serif' },
  en: { text: 'EN', font: '"Segoe UI Variable Display", "Segoe UI", sans-serif' },
  ja: { text: 'あ', font: '"Yu Gothic UI", "Yu Gothic", "Meiryo UI", sans-serif' },
};
const OFFSET_STEP_MS = 50;
const CLOSE_MS = 420;
const PAGE_ENTER_MS = 320;

/** 一列設定：左邊標題與說明，右邊控制項 */
const row = (title: string, hint: string, control: string, labelId = '', hintClass = '') => `
  <div class="row">
    <div class="row-text">
      <span class="row-title"${labelId ? ` id="${labelId}"` : ''}>${title}</span>
      ${hint || hintClass ? `<span class="row-hint ${hintClass}">${hint}</span>` : ''}
    </div>
    <div class="row-control">${control}</div>
  </div>`;
const switchRow = (title: MessageKey, hint: MessageKey, className: string) =>
  row(
    t(title),
    t(hint),
    `<button class="switch ${className}" type="button" role="switch" aria-labelledby="${className}-label"></button>`,
    `${className}-label`,
  );
const segmentedRow = (title: MessageKey, className: string, hintClass = '', label = t(title)) =>
  row(t(title), '', `<div class="segmented ${className}" role="radiogroup" aria-label="${label}"></div>`, '', hintClass);
/** 滑桿：標題與數值在上，滑桿佔滿整列，說明在下 */
const sliderRow = (title: MessageKey, id: string, min: number, max: number, step: number, hint?: MessageKey, extraClass = '') => `
  <div class="row stacked ${extraClass}">
    <div class="row-head"><label class="row-title" for="${id}">${t(title)}</label><span class="row-value ${id}-value"></span></div>
    <input id="${id}" class="slider" type="range" min="${min}" max="${max}" step="${step}" />
    ${hint ? `<span class="row-hint">${t(hint)}</span>` : ''}
  </div>`;
/** 字體選擇：一排卡片，每張用那個字體寫範例文字 */
const typefaceRow = (title: MessageKey, hint: MessageKey, className: string, label: MessageKey) => `
  <div class="row stacked">
    <div class="row-text"><span class="row-title">${t(title)}</span><span class="row-hint">${t(hint)}</span></div>
    <div class="typefaces ${className}" role="radiogroup" aria-label="${t(label)}"></div>
  </div>`;
const card = (title: string, rows: string) => `
  <section class="settings-group">
    ${title ? `<h4>${title}</h4>` : ''}
    <div class="card">${rows}</div>
  </section>`;
const note = (key: MessageKey) => `<p class="page-note">${t(key)}</p>`;
/** 一個分類的內容；同時只顯示一頁 */
const pageSection = (id: SettingsPage, parts: string[]) => `
  <section class="settings-page" role="tabpanel" id="settings-page-${id}" data-page="${id}"
    aria-labelledby="settings-tab-${id}" tabindex="-1" hidden>${parts.join('')}</section>`;
const keyName = (name: string) => (name.startsWith('key.') ? t(name as MessageKey) : name);
const keys = (alternatives: string[]) =>
  alternatives
    .map((combo) =>
      combo
        .split(/\+(?=.)/)
        .map((part) => `<kbd>${keyName(part)}</kbd>`)
        .join('<span class="key-join">＋</span>'),
    )
    .join('<span class="key-join">／</span>');

interface TypefaceCard {
  option: FontOption<string>;
  preview: HTMLElement;
}

/**
 * 設定頁：視窗中央的大面板，左邊是分類、右邊只顯示目前分類的設定（視窗很窄時分類改成上方的分頁籤）。
 * 所有變更直接寫進 SettingsStore；文字依介面語言（i18n）。
 */
export class SettingsPanel {
  private readonly dialog: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly pageTitle: HTMLElement;
  private readonly pagesBox: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly typefaceCards: TypefaceCard[] = [];
  private previewsLoaded = false;
  /** 按了連結、還沒收到 Rust 端的狀態時，按鈕先停用 */
  private spotifyPending = false;
  private page: SettingsPage = 'lyrics';
  private opened = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private returnFocus: HTMLElement | null = null;
  private effective: { level: QualityLevel; auto: boolean } = { level: 'high', auto: true };

  constructor(
    private readonly root: HTMLElement,
    private readonly store: SettingsStore,
    private readonly actions: SettingsActions,
  ) {
    const tabs = PAGES.map(
      (page, index) => `
        <button class="nav-item" type="button" role="tab" id="settings-tab-${page.id}" data-page="${page.id}"
          data-index="${index}" aria-controls="settings-page-${page.id}">${icon(page.icon)}<span>${t(`settings.page.${page.id}`)}</span></button>`,
    ).join('');

    root.innerHTML = `
      <div class="settings-backdrop"></div>
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <nav class="settings-nav">
          <h2 id="settings-title">${t('settings.title')}</h2>
          <div class="nav-list" role="tablist" aria-label="${t('settings.categories')}" aria-orientation="vertical">
            <span class="nav-highlight" aria-hidden="true"></span>${tabs}
          </div>
          <p class="nav-foot">Lyrisync ${APP_VERSION}</p>
        </nav>
        <div class="settings-content">
          <header class="content-header">
            <h3 class="page-title"></h3>
            <button class="icon-button settings-close" type="button" aria-label="${t('settings.close')}">${icon('close')}</button>
          </header>
          <div class="settings-pages">
            ${pageSection('general', [
              card('', `
                <div class="row stacked">
                  <div class="row-text"><span class="row-title">${t('settings.language')}</span><span class="row-hint">${t('settings.language.hint')}</span></div>
                  <div class="typefaces language-options" role="radiogroup" aria-label="${t('settings.language')}"></div>
                </div>`),
              card(t('settings.motion'), `
                <div class="row stacked">
                  <div class="row-head"><span class="row-title">${t('settings.quality')}</span><span class="row-value quality-current"></span></div>
                  <div class="segmented wide quality-options" role="radiogroup" aria-label="${t('settings.quality')}"></div>
                  <span class="row-hint quality-hint"></span>
                </div>`),
              note('settings.quality.note'),
            ])}
            ${pageSection('lyrics', [
              card(t('settings.display'), [
                segmentedRow('settings.effect', 'effect-options', 'effect-hint'),
                segmentedRow('settings.size', 'font-options'),
              ].join('')),
              card(t('settings.typeface'), [
                typefaceRow('settings.typeface.zh', 'settings.typeface.zh.hint', 'zh-typefaces', 'settings.typeface.zh.label'),
                typefaceRow('settings.typeface.ja', 'settings.typeface.ja.hint', 'ja-typefaces', 'settings.typeface.ja.label'),
                typefaceRow('settings.typeface.latin', 'settings.typeface.latin.hint', 'latin-typefaces', 'settings.typeface.latin.label'),
              ].join('')),
              card(t('settings.appearance'), [
                switchRow('settings.bold', 'settings.bold.hint', 'bold-switch'),
                switchRow('settings.blur', 'settings.blur.hint', 'blur-switch'),
                sliderRow('settings.blurStrength', 'blur-input', BLUR_STRENGTH_MIN, BLUR_STRENGTH_MAX, 0.1, undefined, 'blur-strength-row'),
                sliderRow('settings.dim', 'dim-input', DIM_LEVEL_MIN, DIM_LEVEL_MAX, 0.02, 'settings.dim.hint'),
              ].join('')),
              card(t('settings.extras'), [
                switchRow('settings.translation', 'settings.translation.hint', 'translation-switch'),
                switchRow('settings.romanization', 'settings.romanization.hint', 'romanization-switch'),
              ].join('')),
              card(t('settings.timing'), `
                <div class="row stacked">
                  <div class="row-head"><label class="row-title" for="offset-input">${t('settings.offset')}</label><span class="row-value offset-value"></span></div>
                  <input id="offset-input" class="slider" type="range" min="${-OFFSET_LIMIT_MS}" max="${OFFSET_LIMIT_MS}" step="${OFFSET_STEP_MS}" />
                  <div class="row-foot">
                    <span class="row-hint">${t('settings.offset.hint')}</span>
                    <button class="soft-button small offset-reset" type="button">${t('settings.offset.reset')}</button>
                  </div>
                </div>`),
            ])}
            ${pageSection('desktop', [
              card('', switchRow('settings.desktop.show', 'settings.desktop.show.hint', 'desktop-switch')),
              card(t('settings.appearance'), [
                segmentedRow('settings.effect', 'desktop-effect-options', 'desktop-effect-hint', t('settings.desktop.effect.label')),
                sliderRow('settings.size', 'desktop-scale-input', DESKTOP_SCALE_MIN, DESKTOP_SCALE_MAX, 0.1, 'settings.desktop.size.hint'),
              ].join('')),
              card(t('settings.desktop.position'), [
                switchRow('settings.desktop.lock', 'settings.desktop.lock.hint', 'desktop-lock-switch'),
                row(
                  t('settings.desktop.resetPosition'),
                  t('settings.desktop.resetPosition.hint'),
                  `<button class="soft-button desktop-reset" type="button">${t('settings.desktop.resetPosition.button')}</button>`,
                ),
              ].join('')),
            ])}
            ${pageSection('spotify', [
              card('', `
                <div class="row">
                  <div class="row-text"><span class="row-title">${t('settings.spotify.account')}</span><span class="row-hint spotify-state-hint"></span></div>
                  <div class="row-control"><span class="status-pill spotify-pill"></span></div>
                </div>
                <div class="row stacked spotify-connect">
                  <label class="row-title" for="spotify-client-id">${t('settings.spotify.clientId')}</label>
                  <div class="input-row">
                    <input id="spotify-client-id" class="text-input" type="text" spellcheck="false" autocomplete="off" maxlength="40"
                      placeholder="${t('settings.spotify.clientId.placeholder')}" />
                    <button class="soft-button strong spotify-login" type="button">${t('settings.spotify.connect')}</button>
                  </div>
                  <span class="row-hint">${t('settings.spotify.connect.hint')}</span>
                </div>
                <div class="row spotify-waiting">
                  <div class="row-text"><span class="row-title">${t('settings.spotify.waiting')}</span><span class="row-hint">${t('settings.spotify.waiting.hint')}</span></div>
                  <button class="soft-button spotify-cancel" type="button">${t('settings.spotify.cancel')}</button>
                </div>
                <div class="row spotify-connected">
                  <div class="row-text"><span class="row-title spotify-user"></span><span class="row-hint spotify-expiry"></span></div>
                  <button class="soft-button spotify-logout" type="button">${t('settings.spotify.disconnect')}</button>
                </div>
                <div class="row spotify-error-row"><span class="row-hint error-text spotify-error"></span></div>`),
              card(t('settings.spotify.features'), [
                row(t('settings.spotify.match'), t('settings.spotify.match.hint'), `<span class="row-value">${t('settings.spotify.match.value')}</span>`),
                switchRow('settings.spotify.prefetch', 'settings.spotify.prefetch.hint', 'spotify-prefetch-switch'),
                switchRow('settings.spotify.queue', 'settings.spotify.queue.hint', 'spotify-queue-switch'),
                switchRow('settings.spotify.like', 'settings.spotify.like.hint', 'spotify-like-switch'),
              ].join('')),
              card(t('settings.spotify.setup'), `
                <ol class="steps">
                  <li>
                    <span>${t('settings.spotify.step1')}</span>
                    <button class="soft-button small spotify-dashboard" type="button">${t('settings.spotify.openDashboard')}</button>
                  </li>
                  <li>
                    <span>${t('settings.spotify.step2')}</span>
                    <span class="copy-row"><code class="redirect-uri">${REDIRECT_URI}</code><button class="soft-button small copy-redirect" type="button">${t('settings.spotify.copy')}</button></span>
                  </li>
                  <li><span>${t('settings.spotify.step3')}</span></li>
                  <li><span>${t('settings.spotify.step4')}</span></li>
                </ol>`),
              note('settings.spotify.note'),
            ])}
            ${pageSection('shortcuts', [
              card(t('settings.keyboard'), SHORTCUTS.filter(([, action]) => action !== 'shortcut.translation' || showsChineseTranslations()).map(([names, action]) => `<div class="row key-row"><span>${t(action)}</span><span class="keys">${keys(names)}</span></div>`).join('')),
              card(t('settings.mouse'), MOUSE_ACTIONS.map((what) => `<div class="row key-row"><span>${t(`${what}.action` as MessageKey)}</span><span class="mouse">${t(what)}</span></div>`).join('')),
            ])}
            ${pageSection('advanced', [
              card('', [
                switchRow('settings.debug', 'settings.debug.hint', 'debug-switch'),
                row(t('settings.cache'), t('settings.cache.hint'), `<button class="soft-button cache-clear" type="button">${t('settings.cache.clear')}</button>`, '', 'cache-status'),
              ].join('')),
            ])}
            ${pageSection('about', [
              `<div class="about-hero">
                <img class="about-mark" src="${logoUrl}" alt="" draggable="false" />
                <div>
                  <p class="about-name">Lyrisync</p>
                  <p class="about-version">${APP_VERSION}</p>
                </div>
              </div>
              <p class="about-text">${t('about.tagline')}</p>
              <p class="about-credit">${t('about.developedBy')}</p>`,
              card(t('about.thanks'), `<div class="thanks">${THANKS.map(
                ([name, what]) => `<div class="thanks-item"><span class="thanks-name">${name}</span><span class="thanks-what">${t(what)}</span></div>`,
              ).join('')}</div>`),
              note('about.legal'),
            ])}
          </div>
        </div>
      </div>`;

    const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    this.dialog = $('.settings-dialog');
    this.nav = $('.nav-list');
    this.pageTitle = $('.page-title');
    this.pagesBox = $('.settings-pages');
    for (const selector of [
      '.quality-options', '.quality-hint', '.quality-current', '.font-options', '.effect-options', '.effect-hint',
      '.desktop-effect-options', '.desktop-effect-hint', '.zh-typefaces', '.ja-typefaces', '.latin-typefaces',
      '.translation-switch', '.romanization-switch', '.bold-switch', '.blur-switch', '.blur-strength-row', '#blur-input',
      '.blur-input-value', '#dim-input', '.dim-input-value', '.desktop-switch', '.desktop-lock-switch', '#desktop-scale-input',
      '.desktop-scale-input-value', '.debug-switch', '#offset-input', '.offset-value', '.cache-status', '.language-options',
      '.spotify-pill', '.spotify-state-hint', '.spotify-connect', '.spotify-waiting', '.spotify-connected', '.spotify-user',
      '.spotify-expiry', '.spotify-error-row', '.spotify-error', '#spotify-client-id', '.spotify-login',
      '.spotify-prefetch-switch', '.spotify-like-switch', '.spotify-queue-switch',
    ]) {
      this.el[selector] = $(selector);
    }
    const e = this.el;

    buildSegmented(e['.quality-options'], QUALITIES.map((q) => [q, t(`settings.quality.${q}`)]), (quality) => store.update({ quality }));
    buildSegmented(e['.font-options'], FONT_SCALES.map((s) => [s, t(`settings.size.${s}`)]), (fontScale) => store.update({ fontScale }));
    buildSegmented(e['.effect-options'], EFFECTS.map((v) => [v, t(`settings.effect.${v}`)]), (lyricEffect) => store.update({ lyricEffect }));
    buildSegmented(e['.desktop-effect-options'], EFFECTS.map((v) => [v, t(`settings.effect.${v}`)]), (desktopEffect) =>
      store.update({ desktopEffect }),
    );
    this.typefaceCards.push(
      ...buildTypefaces(e['.zh-typefaces'], ZH_FONT_OPTIONS, TYPEFACE_SAMPLES.zh, (fontZh) => store.update({ fontZh })),
      ...buildTypefaces(e['.ja-typefaces'], JA_FONT_OPTIONS, TYPEFACE_SAMPLES.ja, (fontJa) => store.update({ fontJa })),
      ...buildTypefaces(e['.latin-typefaces'], LATIN_FONT_OPTIONS, TYPEFACE_SAMPLES.latin, (fontLatin) => store.update({ fontLatin })),
    );

    const toggle = (selector: string, key: keyof Settings) =>
      e[selector].addEventListener('click', () => store.update({ [key]: !store.get()[key] } as Partial<Settings>));
    toggle('.translation-switch', 'showTranslation');
    // 翻譯都是中文：英文、日文介面不提供
    e['.translation-switch'].closest<HTMLElement>('.row')!.hidden = !showsChineseTranslations();
    toggle('.romanization-switch', 'showRomanization');
    toggle('.bold-switch', 'lyricBold');
    toggle('.blur-switch', 'lyricBlur');
    toggle('.desktop-switch', 'desktopLyrics');
    toggle('.desktop-lock-switch', 'desktopLocked');
    toggle('.debug-switch', 'showDebug');
    toggle('.spotify-prefetch-switch', 'spotifyPrefetch');
    toggle('.spotify-like-switch', 'spotifyLike');
    toggle('.spotify-queue-switch', 'spotifyQueue');

    const slider = (selector: string, key: 'blurStrength' | 'dimLevel' | 'desktopScale' | 'offsetMs') =>
      e[selector].addEventListener('input', () => store.update({ [key]: Number((e[selector] as HTMLInputElement).value) }));
    slider('#blur-input', 'blurStrength');
    slider('#dim-input', 'dimLevel');
    slider('#desktop-scale-input', 'desktopScale');
    slider('#offset-input', 'offsetMs');

    buildLanguages(e['.language-options'], (language) => store.update({ language }));
    $('.desktop-reset').addEventListener('click', () => store.update({ desktopX: null, desktopY: null }));
    $('.offset-reset').addEventListener('click', () => store.update({ offsetMs: 0 }));
    $('.cache-clear').addEventListener('click', (event) => void this.clearCache(event.currentTarget as HTMLButtonElement));
    $('.settings-close').addEventListener('click', () => this.close());
    $('.settings-backdrop').addEventListener('click', () => this.close());

    for (const tab of this.tabs()) {
      tab.addEventListener('click', () => this.showPage(tab.dataset.page as SettingsPage));
      tab.addEventListener('keydown', (event) => this.moveBetweenTabs(event, tab));
    }
    this.dialog.addEventListener('keydown', (event) => this.trapFocus(event));
    this.bindSpotify($);
    // 真正的狀態由 main.ts 向 Rust 端問到後再傳進來
    this.setSpotifyStatus(actions.spotify ? { ...UNAVAILABLE_STATUS, state: 'disconnected' } : UNAVAILABLE_STATUS);

    this.showPage(this.page, false);
    store.subscribe((settings) => this.render(settings));
    this.render(store.get());
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get currentPage(): SettingsPage {
    return this.page;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /** 打開設定；沒指定分類時停在上次看的那一頁。 */
  open(page?: SettingsPage): void {
    if (page) this.showPage(page, false);
    if (this.opened) return;
    this.opened = true;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    this.loadTypefacePreviews();
    // 先讓瀏覽器畫出起始狀態，再加上 open 才會有淡入動畫
    void this.root.offsetWidth;
    this.root.classList.add('open');
    this.selectedTab()?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove('open');
    this.closeTimer = setTimeout(() => {
      this.root.hidden = true;
    }, CLOSE_MS);
    this.returnFocus?.focus({ preventScroll: true });
  }

  /** 顯示目前實際使用的品質等級（「自動」時可能因為掉幀而降級）。 */
  setEffectiveLevel(level: QualityLevel, auto: boolean): void {
    this.effective = { level, auto };
    this.render(this.store.get());
  }

  /** 切換分類：左邊的底色滑過去，右邊換成那一頁（淡入、微微上移）。 */
  showPage(page: SettingsPage, animate = true): void {
    const changed = page !== this.page;
    this.page = page;
    for (const tab of this.tabs()) {
      const selected = tab.dataset.page === page;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) {
        this.nav.style.setProperty('--index', tab.dataset.index ?? '0');
        // 窄視窗時分類橫排、可以左右捲動：選中的那一個要看得到
        if (changed) tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    }
    let shown: HTMLElement | null = null;
    for (const section of this.pagesBox.querySelectorAll<HTMLElement>('.settings-page')) {
      const selected = section.dataset.page === page;
      section.hidden = !selected;
      if (selected) shown = section;
    }
    this.pageTitle.textContent = t(`settings.page.${page}`);
    this.pagesBox.scrollTop = 0;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animate && changed && shown && !reduced && typeof shown.animate === 'function') {
      shown.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: PAGE_ENTER_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
  }

  /** Spotify 的連結狀態（Rust 端改變時由 main.ts 傳進來） */
  setSpotifyStatus(status: SpotifyStatus): void {
    const e = this.el;
    this.spotifyPending = false;
    const state = status.state;
    e['.spotify-pill'].textContent = t(`settings.spotify.state.${state}`);
    e['.spotify-pill'].dataset.state = state;
    e['.spotify-state-hint'].textContent = t(`settings.spotify.state.${state}.hint`);
    e['.spotify-connect'].hidden = state !== 'disconnected' && state !== 'expired';
    e['.spotify-waiting'].hidden = state !== 'logging-in';
    e['.spotify-connected'].hidden = state !== 'connected';
    e['.spotify-user'].textContent = status.userName
      ? t('settings.spotify.connectedAs', { name: status.userName })
      : t('settings.spotify.state.connected');
    e['.spotify-expiry'].textContent = status.expiresAt ? t('settings.spotify.expiry', { date: formatDate(status.expiresAt) }) : '';
    e['.spotify-error-row'].hidden = !status.error || state === 'logging-in';
    e['.spotify-error'].textContent = status.error ? spotifyErrorText(status.error) : '';
    const input = e['#spotify-client-id'] as HTMLInputElement;
    if (!input.value && status.clientId) input.value = status.clientId;
    (e['.spotify-login'] as HTMLButtonElement).disabled = false;
  }

  /** 第一次打開設定時載入每個字體（只會載到範例文字用到的字），卡片才能用真的字體顯示 */
  private loadTypefacePreviews(): void {
    if (this.previewsLoaded) return;
    this.previewsLoaded = true;
    this.loadPreviewWeights(this.store.get().lyricBold);
  }

  private loadPreviewWeights(bold: boolean): void {
    for (const { option } of this.typefaceCards) void loadFont(option, [weightOf(option, bold)]);
  }

  private tabs(): HTMLButtonElement[] {
    return Array.from(this.nav.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  }

  private selectedTab(): HTMLButtonElement | undefined {
    return this.tabs().find((tab) => tab.dataset.page === this.page);
  }

  /** 分類之間用方向鍵移動（直排用上下、窄視窗橫排也可以用左右），Home／End 跳到頭尾。 */
  private moveBetweenTabs(event: KeyboardEvent, tab: HTMLButtonElement): void {
    const tabs = this.tabs();
    const index = tabs.indexOf(tab);
    let next = -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    this.showPage(tabs[next].dataset.page as SettingsPage);
    tabs[next].focus();
  }

  /** Tab 鍵只在設定裡面轉，不會跑到後面被蓋住的播放頁。 */
  private trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      this.dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, [tabindex="0"]'),
    ).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private bindSpotify($: <T extends HTMLElement>(selector: string) => T): void {
    const actions = this.actions.spotify;
    const input = this.el['#spotify-client-id'] as HTMLInputElement;
    const button = this.el['.spotify-login'] as HTMLButtonElement;
    const login = () => {
      const clientId = input.value.trim();
      if (!actions || this.spotifyPending) return;
      if (!/^[0-9a-f]{32}$/i.test(clientId)) {
        this.showSpotifyError(t('spotifyError.invalid_client_id'));
        input.focus();
        return;
      }
      this.spotifyPending = true;
      button.disabled = true;
      actions.login(clientId).catch((e: unknown) => {
        this.spotifyPending = false;
        button.disabled = false;
        this.showSpotifyError(spotifyErrorText(e instanceof Error ? e.message : String(e)));
      });
    };
    button.addEventListener('click', login);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') login();
    });
    $('.spotify-cancel').addEventListener('click', () => void actions?.cancelLogin());
    $('.spotify-logout').addEventListener('click', () => void actions?.logout());
    $('.spotify-dashboard').addEventListener('click', () => void actions?.openDashboard());
    const copy = $<HTMLButtonElement>('.copy-redirect');
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(REDIRECT_URI).then(
        () => {
          copy.textContent = t('settings.spotify.copied');
          setTimeout(() => (copy.textContent = t('settings.spotify.copy')), 1600);
        },
        () => {
          copy.textContent = t('settings.spotify.copyFailed');
        },
      );
    });
    if (!actions) input.disabled = button.disabled = true;
  }

  private showSpotifyError(message: string): void {
    this.el['.spotify-error-row'].hidden = false;
    this.el['.spotify-error'].textContent = message;
  }

  private render(settings: Settings): void {
    const e = this.el;
    const check = (selector: string, on: boolean) => e[selector].setAttribute('aria-checked', String(on));
    check('.translation-switch', settings.showTranslation);
    check('.romanization-switch', settings.showRomanization);
    check('.bold-switch', settings.lyricBold);
    check('.blur-switch', settings.lyricBlur);
    check('.desktop-switch', settings.desktopLyrics);
    check('.desktop-lock-switch', settings.desktopLocked);
    check('.debug-switch', settings.showDebug);
    check('.spotify-prefetch-switch', settings.spotifyPrefetch);
    check('.spotify-like-switch', settings.spotifyLike);
    check('.spotify-queue-switch', settings.spotifyQueue);
    selectSegment(e['.language-options'], settings.language);

    selectSegment(e['.quality-options'], settings.quality);
    selectSegment(e['.font-options'], settings.fontScale);
    selectSegment(e['.effect-options'], settings.lyricEffect);
    selectSegment(e['.desktop-effect-options'], settings.desktopEffect);
    selectSegment(e['.zh-typefaces'], settings.fontZh);
    selectSegment(e['.ja-typefaces'], settings.fontJa);
    selectSegment(e['.latin-typefaces'], settings.fontLatin);
    e['.effect-hint'].textContent = t(`settings.effect.hint.${settings.lyricEffect}`);
    e['.desktop-effect-hint'].textContent = t(`settings.desktop.effect.hint.${settings.desktopEffect}`);
    e['.quality-hint'].textContent = t(`settings.quality.hint.${settings.quality}`);
    e['.quality-current'].textContent = this.effective.auto
      ? t('settings.quality.current', { level: t(`settings.quality.${this.effective.level}`) })
      : '';

    // 字體卡片的範例字跟著粗體設定
    for (const { option, preview } of this.typefaceCards) preview.style.fontWeight = String(weightOf(option, settings.lyricBold));
    if (this.previewsLoaded) this.loadPreviewWeights(settings.lyricBold);

    // 模糊程度只在開啟景深模糊時可以調
    const blurInput = e['#blur-input'] as HTMLInputElement;
    blurInput.disabled = !settings.lyricBlur;
    e['.blur-strength-row'].classList.toggle('disabled', !settings.lyricBlur);
    setSlider(blurInput, settings.blurStrength, BLUR_STRENGTH_MIN, BLUR_STRENGTH_MAX);
    e['.blur-input-value'].textContent = `${Math.round(settings.blurStrength * 100)}%`;
    setSlider(e['#dim-input'] as HTMLInputElement, settings.dimLevel, DIM_LEVEL_MIN, DIM_LEVEL_MAX);
    e['.dim-input-value'].textContent = `${Math.round(settings.dimLevel * 100)}%`;
    setSlider(e['#desktop-scale-input'] as HTMLInputElement, settings.desktopScale, DESKTOP_SCALE_MIN, DESKTOP_SCALE_MAX);
    e['.desktop-scale-input-value'].textContent = `${Math.round(settings.desktopScale * 100)}%`;

    const offset = e['#offset-input'] as HTMLInputElement;
    if (offset.value !== String(settings.offsetMs)) offset.value = String(settings.offsetMs);
    // 時間偏移從中間（不調整）往兩邊填色
    const offsetRatio = (settings.offsetMs + OFFSET_LIMIT_MS) / (2 * OFFSET_LIMIT_MS);
    setTrack(offset, Math.min(0.5, offsetRatio), Math.max(0.5, offsetRatio));
    const direction =
      settings.offsetMs > 0 ? t('settings.offset.earlier') : settings.offsetMs < 0 ? t('settings.offset.later') : t('settings.offset.none');
    e['.offset-value'].textContent = settings.offsetMs
      ? t('settings.offset.value', { ms: signed(settings.offsetMs), direction })
      : direction;
  }

  private async clearCache(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const status = this.el['.cache-status'];
    try {
      const removed = await this.actions.clearCache();
      status.textContent = removed ? t('settings.cache.cleared', { count: removed }) : t('settings.cache.empty');
    } catch (e) {
      status.textContent = t('settings.cache.failed', { error: String(e) });
    } finally {
      button.disabled = false;
    }
  }
}

/** 滑桿的值與填色（從最左邊填到目前的值） */
function setSlider(input: HTMLInputElement, value: number, min: number, max: number): void {
  if (Number(input.value) !== value) input.value = String(value);
  setTrack(input, 0, (value - min) / (max - min));
}

/** 滑桿軌道上填色的範圍（0～1） */
function setTrack(input: HTMLInputElement, from: number, to: number): void {
  input.style.setProperty('--from', from.toFixed(3));
  input.style.setProperty('--to', to.toFixed(3));
}

/** 分段選擇器：一組 radio 按鈕，加一塊會滑動的底色。 */
function buildSegmented<T extends string>(
  group: HTMLElement,
  options: ReadonlyArray<[T, string]>,
  onSelect: (value: T) => void,
): void {
  group.style.setProperty('--count', String(options.length));
  const thumb = document.createElement('span');
  thumb.className = 'segment-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  group.append(thumb);
  const values = options.map(([value]) => value);
  options.forEach(([, label], index) => {
    const button = radioButton(group, values, index, onSelect);
    button.textContent = label;
    group.append(button);
  });
}

/** 字體卡片：上面用那個字體寫範例文字，下面是名稱與字型名。 */
function buildTypefaces<T extends string>(
  group: HTMLElement,
  options: ReadonlyArray<FontOption<T>>,
  sample: string,
  onSelect: (value: T) => void,
): TypefaceCard[] {
  const values = options.map((option) => option.id);
  return options.map((option, index) => {
    const button = radioButton(group, values, index, onSelect);
    button.className = 'typeface';
    const preview = document.createElement('span');
    preview.className = 'typeface-sample';
    preview.textContent = sample;
    preview.style.fontFamily = `${option.family}, var(--font-ui)`;
    const name = document.createElement('span');
    name.className = 'typeface-name';
    name.textContent = optionLabel(option);
    const detail = document.createElement('span');
    detail.className = 'typeface-detail';
    detail.textContent = optionDetail(option);
    button.append(preview, name, detail);
    group.append(button);
    return { option, preview };
  });
}

/**
 * 語言卡片：上面是那個語言的代表字（跟隨系統是地球），下面是語言自己的名稱，
 * 再下面是目前介面語言的寫法（例如英文介面的「日本語」下面寫 Japanese）。
 */
function buildLanguages(group: HTMLElement, onSelect: (value: LanguageSetting) => void): void {
  LANGUAGES.forEach((language, index) => {
    const button = radioButton(group, LANGUAGES, index, onSelect);
    button.className = 'typeface language-option';
    const glyph = document.createElement('span');
    glyph.className = 'typeface-sample language-glyph';
    const name = document.createElement('span');
    name.className = 'typeface-name';
    const detail = document.createElement('span');
    detail.className = 'typeface-detail';
    if (language === 'auto') {
      glyph.innerHTML = icon('globe');
      name.textContent = t('settings.language.auto');
      detail.textContent = t('settings.language.current', { name: LOCALE_NAMES[resolveLocale('auto')] });
    } else {
      glyph.textContent = LANGUAGE_GLYPHS[language].text;
      glyph.style.fontFamily = LANGUAGE_GLYPHS[language].font;
      name.textContent = LOCALE_NAMES[language];
      name.lang = language;
      const localized = t(`language.name.${language}`);
      detail.textContent = localized === LOCALE_NAMES[language] ? '\u00a0' : localized;
    }
    button.append(glyph, name, detail);
    group.append(button);
  });
}

/** 一組 radio 裡的一個按鈕：點了就選；方向鍵在同一組裡移動並選取。 */
function radioButton<T extends string>(
  group: HTMLElement,
  values: readonly T[],
  index: number,
  onSelect: (value: T) => void,
): HTMLButtonElement {
  const value = values[index];
  const button = document.createElement('button');
  button.type = 'button';
  button.role = 'radio';
  button.dataset.value = value;
  button.dataset.index = String(index);
  button.addEventListener('click', () => onSelect(value));
  button.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = values[(index + step + values.length) % values.length];
    onSelect(next);
    group.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
  });
  return button;
}

function selectSegment(group: HTMLElement, value: string): void {
  for (const button of group.querySelectorAll<HTMLButtonElement>('button[role="radio"]')) {
    const selected = button.dataset.value === value;
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected) group.style.setProperty('--index', button.dataset.index ?? '0');
  }
}
