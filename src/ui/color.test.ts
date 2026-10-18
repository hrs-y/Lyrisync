import { describe, expect, it } from 'vitest';
import {
  accentColor,
  analyzePixels,
  chroma,
  extractMesh,
  fromOklab,
  hueSpread,
  MESH_SIZE,
  mixRgb,
  NEUTRAL_PALETTE,
  relativeLuminance,
  rgbChannels,
  scrimOpacity,
  shade,
  toOklab,
  type Lab,
  type Rgb,
} from './color';

const pixels = (...colors: Array<[number, number, number, number?]>) =>
  new Uint8ClampedArray(colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));

/** 由幾種顏色組成的「封面」：[顏色, 像素數] */
const image = (...parts: Array<[Rgb, number]>): Rgb[] => parts.flatMap(([color, count]) => Array(count).fill(color));

const hue = (lab: Lab) => Math.atan2(lab.b, lab.a);
const degrees = (value: number) => (value * 180) / Math.PI;
/** 兩個色相的夾角（度，-180～180） */
const hueGap = (from: Lab, to: Lab) => {
  const gap = degrees(hue(to) - hue(from)) % 360;
  return gap > 180 ? gap - 360 : gap < -180 ? gap + 360 : gap;
};

describe('analyzePixels', () => {
  it('averages opaque pixels and finds the most vivid colour', () => {
    const palette = analyzePixels(pixels([200, 40, 40], [40, 40, 40], [40, 40, 40], [40, 40, 40], [0, 0, 0, 0]));
    expect(palette.average).toEqual({ r: 80, g: 40, b: 40 });
    expect(palette.vibrant).toEqual({ r: 200, g: 40, b: 40 });
    expect(palette.mesh).toHaveLength(MESH_SIZE);
    // 遮罩依背景色塊的亮度決定
    const meshLuminance = palette.mesh.reduce((sum, c) => sum + relativeLuminance(c), 0) / MESH_SIZE;
    expect(palette.luminance).toBeCloseTo(meshLuminance, 5);
  });

  it('falls back to the neutral palette for fully transparent images', () => {
    expect(analyzePixels(pixels([255, 255, 255, 0]))).toBe(NEUTRAL_PALETTE);
  });
});

describe('extractMesh', () => {
  it('keeps the distinct colours of a colourful cover', () => {
    const mesh = extractMesh(image([{ r: 220, g: 40, b: 50 }, 400], [{ r: 30, g: 70, b: 200 }, 400], [{ r: 240, g: 200, b: 40 }, 200]));
    expect(mesh).toHaveLength(MESH_SIZE);
    const labs = mesh.map(toOklab);
    // 紅（a > 0）、藍（b < 0）、黃（b > 0、偏亮）都要出現
    expect(labs.some((c) => c.a > 0.08 && c.b > 0)).toBe(true);
    expect(labs.some((c) => c.b < -0.08)).toBe(true);
    expect(labs.some((c) => c.b > 0.08 && c.a < 0.08)).toBe(true);
  });

  it('keeps every colour in a range that white text stays readable on', () => {
    const mesh = extractMesh(image([{ r: 255, g: 255, b: 255 }, 500], [{ r: 0, g: 0, b: 0 }, 500]));
    for (const color of mesh) {
      const { L } = toOklab(color);
      expect(L).toBeGreaterThanOrEqual(0.315);
      expect(L).toBeLessThanOrEqual(0.645);
    }
  });

  it('spreads a single-hue cover into neighbouring hues and shades', () => {
    const yellow = { r: 230, g: 200, b: 40 };
    const mesh = extractMesh(image([yellow, 400], [{ r: 150, g: 130, b: 30 }, 300], [{ r: 250, g: 232, b: 120 }, 300]));
    expect(mesh).toHaveLength(MESH_SIZE);
    const labs = mesh.map(toOklab);
    // 往兩側延伸出橘色、黃綠色，但都還在黃色附近
    expect(degrees(hueSpread(labs))).toBeGreaterThan(60);
    for (const lab of labs) expect(Math.abs(hueGap(toOklab(yellow), lab))).toBeLessThan(70);
    const lightness = labs.map((lab) => lab.L);
    expect(Math.max(...lightness) - Math.min(...lightness)).toBeGreaterThan(0.1);
  });

  it('keeps the neutral part of a cover next to its accent colour', () => {
    const red = { r: 200, g: 30, b: 40 };
    const labs = extractMesh(image([{ r: 255, g: 255, b: 255 }, 700], [red, 300])).map(toOklab);
    expect(labs.some((lab) => chroma(lab) < 0.035)).toBe(true);
    const reds = labs.filter((lab) => chroma(lab) > 0.05 && Math.abs(hueGap(toOklab(red), lab)) < 70);
    expect(reds.length).toBeGreaterThanOrEqual(3);
  });

  it('tones down neon colours', () => {
    const [first] = extractMesh(image([{ r: 0, g: 255, b: 0 }, 100]));
    expect(chroma(toOklab(first))).toBeLessThanOrEqual(0.155);
  });

  it('keeps a grey cover grey, filled with lighter and darker shades', () => {
    const mesh = extractMesh(image([{ r: 90, g: 90, b: 90 }, 300]));
    expect(mesh).toHaveLength(MESH_SIZE);
    expect(new Set(mesh.map((c) => toOklab(c).L.toFixed(2))).size).toBeGreaterThan(1);
    for (const color of mesh) expect(chroma(toOklab(color))).toBeLessThan(0.01);
  });

  it('ignores specks that cover almost nothing', () => {
    const blue = { r: 60, g: 90, b: 160 };
    expect(extractMesh(image([blue, 990], [{ r: 255, g: 0, b: 200 }, 5]))).toEqual(extractMesh(image([blue, 990])));
  });

  it('measures how far apart the hues are, across the red end of the wheel too', () => {
    const at = (deg: number) => ({ L: 0.5, a: Math.cos((deg * Math.PI) / 180) * 0.1, b: Math.sin((deg * Math.PI) / 180) * 0.1 });
    expect(hueSpread([at(30)])).toBe(0);
    expect(degrees(hueSpread([at(10), at(40), at(100)]))).toBeCloseTo(90, 5);
    expect(degrees(hueSpread([at(170), at(-170)]))).toBeCloseTo(20, 5);
  });
});

describe('colour helpers', () => {
  it('converts to OKLab and back', () => {
    for (const color of [{ r: 12, g: 200, b: 99 }, { r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }]) {
      expect(fromOklab(toOklab(color))).toEqual(color);
    }
  });

  it('measures luminance on the sRGB scale', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('darkens bright backgrounds more', () => {
    expect(scrimOpacity(0.02)).toBeCloseTo(0.18, 2);
    expect(scrimOpacity(0.8)).toBeCloseTo(0.58, 2);
    expect(scrimOpacity(0.3)).toBeGreaterThan(scrimOpacity(0.1));
  });

  it('shades, mixes and formats channels for CSS', () => {
    expect(shade({ r: 200, g: 100, b: 250 }, 1.2)).toEqual({ r: 240, g: 120, b: 255 });
    expect(mixRgb({ r: 0, g: 100, b: 200 }, { r: 100, g: 100, b: 0 }, 0.25)).toEqual({ r: 25, g: 100, b: 150 });
    expect(rgbChannels({ r: 1, g: 2.4, b: 3.6 })).toBe('1 2 4');
  });
});

describe('accentColor', () => {
  const palette = (vibrant: Rgb) => ({ ...NEUTRAL_PALETTE, vibrant });

  it('turns the most vivid cover colour into a light tint that keeps its hue', () => {
    const red = toOklab({ r: 200, g: 30, b: 40 });
    const accent = toOklab(accentColor(palette({ r: 200, g: 30, b: 40 })));
    expect(accent.L).toBeCloseTo(0.85, 1);
    expect(chroma(accent)).toBeGreaterThan(0.08);
    expect(chroma(accent)).toBeLessThan(0.16);
    // 色相不變
    expect(Math.atan2(accent.b, accent.a)).toBeCloseTo(Math.atan2(red.b, red.a), 1);
  });

  it('uses warm white when the cover has almost no colour', () => {
    expect(accentColor(palette({ r: 120, g: 120, b: 122 }))).toEqual({ r: 255, g: 228, b: 186 });
    expect(accentColor(NEUTRAL_PALETTE)).toEqual({ r: 255, g: 228, b: 186 });
  });
});
