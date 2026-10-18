export interface Point {
  x: number;
  y: number;
}

/** 螢幕上的矩形（實體像素） */
export interface ScreenRect extends Point {
  width: number;
  height: number;
}

/** 點是否落在矩形裡（含左、上邊，不含右、下邊） */
export function contains(area: ScreenRect, point: Point): boolean {
  return point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height;
}

/**
 * 網頁裡的元素在螢幕上的範圍（實體像素），四周再放寬 pad 個 CSS 像素。
 * CSS 像素換成實體像素要乘網頁自己的 devicePixelRatio，不能用視窗的縮放比例：
 * Windows 的「文字大小」不是 100% 時，WebView2 會把它乘進去（例如顯示縮放 150% × 文字大小 105% = 1.575），
 * 用視窗的 1.5 算，越往右偏得越多。
 */
export function elementOnScreen(
  origin: Point,
  rect: { left: number; top: number; width: number; height: number },
  pixelRatio: number,
  pad = 0,
): ScreenRect {
  return {
    x: origin.x + (rect.left - pad) * pixelRatio,
    y: origin.y + (rect.top - pad) * pixelRatio,
    width: (rect.width + pad * 2) * pixelRatio,
    height: (rect.height + pad * 2) * pixelRatio,
  };
}
