import './styles/base.css';
import './styles/backdrop.css';
import './styles/titlebar.css';
import './styles/player.css';
import './styles/lyrics.css';
import './styles/settings.css';
import './styles/debug.css';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import {
  desktopWindowHeight,
  desktopWindowWidth,
  DISPLAY_EVENT,
  REQUEST_EVENT,
  type DesktopPayload,
} from './desktop/protocol';
import { resolveLocale, setLocale, showsChineseTranslations, t, translateDom } from './i18n';
import { LyricsCache, memoryCacheStorage, tauriCacheStorage } from './lyrics/cache';
import { toTraditionalLyrics } from './lyrics/chinese';
import { granularity, type Lyrics, type LyricsSource } from './lyrics/model';
import { demoProvider } from './lyrics/providers/demo';
import { createKugouProvider } from './lyrics/providers/kugou';
import { createLrclibProvider } from './lyrics/providers/lrclib';
import { AmllSpotifyIndex } from './lyrics/providers/amllIndex';
import { createNeteaseProvider, createTtmlDbProvider, NeteaseLookup } from './lyrics/providers/netease';
import { createQqProvider } from './lyrics/providers/qq';
import { borrowRomanization, findRomanizationDonor } from './lyrics/romanization';
import { LyricsService, type LyricsProvider, type SearchUpdate } from './lyrics/service';
import { tauriHttpGet } from './net/http';
import { createMockSource } from './player/mockSource';
import { createSmtcSource } from './player/smtcSource';
import { PlayerTracker, type LogKind } from './player/tracker';
import { trackKey, type PlayerSnapshot } from './player/types';
import { tauriSpotifyBackend, unavailableSpotifyBackend, type SpotifyStatus, type SpotifyTrack } from './spotify/api';
import { snapshotFromTrack, SpotifySession, type LikeState } from './spotify/session';
import { browserStorage, SettingsStore, type FontScale, type Settings } from './settings';
import { loadArtwork, releaseArtwork, type Artwork } from './ui/artwork';
import { BackgroundRenderer, webglAvailable } from './ui/background';
import { accentColor, NEUTRAL_PALETTE, rgbChannels } from './ui/color';
import { DebugPanel } from './ui/debugPanel';
import { applyLyricFonts } from './ui/fonts';
import { icon } from './ui/icons';
import { LyricView } from './ui/lyricView';
import { PlayerView, splitSmtcArtists, type PlayerMode } from './ui/playerView';
import { QueueView } from './ui/queueView';
import { FrameMonitor, initialLevel, QUALITY_PROFILES, type QualityLevel } from './ui/quality';
import { SettingsPanel } from './ui/settingsPanel';
import { TitleBar } from './ui/titlebar';
import { formatTime, signed } from './util/format';

const DEBUG_REFRESH_MS = 100;
const SEEK_STEP_MS = 5000;
/** 待播清單開著時，多久向 Spotify 重新要一次（使用者可能在 Spotify 裡加了歌） */
const QUEUE_REFRESH_MS = 30_000;
const FONT_SCALES: Record<FontScale, string> = { small: '0.86', medium: '1', large: '1.16' };
const LEVEL_LABELS: Record<QualityLevel, string> = { high: '高', medium: '中', low: '低' };
const SOURCE_LABELS: Record<LyricsSource, string> = {
  'ttml-db': 'AMLL TTML DB',
  qq: 'QQ',
  netease: '網易雲',
  kugou: '酷狗',
  lrclib: 'LRCLIB',
  demo: '示範',
};
/** 除錯紀錄用（紀錄一律中文，方便貼回來看） */
const GRANULARITY_LABELS = { word: '逐字', line: '逐行', plain: '純文字' } as const;

// 在 Tauri 裡讀 SMTC、向各歌詞來源搜尋；在一般瀏覽器裡用模擬播放器和示範歌詞，方便預覽畫面
const inTauri = isTauri();
const source = inTauri ? createSmtcSource() : createMockSource();
const providers: LyricsProvider[] = inTauri ? createProviders() : [demoProvider];
const spotifyBackend = inTauri ? tauriSpotifyBackend : unavailableSpotifyBackend;
const lyricsService = new LyricsService(
  providers,
  new LyricsCache(inTauri ? tauriCacheStorage : memoryCacheStorage()),
);
const settings = new SettingsStore(browserStorage());
// 桌面歌詞視窗也會改設定（鎖定、字級、位置、關閉）
settings.listenToOtherWindows();
// 介面語言要在建立畫面元件之前決定；換語言時整個重新載入
setLocale(resolveLocale(settings.get().language));
translateDom(document);

function createProviders(): LyricsProvider[] {
  const lookup = new NeteaseLookup(tauriHttpGet);
  return [
    createTtmlDbProvider(tauriHttpGet, lookup, new AmllSpotifyIndex(tauriHttpGet)),
    createQqProvider(tauriHttpGet),
    createNeteaseProvider(tauriHttpGet, lookup),
    createKugouProvider(tauriHttpGet),
    createLrclibProvider(tauriHttpGet),
  ];
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

// ===== 畫面元件 =====

const background = new BackgroundRenderer($('.backdrop'));
const player = new PlayerView($('.player'), {
  previous: () => void runCommand('上一首', () => source.previous()),
  togglePlayPause: () => void togglePlayPause(),
  next: () => void runCommand('下一首', () => source.next()),
  seek: (ms) => void seekTo(ms),
  toggleLike: () => void spotify.toggleLike(),
  openAlbum: () => openInSpotify('album'),
  openArtist: (index, name) => openInSpotify('artist', index, name),
});
const view = new LyricView(
  $('#lyrics'),
  (ms) => void seekTo(ms),
  () => nextResult(),
);
const settingsPanel = new SettingsPanel($('.settings'), settings, {
  clearCache: () => (inTauri ? invoke<number>('cache_clear') : Promise.resolve(0)),
  spotify: spotifyBackend,
});
const titlebar = new TitleBar($('.titlebar'), {
  onSettings: () => settingsPanel.toggle(),
  onDesktopLyrics: () => settings.update({ desktopLyrics: !settings.get().desktopLyrics }),
});
const translationButton = $<HTMLButtonElement>('.translation-button');
const romanizationButton = $<HTMLButtonElement>('.romanization-button');
const refetchButton = $<HTMLButtonElement>('.refetch-button');
refetchButton.innerHTML = icon('refresh');
const queueButton = $<HTMLButtonElement>('.queue-button');
queueButton.innerHTML = icon('queue');
const lyricsPanel = $('.lyrics-panel');
const queueRoot = $('.queue-view');
const queueView = new QueueView(queueRoot);
const debugDrawer = $('.debug-drawer');
const debug = new DebugPanel(debugDrawer, {
  previous: () => void runCommand('上一首', () => source.previous()),
  togglePlayPause: () => void togglePlayPause(),
  next: () => void runCommand('下一首', () => source.next()),
  seekTest: () => void seekTo(30_000),
  adjustOffset: (delta) => settings.update({ offsetMs: settings.get().offsetMs + delta }),
  resetOffset: () => settings.update({ offsetMs: 0 }),
  nextSource: () => nextResult(),
  refetch: () => void refetch(),
});

const tracker = new PlayerTracker({
  onTrackChange: (snapshot) => {
    player.setTrack(snapshot);
    titlebar.setTitle(snapshot ? `${snapshot.title} — ${snapshot.artist}` : 'Lyrisync');
    startSearch(snapshot);
  },
  onLog: (entry) => debug.log(entry),
});

function log(kind: LogKind, message: string): void {
  debug.log({ atMs: Date.now(), kind, message });
}

// ===== Spotify（選用）：精準比對、預先找下一首、按讚 =====

/** 目前的按讚狀態；設定關掉按讚按鈕時不顯示，但記著，打開時馬上恢復 */
let likeState: LikeState = { kind: 'hidden' };

const spotify = new SpotifySession({
  backend: spotifyBackend,
  onStatus: (status) => handleSpotifyStatus(status),
  onLike: (state) => {
    likeState = state;
    player.setLike(settings.get().spotifyLike ? state : { kind: 'hidden' });
  },
  log: (message, error) => log(error ? 'error' : 'spotify', message),
});

let spotifyState: SpotifyStatus['state'] = 'unavailable';

function handleSpotifyStatus(status: SpotifyStatus): void {
  settingsPanel.setSpotifyStatus(status);
  const previous = spotifyState;
  spotifyState = status.state;
  if (previous === status.state) return;
  // 待播清單按鈕只在連結時出現
  updateLyricsToolbar();
  if (status.state === 'connected' && previous === 'logging-in') {
    log('spotify', `已連結 Spotify${status.userName ? `：${status.userName}` : ''}`);
    // 剛連結：目前這首歌重找一次，馬上用歌曲 ID 精準比對、顯示按讚按鈕
    if (tracker.current) startSearch(tracker.current);
  } else if (status.state === 'expired') {
    log('error', 'Spotify 授權過期了，請到設定頁重新連結');
  } else if (status.state === 'disconnected' && previous === 'connected') {
    log('spotify', '已中斷和 Spotify 的連結');
  }
}

/** 這首歌在 Spotify 上的資料（startSearch 時開始查） */
let spotifyLookup: Promise<SpotifyTrack | null> | undefined;
/** 已經為哪一首歌找過播放佇列，同一首不重複找 */
let prefetchedFor = '';

/** 目前這首歌找完歌詞後，幫播放佇列裡接下來的兩首先找好。 */
async function prefetchQueue(snapshot: PlayerSnapshot): Promise<void> {
  const key = trackKey(snapshot);
  if (prefetchedFor === key || !spotify.connected || !settings.get().spotifyPrefetch) return;
  prefetchedFor = key;
  try {
    // 先等目前這首對應完成，才分得出佇列裡哪一首是正在播的
    await spotifyLookup?.catch(() => null);
    for (const track of await spotify.upcoming()) {
      // 已經換歌了：新的那首會自己再找
      if (!tracker.current || trackKey(tracker.current) !== key) return;
      const found = await lyricsService.prefetch(snapshotFromTrack(track), { spotify: Promise.resolve(track) });
      if (found >= 0) log('spotify', `預先找好下一首「${track.name}」的歌詞：${found} 份`);
      // 待播清單上的「歌詞已備妥」跟著更新
      renderQueue();
    }
  } catch (e) {
    log('error', `讀取 Spotify 播放佇列失敗：${e instanceof Error ? e.message : String(e)}`);
  }
}

// 視窗回到前景時，按讚狀態可能在 Spotify 裡改過
window.addEventListener('focus', () => spotify.recheckLike());

/**
 * 點封面、專輯名稱開專輯，點歌手開歌手頁。對應到 Spotify 的歌時用 ID 直接開，
 * 否則（沒連結、本機檔案）用名稱在 Spotify 裡搜尋。
 */
function openInSpotify(kind: 'album' | 'artist', index = 0, name = ''): void {
  const snapshot = tracker.current;
  if (!snapshot) return;
  const track = spotify.track;
  const id = kind === 'album' ? track?.albumId : track?.artistIds?.[index] || undefined;
  const firstArtist = splitSmtcArtists(snapshot.artist)[0] ?? '';
  const query = kind === 'album' ? `${snapshot.album || snapshot.title} ${firstArtist}`.trim() : name || firstArtist;
  log('command', `在 Spotify 開啟${kind === 'album' ? '專輯' : '歌手'}：${id ?? `搜尋「${query}」`}`);
  spotifyBackend.open(kind, id, query).catch((e: unknown) => log('error', `開啟 Spotify 失敗：${String(e)}`));
}

// ===== 待播清單 =====

let queueOpen = false;
let queueTimer: ReturnType<typeof setInterval> | null = null;
let queueToken = 0;
/** 最近一次拿到的待播清單（預先找好歌詞時重畫標記，不必再問 Spotify） */
let queueTracks: SpotifyTrack[] | null = null;

const canShowQueue = () => spotify.connected && settings.get().spotifyQueue && Boolean(tracker.current);

function setQueueOpen(open: boolean): void {
  if (open === queueOpen) return;
  queueOpen = open;
  lyricsPanel.classList.toggle('queue-open', open);
  queueRoot.hidden = !open;
  queueButton.setAttribute('aria-pressed', String(open));
  if (queueTimer) clearInterval(queueTimer);
  queueTimer = null;
  if (open) {
    queueView.resetScroll();
    void refreshQueue();
    queueTimer = setInterval(() => void refreshQueue(), QUEUE_REFRESH_MS);
  }
  updateMode();
  updateLyricsToolbar();
}

async function refreshQueue(): Promise<void> {
  const token = ++queueToken;
  if (!queueTracks) queueView.setState({ kind: 'loading' });
  try {
    // 等目前這首對應完成，佇列開頭的「目前這首」才略得掉
    await spotifyLookup?.catch(() => null);
    const tracks = await spotify.queue();
    if (token !== queueToken) return;
    queueTracks = tracks;
    renderQueue();
  } catch (e) {
    if (token !== queueToken) return;
    queueTracks = null;
    queueView.setState({ kind: 'error' });
    log('error', `讀取待播清單失敗：${e instanceof Error ? e.message : String(e)}`);
  }
}

function renderQueue(): void {
  if (!queueOpen || !queueTracks) return;
  queueView.setState({
    kind: 'tracks',
    entries: queueTracks.map((track) => ({ track, lyricsReady: lyricsService.hasPrefetched(snapshotFromTrack(track)) })),
  });
}

queueButton.addEventListener('click', () => setQueueOpen(!queueOpen));

// ===== 動畫品質與設定 =====

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const environment = () => ({ reducedMotion: reducedMotion.matches, webgl: webglAvailable() });
const monitor = new FrameMonitor();
/** 「自動」模式目前的等級（掉幀時會往下降） */
let autoLevel = initialLevel('auto', environment());
let level: QualityLevel = autoLevel;

function applyQuality(): void {
  const choice = settings.get().quality;
  level = choice === 'auto' ? autoLevel : choice;
  const profile = QUALITY_PROFILES[level];
  document.documentElement.dataset.quality = level;
  background.setQuality(profile);
  view.setQuality(profile);
  player.setAnimationsEnabled(level !== 'low' && !reducedMotion.matches);
  settingsPanel.setEffectiveLevel(level, choice === 'auto');
  monitor.reset();
}

function applySettings(next: Settings, previous?: Settings): void {
  document.documentElement.style.setProperty('--lyric-scale', FONT_SCALES[next.fontScale]);
  view.setTranslationVisible(next.showTranslation && showsChineseTranslations());
  view.setRomanizationVisible(next.showRomanization);
  view.setEffect(next.lyricEffect);
  view.setBlur(next.lyricBlur, next.blurStrength);
  // 目前這一行以外的歌詞亮度（lyrics.css 的 --dim-alpha）
  document.documentElement.style.setProperty('--dim-alpha', String(next.dimLevel));
  // 換語言：等選取的動畫做完再重新載入
  if (previous && previous.language !== next.language) setTimeout(() => location.reload(), 260);
  if (
    !previous ||
    previous.fontZh !== next.fontZh ||
    previous.fontJa !== next.fontJa ||
    previous.fontLatin !== next.fontLatin ||
    previous.lyricBold !== next.lyricBold
  ) {
    // 字型載入後行高可能改變，歌詞畫面會自己重新量
    void applyLyricFonts(next, document.documentElement);
  }
  debugDrawer.hidden = !next.showDebug;
  if (!previous || previous.quality !== next.quality) {
    // 手動選回「自動」時重新判斷，不沿用之前降過的等級
    if (next.quality === 'auto') autoLevel = initialLevel('auto', environment());
    applyQuality();
  }
  if (previous && previous.offsetMs !== next.offsetMs) log('command', `時間偏移設為 ${signed(next.offsetMs)}ms`);
  if (previous && previous.spotifyLike !== next.spotifyLike) player.setLike(next.spotifyLike ? likeState : { kind: 'hidden' });
  if (!previous || previous.desktopLyrics !== next.desktopLyrics) void syncDesktopLyrics(next.desktopLyrics);
  updateLyricsToolbar();
}

// ===== 桌面歌詞 =====

/** 唱過部分的顏色（依封面），一起送給桌面歌詞 */
let accent = rgbChannels(accentColor(NEUTRAL_PALETTE));

async function syncDesktopLyrics(enabled: boolean): Promise<void> {
  titlebar.setDesktopLyricsActive(enabled);
  if (!inTauri) return;
  try {
    if (enabled) {
      await invoke('desktop_lyrics_open', {
        width: desktopWindowWidth(window.screen.availWidth),
        height: desktopWindowHeight(settings.get().desktopScale),
      });
    } else {
      await invoke('desktop_lyrics_close');
    }
  } catch (e) {
    log('error', `桌面歌詞：${String(e)}`);
  }
}

/** 把目前顯示的歌詞（已轉繁體、補上羅馬拼音）送給桌面歌詞；桌面歌詞自己讀 SMTC 對時。 */
function broadcastLyrics(): void {
  if (!inTauri || !settings.get().desktopLyrics) return;
  const snapshot = tracker.current;
  const payload: DesktopPayload = {
    track: snapshot ? trackKey(snapshot) : '',
    title: snapshot?.title ?? '',
    artist: snapshot?.artist ?? '',
    lyrics: phase === 'found' || phase === 'instrumental' ? displayed : null,
    accent,
  };
  void emit(DISPLAY_EVENT, payload).catch(() => {});
}

// 桌面歌詞剛開啟時會來要一份目前的歌詞
if (inTauri) void listen(REQUEST_EVENT, () => broadcastLyrics());

// ===== 播放控制 =====

async function seekTo(positionMs: number): Promise<void> {
  tracker.noteLocalSeek(positionMs);
  await runCommand(`跳到 ${formatTime(positionMs)}`, () => source.seek(positionMs));
}

async function togglePlayPause(): Promise<void> {
  await runCommand('播放／暫停', () => source.togglePlayPause());
}

async function runCommand(label: string, command: () => Promise<boolean>): Promise<void> {
  try {
    const accepted = await command();
    log('command', `${label}：${accepted ? 'Spotify 接受' : 'Spotify 拒絕'}`);
  } catch (e) {
    log('error', `${label}失敗：${String(e)}`);
  }
}

// ===== 封面 =====

let artworkId = -1;
let artwork: Artwork | null = null;
let artworkToken = 0;

async function updateArtwork(snapshot: PlayerSnapshot | null): Promise<void> {
  const id = snapshot?.artworkId ?? 0;
  if (id === artworkId) return;
  artworkId = id;
  const token = ++artworkToken;
  if (!id) {
    setArtwork(null);
    return;
  }
  try {
    const blob = await source.artwork();
    if (token !== artworkToken) return;
    const next = blob ? await loadArtwork(blob) : null;
    if (token !== artworkToken) {
      if (next) releaseArtwork(next);
      return;
    }
    setArtwork(next);
  } catch (e) {
    log('error', `讀取封面失敗：${String(e)}`);
    if (token === artworkToken) setArtwork(null);
  }
}

function setArtwork(next: Artwork | null): void {
  const previous = artwork;
  artwork = next;
  const snapshot = tracker.current;
  player.setArtwork(next, snapshot ? t('app.coverAlt', { album: snapshot.album || snapshot.title }) : '');
  background.setArtwork(next);
  accent = rgbChannels(accentColor(next?.palette ?? NEUTRAL_PALETTE));
  broadcastLyrics();
  // 等交叉淡化結束再釋放舊圖
  if (previous) setTimeout(() => releaseArtwork(previous), 2000);
}

// ===== 歌詞 =====

type LyricsPhase = 'idle' | 'searching' | 'found' | 'instrumental' | 'not-found' | 'error';

/** 這首歌找到的所有歌詞（由好到壞），以及目前顯示第幾份 */
let results: Lyrics[] = [];
let chosenIndex = 0;
/** 使用者自己選過版本後，就不再自動換成後來才找到的版本 */
let pinnedByUser = false;
/** 目前顯示的歌詞（轉換前的原始資料）與轉成繁體、補上羅馬拼音後的版本 */
let shown: Lyrics | null = null;
let displayed: Lyrics | null = null;
/** 羅馬拼音是向哪一份借來的（沒有借就是 null） */
let romanizationDonor: Lyrics | null = null;
let phase: LyricsPhase = 'idle';
let lyricsStatus = '—';
let searchText = '—';
let searchStarted = 0;
let cancelSearch: (() => void) | null = null;

/** 用 Spotify 歌曲 ID 直接查到的（不是比對歌名找到的） */
const bySpotifyId = (lyrics: Lyrics) => lyrics.sourceId?.startsWith('spotify:') ?? false;

function lyricsLabel(lyrics: Lyrics): string {
  const kind = lyrics.instrumental ? '純音樂' : GRANULARITY_LABELS[granularity(lyrics)];
  return `${SOURCE_LABELS[lyrics.source]}・${kind}${bySpotifyId(lyrics) ? '・Spotify ID' : ''}`;
}

function startSearch(snapshot: PlayerSnapshot | null): void {
  cancelSearch?.();
  cancelSearch = null;
  results = [];
  chosenIndex = 0;
  pinnedByUser = false;
  shown = null;
  displayed = null;
  romanizationDonor = null;
  spotifyLookup = spotify.trackFor(snapshot);
  // 對應到 Spotify 的歌後，歌手改用 Spotify 的清單（名字分得正確、可以一人一個連結）
  spotifyLookup?.then(
    (track) => {
      if (track && tracker.current === snapshot) player.setArtists(track.artists);
    },
    () => {},
  );
  queueTracks = null;
  if (queueOpen) void refreshQueue();
  if (!snapshot) {
    phase = 'idle';
    lyricsStatus = '—';
    searchText = '—';
    view.setState({ kind: 'idle' });
  } else {
    phase = 'searching';
    lyricsStatus = '搜尋中';
    searchText = '搜尋中…';
    view.setState({ kind: 'loading' });
    searchStarted = performance.now();
    cancelSearch = lyricsService.search(snapshot, handleUpdate, { spotify: spotifyLookup });
  }
  updateMode();
  updateLyricsToolbar();
  broadcastLyrics();
}

function handleUpdate(update: SearchUpdate): void {
  const elapsed = Math.round(performance.now() - searchStarted);
  results = update.results;
  // 使用者選的那份還在就維持；否則顯示最好的
  const kept = pinnedByUser && shown ? results.indexOf(shown) : -1;
  pinnedByUser = kept >= 0;
  chosenIndex = Math.max(0, kept);

  if (results.length) {
    if (results[chosenIndex] !== shown) {
      show(results[chosenIndex]);
      log('lyrics', `顯示 ${lyricsStatus}，${results[chosenIndex].lines.length} 行（${elapsed}ms）`);
    } else if (shown && findRomanizationDonor(shown, results) !== romanizationDonor) {
      // 後來才找到的版本附了羅馬拼音，可以借給目前顯示的這份
      show(shown);
    }
  } else if (update.done) {
    phase = update.errors.length ? 'error' : 'not-found';
    lyricsStatus = update.errors.length ? '發生錯誤' : '找不到';
    view.setState({ kind: 'idle' });
  }

  searchText = describeSearch(update);
  if (update.done) {
    const where = update.prefetched ? '，播放佇列預先找好' : update.fromCache ? '，來自快取' : '';
    log('lyrics', `找完：${results.length} 份（${elapsed}ms${where}）${results.map(lyricsLabel).join('、')}`);
    for (const error of update.errors) log('error', error);
    if (tracker.current) void prefetchQueue(tracker.current);
  }
  updateMode();
  updateLyricsToolbar();
}

function show(lyrics: Lyrics): void {
  shown = lyrics;
  romanizationDonor = findRomanizationDonor(lyrics, results);
  if (romanizationDonor) log('lyrics', `羅馬拼音借用 ${lyricsLabel(romanizationDonor)}`);
  displayed = toTraditionalLyrics(borrowRomanization(lyrics, romanizationDonor));
  lyricsStatus = lyricsLabel(lyrics);
  if (displayed.instrumental) {
    phase = 'instrumental';
    view.setState({ kind: 'instrumental' });
  } else {
    phase = 'found';
    view.setState({ kind: 'lyrics', lyrics: displayed });
  }
  broadcastLyrics();
}

function describeSearch(update: SearchUpdate): string {
  if (update.prefetched) return `預先找好，${update.results.length} 份`;
  if (update.fromCache) return `快取，${update.results.length} 份`;
  const parts = providers.map((p) => (p.name in update.timings ? `${p.name} ${update.timings[p.name]}ms` : `${p.name} …`));
  const errors = update.errors.length ? `｜${update.errors.length} 個錯誤` : '';
  return `${update.results.length} 份｜${parts.join('、')}${errors}`;
}

function chooseResult(index: number): void {
  if (!results[index] || results[index] === shown) return;
  pinnedByUser = true;
  chosenIndex = index;
  show(results[index]);
  log('command', `改用 ${lyricsStatus}（第 ${index + 1}／${results.length} 份）`);
  updateMode();
  updateLyricsToolbar();
}

function nextResult(): void {
  if (results.length > 1) chooseResult((chosenIndex + 1) % results.length);
}

async function refetch(): Promise<void> {
  const snapshot = tracker.current;
  if (!snapshot) return;
  try {
    await lyricsService.forget(snapshot);
    log('command', '已刪除這首歌的快取，重新搜尋');
  } catch (e) {
    log('error', `刪除快取失敗：${String(e)}`);
  }
  startSearch(snapshot);
}

// ===== 版面狀態 =====

/** 有歌詞（或還在找）時左右分欄；找不到、純音樂時封面置中；沒偵測到 Spotify 時顯示等待畫面。 */
function updateMode(): void {
  let mode: PlayerMode;
  if (!tracker.current) mode = 'idle';
  // 待播清單開著時一樣左右分欄（清單在右欄），就算這首沒有歌詞
  else if (phase === 'searching' || phase === 'found' || queueOpen) mode = 'lyrics';
  else mode = 'cover';
  player.setMode(mode);

  if (phase === 'not-found') player.setNote(t('player.noLyrics'), { label: t('player.searchAgain'), run: () => void refetch() });
  else if (phase === 'error') player.setNote(t('player.fetchFailed'), { label: t('player.retry'), run: () => void refetch() });
  else if (phase === 'instrumental') player.setNote(t('player.instrumental'));
  else player.setNote(null);
}

/** 歌詞欄右上角的翻譯與重新搜尋按鈕，以及歌詞最後的來源說明。 */
function updateLyricsToolbar(): void {
  const searching = phase === 'searching';
  const showQueue = canShowQueue();
  queueButton.hidden = !showQueue;
  if (!showQueue && queueOpen) setQueueOpen(false);
  // 待播清單開著時只留清單按鈕
  translationButton.hidden = queueOpen || phase !== 'found' || !view.hasTranslation || !showsChineseTranslations();
  translationButton.setAttribute('aria-pressed', String(settings.get().showTranslation));
  romanizationButton.hidden = queueOpen || phase !== 'found' || !view.hasRomanization;
  romanizationButton.setAttribute('aria-pressed', String(settings.get().showRomanization));
  refetchButton.hidden = queueOpen || !tracker.current || (!searching && phase !== 'found');
  refetchButton.disabled = searching;
  refetchButton.classList.toggle('busy', searching);

  if (!shown || shown.instrumental) {
    view.setFooter(null);
    return;
  }
  const creditKey = bySpotifyId(shown) ? 'lyrics.creditBySpotify' : 'lyrics.creditDetail';
  view.setFooter({
    source: t(creditKey, { source: t(`source.${shown.source}`), granularity: t(`granularity.${granularity(shown)}`) }),
    version: { index: chosenIndex, count: results.length },
  });
}

translationButton.addEventListener('click', () =>
  settings.update({ showTranslation: !settings.get().showTranslation }),
);
romanizationButton.addEventListener('click', () =>
  settings.update({ showRomanization: !settings.get().showRomanization }),
);
refetchButton.addEventListener('click', () => void refetch());

// ===== 鍵盤 =====

window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  if (event.key === 'F11') {
    event.preventDefault();
    void titlebar.toggleFullscreen();
    return;
  }
  if (event.key === 'Escape') {
    if (settingsPanel.isOpen) settingsPanel.close();
    else if (titlebar.isFullscreen) void titlebar.setFullscreen(false);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault();
    settingsPanel.toggle();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || settingsPanel.isOpen) return;
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const onControl = Boolean(target.closest('button, [role="slider"], [role="switch"]'));
  const position = tracker.clock.now();

  switch (event.key.toLowerCase()) {
    case ' ':
      if (onControl) return;
      event.preventDefault();
      void togglePlayPause();
      break;
    case 'arrowleft':
      if (target.closest('[role="slider"]')) return;
      void seekTo(Math.max(0, position - SEEK_STEP_MS));
      break;
    case 'arrowright':
      if (target.closest('[role="slider"]')) return;
      void seekTo(position + SEEK_STEP_MS);
      break;
    case 's':
      nextResult();
      break;
    case 'r':
      if (phase !== 'searching') void refetch();
      break;
    case 't':
      if (view.hasTranslation && showsChineseTranslations()) settings.update({ showTranslation: !settings.get().showTranslation });
      break;
    case 'j':
      if (view.hasRomanization) settings.update({ showRomanization: !settings.get().showRomanization });
      break;
    case 'l':
      if (inTauri) settings.update({ desktopLyrics: !settings.get().desktopLyrics });
      break;
    case 'q':
      if (canShowQueue()) setQueueOpen(!queueOpen);
      break;
    case 'd':
      settings.update({ showDebug: !settings.get().showDebug });
      break;
  }
});

// ===== 啟動 =====

// 所有狀態都宣告完才能套用設定（套用時會用到歌詞的狀態）
settings.subscribe(applySettings);
applySettings(settings.get());
reducedMotion.addEventListener('change', () => {
  if (settings.get().quality === 'auto') {
    autoLevel = initialLevel('auto', environment());
    applyQuality();
  }
});

// ===== 主迴圈 =====

let lastFrame = performance.now();
let lastDebugRefresh = 0;

function frame(now: number): void {
  const dt = now - lastFrame;
  lastFrame = now;
  const position = tracker.clock.now();
  const current = settings.get();

  view.update(position + current.offsetMs, now);
  player.update(position, tracker.current?.durationMs ?? 0);
  background.render(now);

  if (current.quality === 'auto' && document.visibilityState === 'visible') {
    const lower = monitor.push(dt, level);
    if (lower) {
      autoLevel = lower;
      log('command', `畫面不夠順，動畫品質自動降為「${LEVEL_LABELS[lower]}」`);
      applyQuality();
    }
  }

  if (current.showDebug && now - lastDebugRefresh >= DEBUG_REFRESH_MS) {
    lastDebugRefresh = now;
    debug.update({
      sourceKind: source.kind,
      snapshot: tracker.current,
      estimateMs: position,
      offsetMs: current.offsetMs,
      lineIndex: view.currentIndex,
      lyrics: displayed,
      lyricsStatus,
      searchText,
      positionReports: tracker.positionReports,
      spotifyText: spotify.describe(),
    });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

log('command', inTauri ? '啟動：透過 SMTC 讀取 Spotify' : '啟動：瀏覽器預覽，使用模擬播放器');
// 先知道有沒有連結 Spotify，第一首歌才會用歌曲 ID 精準比對（讀狀態只要幾毫秒）
void spotify.init().finally(() =>
  source
    .subscribe((event) => {
      tracker.handle(event);
      const snapshot = tracker.current;
      // 沒偵測到 Spotify 時收起待播清單
      if (!snapshot && queueOpen) setQueueOpen(false);
      player.setPlaying(snapshot?.status === 'playing');
      void updateArtwork(snapshot);
      updateMode();
    })
    .catch((e) => log('error', `無法接收播放狀態：${String(e)}`)),
);
