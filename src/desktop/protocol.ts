import type { Lyrics } from '../lyrics/model';

/** 主視窗把目前顯示的歌詞送給桌面歌詞 */
export const DISPLAY_EVENT = 'lyrics://display';
/** 桌面歌詞剛開啟時，向主視窗要一份目前的歌詞 */
export const REQUEST_EVENT = 'lyrics://request';

export interface DesktopPayload {
  /** 這份歌詞屬於哪首歌（trackKey）；空字串代表沒有在播放 */
  track: string;
  title: string;
  artist: string;
  /** 已經轉成繁體、補上羅馬拼音的版本；還在找或找不到時是 null */
  lyrics: Lyrics | null;
  /** 唱過部分的顏色，「r g b」格式 */
  accent: string;
}

/** 桌面歌詞主行的基本字級（乘上設定的倍率） */
export const DESKTOP_FONT_PX = 34;
/** 第二行（羅馬拼音、翻譯、下一句）相對於主行的大小 */
export const DESKTOP_SECONDARY_RATIO = 0.58;

/** 視窗高度（CSS 像素）：主行、第二行，加上方工具列與上下留白 */
export function desktopWindowHeight(scale: number): number {
  const primary = DESKTOP_FONT_PX * scale * 1.45;
  const secondary = DESKTOP_FONT_PX * DESKTOP_SECONDARY_RATIO * scale * 1.5;
  return Math.round(primary + secondary + 64);
}

/** 視窗寬度：螢幕寬度的三分之二左右 */
export function desktopWindowWidth(screenWidth: number): number {
  return Math.round(Math.max(480, Math.min(1100, screenWidth * 0.68)));
}
