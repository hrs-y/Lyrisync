import { analyzePixels, NEUTRAL_PALETTE, type Palette } from './color';

/** 取色用的縮圖邊長：夠看出主要色塊，又不會花太多時間 */
const SAMPLE_SIZE = 24;

export interface Artwork {
  /** 給 <img> 用的 object URL */
  url: string;
  image: HTMLImageElement;
  palette: Palette;
}

/** 把封面圖解碼並分析顏色。解碼失敗（壞檔、不支援的格式）會丟出錯誤。 */
export async function loadArtwork(blob: Blob): Promise<Artwork> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return { url, image, palette: samplePalette(image) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

export function releaseArtwork(artwork: Artwork): void {
  URL.revokeObjectURL(artwork.url);
}

function samplePalette(image: HTMLImageElement): Palette {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return NEUTRAL_PALETTE;
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return analyzePixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
}
