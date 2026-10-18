import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window';
import { t } from '../i18n';
import { icon } from './icons';

/** 全螢幕時，滑鼠停下多久就隱藏標題列、工具列與游標 */
const IDLE_MS = 2500;

export interface TitleBarActions {
  onSettings(): void;
  onDesktopLyrics(): void;
}

/** 標題列用到的視窗操作（測試時可以換成假的） */
export type WindowControls = Pick<
  TauriWindow,
  | 'minimize'
  | 'toggleMaximize'
  | 'maximize'
  | 'unmaximize'
  | 'close'
  | 'isMaximized'
  | 'isFullscreen'
  | 'setFullscreen'
  | 'onResized'
  | 'setTitle'
>;

/**
 * 無邊框視窗的標題列：空白處可以拖曳（雙擊最大化），右邊是桌面歌詞、全螢幕、設定與視窗按鈕。
 * 拖曳區只放在空白的元素上，按鈕不在拖曳區裡（v0.1 曾經因為拖曳區蓋住按鈕而點不到）。
 */
export class TitleBar {
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly desktopButton: HTMLButtonElement;
  private fullscreen = false;
  /** 進全螢幕前是最大化：離開全螢幕後要恢復 */
  private restoreMaximized = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    root: HTMLElement,
    actions: TitleBarActions,
    private readonly appWindow: WindowControls | null = isTauri() ? getCurrentWindow() : null,
  ) {
    const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    $('.settings-button').innerHTML = icon('settings');
    $('.settings-button').addEventListener('click', actions.onSettings);
    this.desktopButton = $('.desktop-lyrics-button');
    this.desktopButton.innerHTML = icon('desktopLyrics');
    this.desktopButton.addEventListener('click', actions.onDesktopLyrics);
    this.fullscreenButton = $('.fullscreen-button');
    this.fullscreenButton.addEventListener('click', () => void this.toggleFullscreen());
    this.renderFullscreenButton();

    // 全螢幕時滑鼠一動就把標題列叫回來
    const wake = () => this.wake();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);

    const minimize = $<HTMLButtonElement>('.window-minimize');
    const maximize = $<HTMLButtonElement>('.window-maximize');
    const close = $<HTMLButtonElement>('.window-close');
    minimize.innerHTML = icon('minimize');
    maximize.innerHTML = icon('maximize');
    close.innerHTML = icon('windowClose');

    if (!appWindow) {
      // 瀏覽器預覽沒有視窗可以控制，全螢幕改用瀏覽器的全螢幕；也沒有桌面歌詞
      root.classList.add('web');
      document.addEventListener('fullscreenchange', () => this.setFullscreenState(Boolean(document.fullscreenElement)));
      return;
    }
    minimize.addEventListener('click', () => void appWindow.minimize());
    maximize.addEventListener('click', () => void appWindow.toggleMaximize());
    close.addEventListener('click', () => void appWindow.close());

    const syncWindowState = async () => {
      const [maximized, fullscreen] = await Promise.all([appWindow.isMaximized(), appWindow.isFullscreen()]);
      maximize.innerHTML = icon(maximized ? 'restore' : 'maximize');
      maximize.setAttribute('aria-label', maximized ? t('titlebar.restore') : t('titlebar.maximize'));
      document.documentElement.classList.toggle('window-maximized', maximized);
      this.setFullscreenState(fullscreen);
    };
    void appWindow.onResized(() => void syncWindowState());
    void syncWindowState();
  }

  get isFullscreen(): boolean {
    return this.fullscreen;
  }

  async toggleFullscreen(): Promise<void> {
    await this.setFullscreen(!this.fullscreen);
  }

  async setFullscreen(on: boolean): Promise<void> {
    const appWindow = this.appWindow;
    if (!appWindow) {
      if (on) await document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      return;
    }
    // Tauri 底層（tao）只要無邊框視窗是最大化，就把畫面限制在不含工作列的工作區，
    // 進全螢幕時也照這個規則，下方會留下一條黑色。所以先還原，離開全螢幕後再恢復最大化。
    if (on && !this.fullscreen && (await appWindow.isMaximized())) {
      this.restoreMaximized = true;
      await appWindow.unmaximize();
    }
    await appWindow.setFullscreen(on);
    this.setFullscreenState(await appWindow.isFullscreen());
    // 沒能進入全螢幕：馬上恢復最大化
    if (!this.fullscreen && this.restoreMaximized) {
      this.restoreMaximized = false;
      await appWindow.maximize();
    }
  }

  /** 桌面歌詞按鈕的開關狀態 */
  setDesktopLyricsActive(active: boolean): void {
    this.desktopButton.setAttribute('aria-pressed', String(active));
    this.desktopButton.title = active ? t('titlebar.desktopLyricsOff') : t('titlebar.desktopLyricsOn');
  }

  /** 工作列與視窗切換時顯示的標題。 */
  setTitle(text: string): void {
    document.title = text;
    void this.appWindow?.setTitle(text).catch(() => {});
  }

  private setFullscreenState(on: boolean): void {
    if (on === this.fullscreen) return;
    this.fullscreen = on;
    document.documentElement.classList.toggle('fullscreen', on);
    this.renderFullscreenButton();
    this.wake();
    if (!on && this.restoreMaximized) {
      this.restoreMaximized = false;
      void this.appWindow?.maximize();
    }
  }

  private renderFullscreenButton(): void {
    this.fullscreenButton.innerHTML = icon(this.fullscreen ? 'exitFullscreen' : 'fullscreen');
    const label = this.fullscreen ? t('titlebar.exitFullscreen') : t('titlebar.fullscreen');
    this.fullscreenButton.setAttribute('aria-label', label);
    this.fullscreenButton.title = label;
  }

  /** 全螢幕時，滑鼠停下 IDLE_MS 就隱藏標題列、工具列和游標；設定頁開著時不隱藏 */
  private wake(): void {
    const root = document.documentElement;
    root.classList.remove('idle');
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (!this.fullscreen) return;
    this.idleTimer = setTimeout(() => {
      if (document.querySelector('.settings.open')) this.wake();
      else root.classList.add('idle');
    }, IDLE_MS);
  }
}
