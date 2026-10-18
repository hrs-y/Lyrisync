// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TitleBar, type WindowControls } from './titlebar';

const markup = `
  <header class="titlebar">
    <div class="drag-region"></div>
    <button class="desktop-lyrics-button"></button>
    <button class="fullscreen-button"></button>
    <button class="settings-button"></button>
    <button class="window-minimize"></button>
    <button class="window-maximize"></button>
    <button class="window-close"></button>
  </header>`;

/** 假的視窗：記下呼叫順序，狀態跟著變 */
function fakeWindow(maximized: boolean) {
  const calls: string[] = [];
  const state = { maximized, fullscreen: false };
  const win = {
    minimize: vi.fn(async () => {}),
    toggleMaximize: vi.fn(async () => {}),
    maximize: vi.fn(async () => {
      calls.push('maximize');
      state.maximized = true;
    }),
    unmaximize: vi.fn(async () => {
      calls.push('unmaximize');
      state.maximized = false;
    }),
    close: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => state.maximized),
    isFullscreen: vi.fn(async () => state.fullscreen),
    setFullscreen: vi.fn(async (on: boolean) => {
      calls.push(`fullscreen ${on}`);
      state.fullscreen = on;
    }),
    onResized: vi.fn(async () => () => {}),
    setTitle: vi.fn(async () => {}),
  };
  return { win: win as unknown as WindowControls, calls, state };
}

function createTitleBar(win: WindowControls): TitleBar {
  document.body.innerHTML = markup;
  return new TitleBar(document.querySelector<HTMLElement>('.titlebar')!, { onSettings() {}, onDesktopLyrics() {} }, win);
}

afterEach(() => document.documentElement.classList.remove('fullscreen', 'idle'));

describe('TitleBar fullscreen', () => {
  it('leaves the maximized state before going fullscreen and restores it afterwards', async () => {
    const { win, calls, state } = fakeWindow(true);
    const titlebar = createTitleBar(win);

    await titlebar.setFullscreen(true);
    expect(calls).toEqual(['unmaximize', 'fullscreen true']);
    expect(titlebar.isFullscreen).toBe(true);
    expect(document.documentElement.classList.contains('fullscreen')).toBe(true);

    await titlebar.setFullscreen(false);
    expect(calls).toEqual(['unmaximize', 'fullscreen true', 'fullscreen false', 'maximize']);
    expect(state.maximized).toBe(true);
    expect(document.documentElement.classList.contains('fullscreen')).toBe(false);
  });

  it('leaves a normal window alone', async () => {
    const { win, calls } = fakeWindow(false);
    const titlebar = createTitleBar(win);
    await titlebar.toggleFullscreen();
    await titlebar.toggleFullscreen();
    expect(calls).toEqual(['fullscreen true', 'fullscreen false']);
  });

  it('maximizes again right away when the window could not go fullscreen', async () => {
    const { win, calls } = fakeWindow(true);
    vi.mocked(win.setFullscreen).mockImplementation(async () => {});
    const titlebar = createTitleBar(win);
    await titlebar.setFullscreen(true);
    expect(calls).toEqual(['unmaximize', 'maximize']);
    expect(titlebar.isFullscreen).toBe(false);
  });
});
