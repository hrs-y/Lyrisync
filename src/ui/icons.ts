// 介面用的圖示：自己畫的簡單 SVG，播放控制用實心、其他用 1.6 粗細的線條，風格一致

const svg = (viewBox: string, body: string, extra = '') =>
  `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

export const ICONS = {
  play: svg('0 0 24 24', '<path d="M8.2 5.6v12.8c0 .9 1 1.4 1.7.9l9.6-6.4c.7-.4.7-1.4 0-1.8L9.9 4.7c-.7-.5-1.7 0-1.7.9z"/>'),
  pause: svg('0 0 24 24', '<rect x="6.2" y="4.8" width="4.3" height="14.4" rx="1.3"/><rect x="13.5" y="4.8" width="4.3" height="14.4" rx="1.3"/>'),
  previous: svg(
    '0 0 24 24',
    '<path d="M11.4 7.1v9.8c0 .8-.9 1.3-1.6.8L3.5 13c-.6-.4-.6-1.4 0-1.8l6.3-4.9c.7-.5 1.6 0 1.6.8z"/><path d="M20.4 7.1v9.8c0 .8-.9 1.3-1.6.8L12.5 13c-.6-.4-.6-1.4 0-1.8l6.3-4.9c.7-.5 1.6 0 1.6.8z"/>',
  ),
  next: svg(
    '0 0 24 24',
    '<path d="M12.6 7.1v9.8c0 .8.9 1.3 1.6.8l6.3-4.7c.6-.4.6-1.4 0-1.8l-6.3-4.9c-.7-.5-1.6 0-1.6.8z"/><path d="M3.6 7.1v9.8c0 .8.9 1.3 1.6.8l6.3-4.7c.6-.4.6-1.4 0-1.8L5.2 6.3c-.7-.5-1.6 0-1.6.8z"/>',
  ),
  settings: svg(
    '0 0 24 24',
    '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"',
  ),
  close: svg('0 0 24 24', '<path d="M6 6l12 12M18 6L6 18"/>', 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"'),
  fullscreen: svg(
    '0 0 24 24',
    '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"',
  ),
  exitFullscreen: svg(
    '0 0 24 24',
    '<path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20"/>',
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"',
  ),
  desktopLyrics: svg(
    '0 0 24 24',
    '<rect x="3" y="4.5" width="18" height="11.5" rx="2"/><path d="M9 20h6M12 16v4M7 8.8h10M7 11.8h6"/>',
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"',
  ),
  lock: svg(
    '0 0 24 24',
    '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"',
  ),
  unlock: svg(
    '0 0 24 24',
    '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.6"/>',
    'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"',
  ),
  refresh: svg(
    '0 0 24 24',
    '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 5v4h-4"/>',
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"',
  ),
  note: svg(
    '0 0 24 24',
    '<path d="M9 17.5V6.2c0-.5.4-.9.8-1l8-1.7c.6-.1 1.2.4 1.2 1v10.9"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.4" r="2.5"/>',
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"',
  ),
  // 按讚：空心與實心
  heart: svg(
    '0 0 24 24',
    '<path d="M12 20.2s-7.6-4.6-7.6-10.1A4.3 4.3 0 0 1 8.7 5.8c1.4 0 2.6.7 3.3 1.8.7-1.1 1.9-1.8 3.3-1.8a4.3 4.3 0 0 1 4.3 4.3c0 5.5-7.6 10.1-7.6 10.1z"/>',
    'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"',
  ),
  heartFilled: svg(
    '0 0 24 24',
    '<path d="M12 20.2s-7.6-4.6-7.6-10.1A4.3 4.3 0 0 1 8.7 5.8c1.4 0 2.6.7 3.3 1.8.7-1.1 1.9-1.8 3.3-1.8a4.3 4.3 0 0 1 4.3 4.3c0 5.5-7.6 10.1-7.6 10.1z"/>',
    'fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"',
  ),
  // 語言「跟隨系統」：地球
  globe: svg(
    '0 0 24 24',
    '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4c2.3 2.4 3.5 5.3 3.5 8.6s-1.2 6.2-3.5 8.6c-2.3-2.4-3.5-5.3-3.5-8.6S9.7 5.8 12 3.4z"/>',
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"',
  ),
  // 待播清單：三行加一個播放符號
  queue: svg(
    '0 0 24 24',
    '<path d="M4 6.5h11M4 11.5h11M4 16.5h6.5"/><path d="M15.2 14.2v5.6c0 .5.5.8.9.5l4.2-2.8c.4-.2.4-.8 0-1l-4.2-2.8c-.4-.3-.9 0-.9.5z" fill="currentColor"/>',
    'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"',
  ),
  // 設定頁的分類
  link: svg(
    '0 0 24 24',
    '<path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3.2-3.2a3.6 3.6 0 0 0-5.1-5.1l-1.1 1.1"/><path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3.2 3.2a3.6 3.6 0 0 0 5.1 5.1l1.1-1.1"/>',
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"',
  ),
  sparkle: svg(
    '0 0 24 24',
    '<path d="M10.5 4l1.5 4.6 4.6 1.5-4.6 1.5-1.5 4.6-1.5-4.6L4.4 10.1 9 8.6z"/><path d="M17.5 14.5l.75 2.1 2.1.75-2.1.75-.75 2.1-.75-2.1-2.1-.75 2.1-.75z"/>',
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"',
  ),
  keyboard: svg(
    '0 0 24 24',
    '<rect x="2.8" y="6" width="18.4" height="12" rx="2.4"/><path d="M6.4 9.7h1M9.7 9.7h1M13 9.7h1M16.3 9.7h1.3M6.4 12.5h1.6M10.2 12.5h1M13.4 12.5h1M16.3 12.5h1.3M8.2 15.3h7.6"/>',
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"',
  ),
  terminal: svg(
    '0 0 24 24',
    '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7.5 9.5l3 2.6-3 2.6M12.8 15h3.7"/>',
    'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"',
  ),
  info: svg(
    '0 0 24 24',
    '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 11v5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="7.9" r="1.05" fill="currentColor"/>',
  ),
  // Windows 視窗按鈕：細線、10×10，跟系統的外觀一致
  minimize: svg('0 0 10 10', '<path d="M0 5.5h10"/>', 'fill="none" stroke="currentColor" stroke-width="1"'),
  maximize: svg('0 0 10 10', '<rect x="0.5" y="0.5" width="9" height="9" rx="1"/>', 'fill="none" stroke="currentColor" stroke-width="1"'),
  restore: svg(
    '0 0 10 10',
    '<rect x="0.5" y="2.5" width="7" height="7" rx="1"/><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1"/>',
    'fill="none" stroke="currentColor" stroke-width="1"',
  ),
  windowClose: svg('0 0 10 10', '<path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/>', 'fill="none" stroke="currentColor" stroke-width="1"'),
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): string {
  return ICONS[name];
}
