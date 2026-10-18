import type { Lyrics } from '../lyrics/model';
import type { LogEntry } from '../player/tracker';
import type { PlayerSnapshot } from '../player/types';
import { formatTime, signed, signedSeconds } from '../util/format';

export interface DebugActions {
  previous(): void;
  togglePlayPause(): void;
  next(): void;
  /** 跳到 0:30，測試 Spotify 收不收 SMTC 的跳轉指令 */
  seekTest(): void;
  adjustOffset(deltaMs: number): void;
  resetOffset(): void;
  nextSource(): void;
  refetch(): void;
}

export interface DebugInfo {
  sourceKind: 'smtc' | 'mock';
  snapshot: PlayerSnapshot | null;
  estimateMs: number;
  offsetMs: number;
  lineIndex: number;
  lyrics: Lyrics | null;
  lyricsStatus: string;
  /** 各歌詞來源的回覆時間與錯誤 */
  searchText: string;
  positionReports: readonly number[];
  /** Spotify 連結狀態與這首歌的 ID */
  spotifyText: string;
}

const MAX_LOG_ENTRIES = 300;

const FIELDS = [
  ['source', '來源'],
  ['app', 'App ID'],
  ['track', '歌曲'],
  ['album', '專輯'],
  ['status', '狀態'],
  ['reported', '回報進度'],
  ['updated', 'Spotify 更新'],
  ['estimate', '推算進度'],
  ['duration', '長度'],
  ['offset', '時間偏移'],
  ['line', '目前行'],
  ['lyrics', '歌詞'],
  ['matched', '比對到'],
  ['search', '來源回覆'],
  ['spotify', 'Spotify'],
  ['reports', '進度回報'],
] as const;

type FieldKey = (typeof FIELDS)[number][0];

/** Phase 0 的量測面板：即時數值、測試按鈕、事件紀錄。 */
export class DebugPanel {
  private readonly values = new Map<FieldKey, HTMLElement>();
  private readonly logList = document.createElement('ol');
  private readonly entries: LogEntry[] = [];

  constructor(root: HTMLElement, actions: DebugActions) {
    const fields = document.createElement('dl');
    fields.className = 'debug-fields';
    for (const [key, label] of FIELDS) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = '—';
      this.values.set(key, dd);
      fields.append(dt, dd);
    }

    const buttons = document.createElement('div');
    buttons.className = 'debug-actions';
    const addButton = (label: string, title: string, onClick: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title;
      button.addEventListener('click', onClick);
      buttons.append(button);
    };
    addButton('⏮', '上一首', actions.previous);
    addButton('⏯', '播放／暫停', actions.togglePlayPause);
    addButton('⏭', '下一首', actions.next);
    addButton('跳到 0:30', '測試 Spotify 收不收 SMTC 的跳轉指令', actions.seekTest);
    addButton('−100ms', '歌詞延後 100ms', () => actions.adjustOffset(-100));
    addButton('+100ms', '歌詞提早 100ms', () => actions.adjustOffset(100));
    addButton('偏移歸零', '把時間偏移設回 0', actions.resetOffset);
    addButton('換一份歌詞', '改用下一個來源找到的歌詞（S）', actions.nextSource);
    addButton('重新抓歌詞', '刪掉這首歌的快取，重新詢問所有來源', actions.refetch);
    addButton('複製紀錄', '把事件紀錄複製到剪貼簿', () => void this.copyLog());

    const logHeader = document.createElement('div');
    logHeader.className = 'debug-log-header';
    logHeader.textContent = '事件紀錄（新的在上面）';
    this.logList.className = 'debug-log';

    root.append(fields, buttons, logHeader, this.logList);
  }

  log(entry: LogEntry): void {
    const previous = this.entries[this.entries.length - 1];
    this.entries.push(entry);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.shift();
      this.logList.lastElementChild?.remove();
    }
    const item = document.createElement('li');
    item.className = `log-${entry.kind}`;
    item.textContent = formatEntry(entry, previous);
    this.logList.prepend(item);
  }

  update(info: DebugInfo): void {
    const s = info.snapshot;
    this.set('source', info.sourceKind === 'smtc' ? 'SMTC' : '模擬播放器（瀏覽器預覽）');
    this.set('app', s?.appId ?? '—');
    this.set('track', s ? `${s.title} — ${s.artist}` : '偵測不到 Spotify');
    this.set('album', s?.album || '—');
    this.set('status', s?.status ?? '—');
    this.set('reported', s ? formatTime(s.positionMs) : '—');
    this.set('updated', !s ? '—' : s.lastUpdatedMs > 0 ? `${((Date.now() - s.lastUpdatedMs) / 1000).toFixed(1)} 秒前` : '未提供');
    this.set('estimate', s ? formatTime(info.estimateMs) : '—');
    this.set('duration', s ? formatTime(s.durationMs) : '—');
    const direction = info.offsetMs > 0 ? '（歌詞提早）' : info.offsetMs < 0 ? '（歌詞延後）' : '';
    this.set('offset', `${signed(info.offsetMs)}ms${direction}`);
    this.set('line', info.lyrics?.synced ? `${info.lineIndex + 1} / ${info.lyrics.lines.length}` : '—');
    const lyricsSource = info.lyrics ? `（${info.lyrics.source}${info.lyrics.sourceId ? ` #${info.lyrics.sourceId}` : ''}）` : '';
    this.set('lyrics', `${info.lyricsStatus}${lyricsSource}`);
    this.set('matched', matchedText(info));
    this.set('search', info.searchText);
    this.set('spotify', info.spotifyText);
    this.set('reports', reportText(info.positionReports));
  }

  private set(key: FieldKey, text: string): void {
    const el = this.values.get(key);
    if (el && el.textContent !== text) el.textContent = text;
  }

  private async copyLog(): Promise<void> {
    const text = this.entries.map((entry, i) => formatEntry(entry, this.entries[i - 1])).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.log({ atMs: Date.now(), kind: 'command', message: `已複製 ${this.entries.length} 筆紀錄` });
    } catch (e) {
      this.log({ atMs: Date.now(), kind: 'error', message: `複製失敗：${String(e)}` });
    }
  }
}

function formatEntry(entry: LogEntry, previous?: LogEntry): string {
  const d = new Date(entry.atMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  // 和上一筆的間隔，用來看事件的先後與時間差（Rust 端的讀取時間可能比前端的紀錄早，所以會有負數）
  const delta = previous ? signedSeconds(entry.atMs - previous.atMs) : '';
  return `${clock} ${delta.padStart(9)} [${entry.kind}] ${entry.message}`;
}

function matchedText(info: DebugInfo): string {
  const matched = info.lyrics?.matched;
  if (!matched) return '—';
  const diff =
    matched.durationMs && info.snapshot ? `，長度差 ${signed(matched.durationMs - info.snapshot.durationMs)}ms` : '';
  return `${matched.title} — ${matched.artist}${diff}`;
}

function reportText(reports: readonly number[]): string {
  if (reports.length < 2) return `${reports.length} 次`;
  const intervals = reports.slice(1).map((t, i) => t - reports[i]);
  const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  return `${reports.length} 次，平均間隔 ${(average / 1000).toFixed(2)} 秒`;
}
