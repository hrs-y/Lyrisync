export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Palette {
  /** 平均色 */
  average: Rgb;
  /** 封面裡最鮮豔的顏色，用來染陰影 */
  vibrant: Rgb;
  /** 背景色塊的平均相對亮度（0～1），決定暗色遮罩的濃度 */
  luminance: number;
  /** 背景用的顏色（固定 MESH_SIZE 種）：封面的主要色彩，已調整到適合當背景的亮度與彩度 */
  mesh: Rgb[];
}

/** 背景同時流動的色塊數量 */
export const MESH_SIZE = 5;

/** 沒有封面時用的中性色：偏暖的炭灰，不用常見的藍紫漸層 */
export const NEUTRAL_PALETTE: Palette = {
  average: { r: 38, g: 34, b: 31 },
  vibrant: { r: 92, g: 78, b: 66 },
  luminance: 0.035,
  mesh: [
    { r: 74, g: 64, b: 56 },
    { r: 52, g: 46, b: 42 },
    { r: 88, g: 74, b: 62 },
    { r: 44, g: 40, b: 37 },
    { r: 64, g: 57, b: 51 },
  ],
};

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (value: number) => {
  const c = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** OKLab：L 是亮度（0～1），a、b 是色彩方向。在這個空間裡算距離，比 RGB 更接近人眼的感受 */
export interface Lab {
  L: number;
  a: number;
  b: number;
}

export function toOklab({ r, g, b }: Rgb): Lab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function fromOklab({ L, a, b }: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export const chroma = ({ a, b }: Lab) => Math.hypot(a, b);
const distance = (p: Lab, q: Lab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);

/** HSV 的飽和度與明度（0～1） */
function saturationValue({ r, g, b }: Rgb): { s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return { s: max === 0 ? 0 : (max - min) / max, v: max / 255 };
}

/**
 * 分析縮小後的封面像素（RGBA）。鮮豔色取「飽和度 × 明度」最高的前一成像素的平均，
 * 比單一像素穩定，也不會選到雜點。
 */
export function analyzePixels(data: Uint8ClampedArray): Palette {
  const pixels: Rgb[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  if (!pixels.length) return NEUTRAL_PALETTE;

  const average = mean(pixels);
  const ranked = pixels
    .map((pixel) => {
      const { s, v } = saturationValue(pixel);
      return { pixel, score: s * v };
    })
    .sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 10))).map((item) => item.pixel);
  const mesh = extractMesh(pixels);
  const luminance = mesh.reduce((sum, color) => sum + relativeLuminance(color), 0) / mesh.length;
  return { average, vibrant: mean(top), luminance, mesh };
}

/** 分群的數量：比背景用的色塊多一點，挑的時候才有選擇 */
const CLUSTERS = 6;
const KMEANS_ITERATIONS = 10;
/** 面積不到這個比例的顏色當成雜點，不拿來當背景 */
const MIN_CLUSTER_WEIGHT = 0.02;
/** 兩個背景色至少要差這麼多（OKLab 距離），太像的只留一個 */
const MIN_MESH_DISTANCE = 0.06;
/** 背景色的亮度範圍：太暗整片發黑，太亮會吃掉白字；深淺拉開一點，流動時才看得出層次 */
const MESH_LIGHTNESS = [0.32, 0.64] as const;
/** 背景色的彩度：稍微加強，但設上限，不會刺眼 */
const MESH_CHROMA_BOOST = 1.2;
const MESH_CHROMA_MAX = 0.15;
/** 彩度低於這個值當成灰色 */
const CHROMATIC_MIN = 0.035;
/** 有顏色的部分色相跨度小於這個角度，就算單一色系 */
const NARROW_HUE_SPREAD = (50 * Math.PI) / 180;
/** 單一色系時保留的第二個顏色，要和主色的深淺差這麼多才有意義 */
const SECOND_SHADE_GAP = 0.12;
/**
 * 單一色系的封面，從主色往色相兩側延伸出相鄰的顏色（例如黃色延伸出橘色和黃綠色），深淺也錯開。
 * 角度不大，離主色較遠的兩個彩度也降低，看起來仍然是同一張封面的色調。依序填入空位。
 */
const ANALOGOUS: ReadonlyArray<{ hueDeg: number; dL: number; chroma: number }> = [
  { hueDeg: 28, dL: -0.09, chroma: 1 },
  { hueDeg: -28, dL: 0.07, chroma: 1 },
  { hueDeg: 48, dL: 0.03, chroma: 0.75 },
  { hueDeg: -48, dL: -0.14, chroma: 0.75 },
];

/**
 * 從封面取出背景用的顏色：先在 OKLab 裡分群，再依「面積的平方根 ×（彩度＋底分）」排序，
 * 讓鮮豔但面積不大的顏色也有機會入選，並調整亮度與彩度。
 * 單一色系的封面（例如整張偏黃）挑出來的顏色都很接近，背景會整片同一個顏色：
 * 這時只留主色（和深淺差很多的第二個顏色）與灰色調，其餘換成相鄰色相。灰階封面維持灰階，用深淺變化補滿。
 */
export function extractMesh(pixels: readonly Rgb[]): Rgb[] {
  if (!pixels.length) return NEUTRAL_PALETTE.mesh;
  const clusters = kMeans(pixels.map(toOklab), CLUSTERS).filter((c) => c.weight >= MIN_CLUSTER_WEIGHT);
  const ranked = clusters
    .map((cluster) => ({ ...cluster, score: Math.sqrt(cluster.weight) * (0.12 + chroma(cluster.center)) }))
    .sort((a, b) => b.score - a.score);

  const picked: Lab[] = [];
  for (const cluster of ranked) {
    if (picked.length >= MESH_SIZE) break;
    const color = forBackground(cluster.center);
    if (isDistinct(picked, color)) picked.push(color);
  }
  if (!picked.length) picked.push(forBackground(ranked[0]?.center ?? toOklab(mean(pixels))));

  const colorful = picked.filter((color) => chroma(color) >= CHROMATIC_MIN);
  let mesh = [...picked];
  if (colorful.length && hueSpread(colorful) < NARROW_HUE_SPREAD) {
    const [main] = colorful;
    const neutrals = picked.filter((color) => chroma(color) < CHROMATIC_MIN).slice(0, 2);
    const second = colorful.find((color) => Math.abs(color.L - main.L) >= SECOND_SHADE_GAP);
    // 保持原本的排名順序，第一個仍是封面最主要的顏色
    mesh = picked.filter((color) => color === main || color === second || neutrals.includes(color));
  }
  if (colorful.length) {
    for (const { hueDeg, dL, chroma: chromaScale } of ANALOGOUS) {
      if (mesh.length >= MESH_SIZE) break;
      const color = shiftHue(colorful[0], hueDeg, dL, chromaScale);
      if (isDistinct(mesh, color)) mesh.push(color);
    }
  }
  // 灰階封面（或還不夠時）：用已選顏色的深淺變化補滿
  for (let i = 0; mesh.length < MESH_SIZE; i++) {
    const base = picked[i % picked.length];
    const delta = (i % 2 === 0 ? 1 : -1) * (0.07 + 0.03 * Math.floor(i / 2));
    mesh.push(forBackground({ ...base, L: base.L + delta }));
  }
  return mesh.map(fromOklab);
}

const isDistinct = (chosen: readonly Lab[], color: Lab) =>
  chosen.every((other) => distance(other, color) >= MIN_MESH_DISTANCE);

const clampLightness = (L: number) => Math.max(MESH_LIGHTNESS[0], Math.min(MESH_LIGHTNESS[1], L));

/** 調整成適合當背景的顏色：亮度限制在中間區段，彩度稍微加強但不超過上限 */
function forBackground(color: Lab): Lab {
  const L = clampLightness(color.L);
  const c = chroma(color);
  if (c < 1e-4) return { L, a: 0, b: 0 };
  const boosted = Math.min(MESH_CHROMA_MAX, c * MESH_CHROMA_BOOST);
  return { L, a: (color.a / c) * boosted, b: (color.b / c) * boosted };
}

/**
 * 相鄰色相：色相轉 hueDeg 度、亮度加 dL（超出背景適用的範圍就改往反方向，深淺才拉得開）；
 * 彩度沿用（太淡的稍微補一點）再乘上 chromaScale。
 */
function shiftHue(color: Lab, hueDeg: number, dL: number, chromaScale = 1): Lab {
  const c = Math.min(MESH_CHROMA_MAX, Math.max(0.05, chroma(color))) * chromaScale;
  const hue = Math.atan2(color.b, color.a) + (hueDeg * Math.PI) / 180;
  const shifted = color.L + dL;
  const L = shifted < MESH_LIGHTNESS[0] || shifted > MESH_LIGHTNESS[1] ? color.L - dL : shifted;
  return { L: clampLightness(L), a: Math.cos(hue) * c, b: Math.sin(hue) * c };
}

/** 一組顏色的色相跨度（弧度）：色相環一整圈扣掉最大的空隙 */
export function hueSpread(colors: readonly Lab[]): number {
  if (colors.length < 2) return 0;
  const hues = colors.map((color) => Math.atan2(color.b, color.a)).sort((x, y) => x - y);
  let largestGap = hues[0] + 2 * Math.PI - hues[hues.length - 1];
  for (let i = 1; i < hues.length; i++) largestGap = Math.max(largestGap, hues[i] - hues[i - 1]);
  return 2 * Math.PI - largestGap;
}

interface Cluster {
  center: Lab;
  /** 這一群佔全部像素的比例 */
  weight: number;
}

/** k-means 分群。起始中心用「離現有中心最遠的點」依序挑，結果固定、不靠亂數。 */
function kMeans(points: readonly Lab[], k: number, iterations = KMEANS_ITERATIONS): Cluster[] {
  const centers: Lab[] = [meanLab(points)];
  while (centers.length < k) {
    let farthest = points[0];
    let farthestDistance = -1;
    for (const point of points) {
      const nearest = Math.min(...centers.map((center) => distance(point, center)));
      if (nearest > farthestDistance) {
        farthestDistance = nearest;
        farthest = point;
      }
    }
    if (farthestDistance < 1e-6) break;
    centers.push(farthest);
  }

  let assignment = new Array<number>(points.length).fill(0);
  for (let round = 0; round < iterations; round++) {
    assignment = points.map((point) => {
      let best = 0;
      for (let i = 1; i < centers.length; i++) if (distance(point, centers[i]) < distance(point, centers[best])) best = i;
      return best;
    });
    centers.forEach((_, i) => {
      const members = points.filter((_, p) => assignment[p] === i);
      if (members.length) centers[i] = meanLab(members);
    });
  }
  return centers.map((center, i) => ({
    center,
    weight: assignment.filter((a) => a === i).length / points.length,
  }));
}

function meanLab(points: readonly Lab[]): Lab {
  const sum = points.reduce((acc, p) => ({ L: acc.L + p.L, a: acc.a + p.a, b: acc.b + p.b }), { L: 0, a: 0, b: 0 });
  return { L: sum.L / points.length, a: sum.a / points.length, b: sum.b / points.length };
}

function mean(pixels: readonly Rgb[]): Rgb {
  const sum = pixels.reduce((acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }), { r: 0, g: 0, b: 0 });
  return {
    r: Math.round(sum.r / pixels.length),
    g: Math.round(sum.g / pixels.length),
    b: Math.round(sum.b / pixels.length),
  };
}

/** 封面幾乎沒有顏色時，桌面歌詞用的暖白色 */
const NEUTRAL_ACCENT: Rgb = { r: 255, g: 228, b: 186 };

/**
 * 桌面歌詞唱過部分的顏色：封面最鮮豔的顏色調亮到接近白，彩度控制在不刺眼的範圍；
 * 封面幾乎沒有顏色時用暖白色。
 */
export function accentColor(palette: Palette): Rgb {
  const lab = toOklab(palette.vibrant);
  const c = chroma(lab);
  if (c < 0.04) return NEUTRAL_ACCENT;
  const target = Math.min(0.15, Math.max(0.09, c));
  return fromOklab({ L: 0.85, a: (lab.a / c) * target, b: (lab.b / c) * target });
}

/** 依亮度調暗或調亮（factor < 1 變暗）。 */
export function shade({ r, g, b }: Rgb, factor: number): Rgb {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return { r: clamp(r * factor), g: clamp(g * factor), b: clamp(b * factor) };
}

/** 兩個顏色之間的線性插值（t = 0 是 from，1 是 to） */
export function mixRgb(from: Rgb, to: Rgb, t: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

/** 「r g b」格式，給 CSS 的 rgb(var(--x) / alpha) 用 */
export function rgbChannels({ r, g, b }: Rgb): string {
  return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
}

/**
 * 背景上的暗色遮罩濃度：背景越亮遮得越多，白色歌詞才看得清楚。
 * 很暗的背景幾乎不遮，避免整個畫面變成一片黑。
 */
export function scrimOpacity(luminance: number): number {
  const t = Math.max(0, Math.min(1, (luminance - 0.05) / 0.5));
  return 0.18 + t * 0.4;
}
