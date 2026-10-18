/** 毫秒 → m:ss.mmm */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const sign = ms < 0 ? '-' : '';
  const total = Math.round(Math.abs(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** 播放時間：毫秒 → m:ss（無條件捨去到秒，和 Spotify 的顯示一致） */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** 帶正負號的整數，例如 +120、-35 */
export function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** 帶正負號的秒數，例如 +0.218s、-0.166s */
export function signedSeconds(ms: number): string {
  return `${ms < 0 ? '-' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}s`;
}
