import { describe, expect, it } from 'vitest';
import { contains, elementOnScreen } from './geometry';

describe('contains', () => {
  const area = { x: 10, y: 20, width: 100, height: 50 };

  it('includes the left and top edges but not the right and bottom ones', () => {
    expect(contains(area, { x: 10, y: 20 })).toBe(true);
    expect(contains(area, { x: 109, y: 69 })).toBe(true);
    expect(contains(area, { x: 110, y: 40 })).toBe(false);
    expect(contains(area, { x: 50, y: 70 })).toBe(false);
    expect(contains(area, { x: 9, y: 40 })).toBe(false);
  });
});

describe('elementOnScreen', () => {
  it('converts CSS pixels to screen pixels and widens by the padding', () => {
    expect(elementOnScreen({ x: 100, y: 200 }, { left: 10, top: 4, width: 30, height: 28 }, 2, 5)).toEqual({
      x: 110,
      y: 198,
      width: 80,
      height: 76,
    });
  });

  it("finds the unlock button with the page's own pixel ratio when Windows text size is not 100%", () => {
    // 實測：顯示縮放 150%、文字大小 105%，網頁的 devicePixelRatio 是 1.575；游標停在解鎖按鈕上
    const windowRect = { x: 455, y: 1229, width: 1650, height: 215 };
    const button = { left: 1008.27, top: 8, width: 30, height: 28 };
    const cursor = { x: 2065, y: 1265 };
    expect(contains(elementOnScreen(windowRect, button, 1.575, 6), cursor)).toBe(true);
    // 用視窗的縮放比例 1.5 算會偏左，點不到
    expect(contains(elementOnScreen(windowRect, button, 1.5, 6), cursor)).toBe(false);
  });
});
