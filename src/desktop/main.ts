import '../styles/base.css';
import '../styles/desktop.css';
import { emit, listen } from '@tauri-apps/api/event';
import {
  availableMonitors,
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  LogicalPosition,
  PhysicalPosition,
  PhysicalSize,
  primaryMonitor,
  type Monitor,
} from '@tauri-apps/api/window';
import { createSmtcSource } from '../player/smtcSource';
import { PlayerTracker } from '../player/tracker';
import { trackKey } from '../player/types';
import { browserStorage, DESKTOP_SCALE_MAX, DESKTOP_SCALE_MIN, SettingsStore, type Settings } from '../settings';
import { isJapanese } from '../lyrics/chinese';
import type { Lyrics } from '../lyrics/model';
import { resolveLocale, setLocale, showsChineseTranslations, t, translateDom } from '../i18n';
import { applyLyricFonts, LANG_ATTRIBUTE, lineLanguage } from '../ui/fonts';
import { icon } from '../ui/icons';
import { contains, elementOnScreen, type ScreenRect } from './geometry';
import { KaraokeLine } from './karaoke';
import { pickLines, type DesktopLines } from './lines';
import { DESKTOP_FONT_PX, desktopWindowHeight, DISPLAY_EVENT, REQUEST_EVENT, type DesktopPayload } from './protocol';
import { WritingLine } from './writingLine';

/** 鎖定時多久檢查一次游標位置（決定要不要露出解鎖按鈕） */
const HOVER_POLL_MS = 150;
/** 視窗位置、大小變動不頻繁，隔幾次檢查才重新查一次 */
const GEOMETRY_REFRESH_TICKS = 8;
/** 解鎖按鈕四周多算一點範圍（CSS 像素），比較好點 */
const BUTTON_PAD_PX = 6;
/** 預設位置：工作區域底部往上留一點空間 */
const BOTTOM_MARGIN_PX = 56;
const SCALE_STEP = 0.1;
const SAVE_POSITION_DELAY_MS = 400;
/** 書寫效果換行時，寫好的上一行淡出的時間 */
const GHOST_MS = 480;

const appWindow = getCurrentWindow();
const settings = new SettingsStore(browserStorage());
settings.listenToOtherWindows();
// 介面語言（按鈕的提示文字）；主視窗換語言時這個視窗也重新載入
setLocale(resolveLocale(settings.get().language));
translateDom(document);

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const desk = $('#desk');
const linesBox = $('.desk-lines');
const primarySlot = $('.desk-line.primary');
const secondarySlot = $('.desk-line.secondary');
const unlockButton = $<HTMLButtonElement>('.desk-unlock');
/** 亮起效果（以及歌名等一般文字）用卡拉 OK 填色；書寫效果主行、第二行各一個 */
const karaoke = new KaraokeLine();
const writer = new WritingLine();
const subWriter = new WritingLine('sub');
primarySlot.append(karaoke.el);

$('.desk-lock').innerHTML = icon('lock');
$('.desk-close').innerHTML = icon('close');
unlockButton.innerHTML = icon('unlock');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ===== 播放狀態與歌詞 =====

const tracker = new PlayerTracker({ onTrackChange: () => (shownKey = ''), onLog: () => {} });
let payload: DesktopPayload | null = null;
/** 目前畫面上顯示的內容；不同才重畫 */
let shownKey = '';
/** 目前顯示的是哪一首歌的哪一行（不受設定變更影響）；換了才做換行動畫 */
let shownLine = '';

void createSmtcSource().subscribe((event) => tracker.handle(event));
void listen<DesktopPayload>(DISPLAY_EVENT, (event) => {
  payload = event.payload;
  desk.style.setProperty('--accent', payload.accent);
  shownKey = '';
});

function frame(): void {
  render();
  requestAnimationFrame(frame);
}

function render(): void {
  const snapshot = tracker.current;
  const current = settings.get();
  const time = tracker.clock.now() + current.offsetMs;
  const lyrics = payload && snapshot && payload.track === trackKey(snapshot) ? payload.lyrics : null;
  const writing = current.desktopEffect === 'write';

  if (lyrics?.synced && lyrics.lines.length) {
    const picked = pickLines(lyrics, time, {
      showRomanization: current.showRomanization,
      showTranslation: current.showTranslation && showsChineseTranslations(),
      previewNext: !writing,
    });
    // 書寫效果：第一句開唱前還沒有字可以寫，先顯示歌名
    if (!writing || picked.index >= 0) {
      const line = `${payload!.track}#${Math.max(0, picked.index)}`;
      const key = `${current.desktopEffect}#${line}#${picked.secondaryKind}#${picked.secondary}`;
      if (key !== shownKey) {
        shownKey = key;
        showLines(picked, writing, line);
      }
      if (writing) {
        writer.update(time);
        subWriter.update(time);
      } else {
        karaoke.update(time);
      }
      return;
    }
  }

  // 沒有同步歌詞（還在找、找不到、純音樂、純文字歌詞）：顯示歌名與歌手
  const text = !snapshot ? t('app.waiting') : lyrics?.instrumental ? t('desktop.instrumental', { title: snapshot.title }) : snapshot.title;
  const key = `text#${text}#${snapshot?.artist ?? ''}`;
  if (key === shownKey) return;
  shownKey = key;
  const changed = shownLine !== key;
  if (changed && writing) leaveGhost();
  shownLine = key;
  setPrimary(karaoke.el, text);
  karaoke.set(null, text);
  karaoke.update(0);
  setSecondary(snapshot?.artist ?? '', 'none');
  fitToWidth();
  if (changed && !writing) animateIn();
}

/** 顯示一行歌詞：亮起效果用卡拉 OK 填色，書寫效果一個字一個字寫出來。 */
function showLines(picked: DesktopLines, writing: boolean, line: string): void {
  const changed = shownLine !== line;
  // 書寫效果：寫好的上一行淡出，新的一行從空白開始寫
  if (changed && writing) leaveGhost();
  shownLine = line;
  const lyric = picked.line!;
  if (writing) {
    setPrimary(writer.el, lyric.text);
    writer.set(lyric.text, lyric.words, lyric.startMs, lyric.endMs);
    if (picked.secondary) {
      subWriter.set(picked.secondary, picked.secondaryWords, lyric.startMs, lyric.endMs);
      secondarySlot.replaceChildren(subWriter.el);
      secondarySlot.dataset.kind = picked.secondaryKind;
    } else {
      setSecondary('', 'none');
    }
  } else {
    setPrimary(karaoke.el, lyric.text);
    karaoke.set(lyric);
    setSecondary(picked.secondary, picked.secondaryKind);
  }
  fitToWidth();
  if (changed && !writing) animateIn();
}

function setPrimary(el: HTMLElement, text: string): void {
  if (primarySlot.firstElementChild !== el) primarySlot.replaceChildren(el);
  // 依這一行的語言用對應的字體（和主畫面一樣）
  primarySlot.lang = LANG_ATTRIBUTE[lineLanguage(text, japaneseSong(payload?.lyrics ?? null))];
}

let japaneseCache: { lyrics: Lyrics | null; japanese: boolean } = { lyrics: null, japanese: false };

/** 日文歌裡只有漢字的行也用日文字體；同一份歌詞只算一次 */
function japaneseSong(lyrics: Lyrics | null): boolean {
  if (!lyrics) return false;
  if (japaneseCache.lyrics !== lyrics) japaneseCache = { lyrics, japanese: isJapanese(lyrics.lines) };
  return japaneseCache.japanese;
}

function setSecondary(text: string, kind: string): void {
  secondarySlot.textContent = text;
  secondarySlot.dataset.kind = kind;
}

/** 太長的行縮小到放得下，不換行 */
function fitToWidth(): void {
  const el = primarySlot.firstElementChild as HTMLElement | null;
  if (!el) return;
  el.style.setProperty('--fit', '1');
  const available = primarySlot.clientWidth;
  const needed = el.offsetWidth;
  const fit = needed > available && needed > 0 ? Math.max(0.55, available / needed) : 1;
  el.style.setProperty('--fit', fit.toFixed(3));
}

/** 書寫效果換行時：把目前畫面上的兩行複製一份蓋在原處，往上飄、模糊、淡出。 */
function leaveGhost(): void {
  if (reducedMotion.matches || !primarySlot.firstElementChild) return;
  const ghost = document.createElement('div');
  ghost.className = 'desk-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.append(primarySlot.cloneNode(true), secondarySlot.cloneNode(true));
  linesBox.append(ghost);
  const animation = ghost.animate(
    [
      { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
      { opacity: 0, transform: 'translateY(-0.3em)', filter: 'blur(4px)' },
    ],
    { duration: GHOST_MS, easing: 'cubic-bezier(0.32, 0, 0.67, 1)', fill: 'forwards' },
  );
  animation.onfinish = () => ghost.remove();
}

/** 換行時新的一行從下方淡入 */
function animateIn(): void {
  if (reducedMotion.matches) return;
  const keyframes = [
    { opacity: 0, transform: 'translateY(0.35em)' },
    { opacity: 1, transform: 'translateY(0)' },
  ];
  primarySlot.animate(keyframes, { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  secondarySlot.animate(keyframes, { duration: 360, delay: 40, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' });
}

// ===== 視窗：字級、位置、鎖定 =====

async function applyScale(scale: number): Promise<void> {
  desk.style.setProperty('--desk-font', `${DESKTOP_FONT_PX * scale}px`);
  // 高度以 CSS 像素算，用網頁自己的 devicePixelRatio 換成實體像素（原因見 elementOnScreen）
  const width = (await appWindow.outerSize()).width;
  const height = Math.round(desktopWindowHeight(scale) * window.devicePixelRatio);
  await appWindow.setSize(new PhysicalSize(width, height));
  karaoke.remeasure();
  fitToWidth();
}

/** 預設位置：目前螢幕工作區域的底部置中 */
async function moveToDefault(): Promise<void> {
  const monitor = (await currentMonitor()) ?? (await primaryMonitor());
  if (!monitor) return;
  const size = await appWindow.outerSize();
  const area = monitor.workArea;
  const x = area.position.x + (area.size.width - size.width) / 2;
  const y = area.position.y + area.size.height - size.height - BOTTOM_MARGIN_PX * monitor.scaleFactor;
  await appWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
}

/** 存下來的位置還在某個螢幕上才用（例如外接螢幕拔掉後就回到預設位置） */
async function applyPosition(current: Settings): Promise<void> {
  if (current.desktopX === null || current.desktopY === null) return moveToDefault();
  const x = current.desktopX;
  const y = current.desktopY;
  const onScreen = (monitor: Monitor) => {
    const position = monitor.position.toLogical(monitor.scaleFactor);
    const size = monitor.size.toLogical(monitor.scaleFactor);
    return x >= position.x - 40 && x < position.x + size.width - 40 && y >= position.y && y < position.y + size.height - 40;
  };
  const monitors = await availableMonitors();
  if (!monitors.some(onScreen)) return moveToDefault();
  await appWindow.setPosition(new LogicalPosition(x, y));
}

let hoverTimer: ReturnType<typeof setInterval> | null = null;
let buttonClickable = false;
/** 視窗在螢幕上的範圍（實體像素） */
let windowRect: ScreenRect | null = null;
let ticks = 0;

async function applyLock(locked: boolean): Promise<void> {
  desk.classList.toggle('locked', locked);
  desk.classList.remove('peek');
  buttonClickable = false;
  await appWindow.setIgnoreCursorEvents(locked);
  if (hoverTimer) clearInterval(hoverTimer);
  hoverTimer = locked ? setInterval(() => void watchHover(), HOVER_POLL_MS) : null;
  windowRect = null;
}

/**
 * 鎖定時視窗收不到滑鼠事件，所以定時查游標位置：游標在視窗範圍內就露出解鎖按鈕，
 * 游標在按鈕上時暫時關掉滑鼠穿透，按鈕才點得到。
 */
async function watchHover(): Promise<void> {
  try {
    if (!windowRect || ticks++ % GEOMETRY_REFRESH_TICKS === 0) {
      const [position, size] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize()]);
      windowRect = { x: position.x, y: position.y, width: size.width, height: size.height };
    }
    const cursor = await cursorPosition();
    // 等待期間已經解鎖了：不要再動滑鼠穿透
    if (!desk.classList.contains('locked')) return;
    const inside = contains(windowRect, cursor);
    desk.classList.toggle('peek', inside);
    const button = elementOnScreen(windowRect, unlockButton.getBoundingClientRect(), window.devicePixelRatio, BUTTON_PAD_PX);
    const overButton = inside && contains(button, cursor);
    if (overButton !== buttonClickable) {
      buttonClickable = overButton;
      await appWindow.setIgnoreCursorEvents(!overButton);
    }
  } catch {
    // 視窗正在關閉之類的情況，下次再試
  }
}

// ===== 互動 =====

$('.desk-smaller').addEventListener('click', () =>
  settings.update({ desktopScale: Math.max(DESKTOP_SCALE_MIN, settings.get().desktopScale - SCALE_STEP) }),
);
$('.desk-larger').addEventListener('click', () =>
  settings.update({ desktopScale: Math.min(DESKTOP_SCALE_MAX, settings.get().desktopScale + SCALE_STEP) }),
);
$('.desk-lock').addEventListener('click', () => settings.update({ desktopLocked: true }));
unlockButton.addEventListener('click', () => settings.update({ desktopLocked: false }));
$('.desk-close').addEventListener('click', () => {
  // 主視窗收到設定變更後會關掉這個視窗；自己也關一次，以防萬一
  settings.update({ desktopLyrics: false });
  void appWindow.close();
});

// 沒鎖定時，拖曳任何地方（按鈕以外）都能移動視窗
desk.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || desk.classList.contains('locked')) return;
  if ((event.target as HTMLElement).closest('button')) return;
  void appWindow.startDragging();
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;
void appWindow.onMoved(({ payload: position }) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const logical = position.toLogical(await appWindow.scaleFactor());
    settings.update({ desktopX: Math.round(logical.x), desktopY: Math.round(logical.y) });
  }, SAVE_POSITION_DELAY_MS);
});

// 字型載入完成後字寬會變：重新量每個字的位置（卡拉 OK 填色要用），太長的行重新縮放
document.fonts?.addEventListener('loadingdone', () => {
  karaoke.remeasure();
  fitToWidth();
});

settings.subscribe((next, previous) => {
  if (next.language !== previous.language) location.reload();
  if (
    next.fontZh !== previous.fontZh ||
    next.fontJa !== previous.fontJa ||
    next.fontLatin !== previous.fontLatin ||
    next.lyricBold !== previous.lyricBold
  ) {
    void applyLyricFonts(next, document.documentElement);
  }
  if (next.desktopLocked !== previous.desktopLocked) void applyLock(next.desktopLocked);
  if (next.desktopScale !== previous.desktopScale) void applyScale(next.desktopScale);
  // 設定頁按了「回到預設位置」
  if (next.desktopX === null && previous.desktopX !== null) void moveToDefault();
  shownKey = '';
});

// ===== 啟動：先決定大小與位置再顯示，才不會閃一下 =====

async function start(): Promise<void> {
  const current = settings.get();
  desk.style.setProperty('--desk-font', `${DESKTOP_FONT_PX * current.desktopScale}px`);
  void applyLyricFonts(current, document.documentElement);
  try {
    await applyScale(current.desktopScale);
    await applyPosition(current);
    await applyLock(current.desktopLocked);
  } finally {
    await appWindow.show();
  }
  await emit(REQUEST_EVENT);
  requestAnimationFrame(frame);
}

void start();
