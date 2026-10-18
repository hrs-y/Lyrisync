import { DEMO_TRACKS } from '../lyrics/providers/demo';
import type { PlayerSnapshot, PlayerSource, SnapshotEvent } from './types';

type DrawCover = (context: CanvasRenderingContext2D, size: number) => void;

/** 柔和的色塊封面：漸層底加上幾團光暈 */
function blobCover(base: [string, string], blobs: Array<[number, number, number, string]>): DrawCover {
  return (context, size) => {
    const gradient = context.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, base[0]);
    gradient.addColorStop(1, base[1]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    for (const [x, y, r, color] of blobs) {
      const blob = context.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size);
      blob.addColorStop(0, color);
      blob.addColorStop(1, `${color}00`);
      context.fillStyle = blob;
      context.fillRect(0, 0, size, size);
    }
    // 細斜線紋理，讓示範封面不會只是一片平滑漸層
    context.strokeStyle = 'rgb(255 255 255 / 0.05)';
    context.lineWidth = 2;
    for (let i = -size; i < size; i += 18) {
      context.beginPath();
      context.moveTo(i, size);
      context.lineTo(i + size, 0);
      context.stroke();
    }
  };
}

/** 邊緣銳利、對比強烈的幾何封面：用來檢查背景會不會看起來像一張放大的封面 */
const geometricCover: DrawCover = (context, size) => {
  context.fillStyle = '#efe8dc';
  context.fillRect(0, 0, size, size);
  context.fillStyle = '#c0392b';
  context.fillRect(size * 0.08, 0, size * 0.14, size);
  context.fillStyle = '#16181d';
  context.beginPath();
  context.arc(size * 0.62, size * 0.42, size * 0.26, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#2f5d9b';
  context.fillRect(size * 0.5, size * 0.74, size * 0.36, size * 0.12);
  context.strokeStyle = '#16181d';
  context.lineWidth = size * 0.012;
  for (const y of [0.18, 0.92]) {
    context.beginPath();
    context.moveTo(size * 0.3, size * y);
    context.lineTo(size * 0.95, size * y);
    context.stroke();
  }
};

/** 示範封面：程式畫的抽象圖案，每首歌一張 */
const DEMO_ARTWORK: readonly DrawCover[] = [
  blobCover(['#2b1d2a', '#c8553d'], [
    [0.28, 0.3, 0.42, '#f2a541'],
    [0.74, 0.72, 0.46, '#8f2d56'],
    [0.62, 0.18, 0.22, '#f6d58e'],
  ]),
  blobCover(['#0f2e2c', '#2a7f62'], [
    [0.7, 0.28, 0.38, '#e9c46a'],
    [0.22, 0.74, 0.44, '#1b4332'],
    [0.48, 0.52, 0.24, '#f4a261'],
  ]),
  geometricCover,
];

const artworkCache = new Map<number, Promise<Blob | null>>();

function drawArtwork(index: number): Promise<Blob | null> {
  let pending = artworkCache.get(index);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return resolve(null);
    DEMO_ARTWORK[index % DEMO_ARTWORK.length](context, size);
    canvas.toBlob(resolve, 'image/png');
  });
  artworkCache.set(index, pending);
  return pending;
}

/**
 * 瀏覽器預覽用的模擬播放器，行為盡量貼近 Spotify 的 SMTC：
 * 只在狀態改變時回報進度；換歌時先把進度歸零，過 300ms 才換歌名。
 */
export function createMockSource(): PlayerSource {
  const listeners: Array<(event: SnapshotEvent) => void> = [];
  let index = 0;
  let playing = true;
  let positionMs = 0;
  let lastUpdatedMs = Date.now();

  const track = () => DEMO_TRACKS[index];
  const currentPosition = () =>
    Math.min(track().durationMs, positionMs + (playing ? Date.now() - lastUpdatedMs : 0));
  const setPosition = (ms: number) => {
    positionMs = Math.max(0, Math.min(track().durationMs, ms));
    lastUpdatedMs = Date.now();
  };
  const snapshot = (): PlayerSnapshot => ({
    appId: 'mock',
    title: track().title,
    artist: track().artist,
    album: track().album,
    status: playing ? 'playing' : 'paused',
    positionMs,
    durationMs: track().durationMs,
    lastUpdatedMs,
    artworkId: index + 1,
  });
  const emit = () => {
    const event = { snapshot: snapshot(), capturedMs: Date.now() };
    for (const listener of listeners) listener(event);
  };
  const skip = (step: number) => {
    setPosition(0);
    emit();
    setTimeout(() => {
      index = (index + step + DEMO_TRACKS.length) % DEMO_TRACKS.length;
      setPosition(0);
      emit();
    }, 300);
  };

  // 播完自動換下一首
  setInterval(() => {
    if (playing && currentPosition() >= track().durationMs) skip(1);
  }, 250);

  return {
    kind: 'mock',
    async subscribe(listener) {
      listeners.push(listener);
      listener({ snapshot: snapshot(), capturedMs: Date.now() });
    },
    artwork: () => drawArtwork(index),
    async seek(ms) {
      setPosition(ms);
      emit();
      return true;
    },
    async togglePlayPause() {
      setPosition(currentPosition());
      playing = !playing;
      emit();
      return true;
    },
    async next() {
      skip(1);
      return true;
    },
    async previous() {
      skip(-1);
      return true;
    },
  };
}
