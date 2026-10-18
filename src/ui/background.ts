import type { Artwork } from './artwork';
import { MESH_SIZE, mixRgb, NEUTRAL_PALETTE, rgbChannels, scrimOpacity, shade, type Palette, type Rgb } from './color';
import type { QualityProfile } from './quality';

const CROSSFADE_MS = 1600;
/** 畫布解析度相對於視窗：背景都是低頻色塊，用低解析度畫再放大，看起來一樣平滑 */
const RESOLUTION_SCALE = 1 / 8;
const MAX_CANVAS_SIDE = 256;
/** 靜態背景的底色是主色調暗後的版本，色塊之間的空隙不會發灰 */
const BASE_SHADE = 0.5;
/** 顏色在線性亮度空間裡混合，交界處不會變得混濁發暗 */
const GAMMA = 2.2;
/** 流動速度（1 是著色器裡寫的頻率）：看得出在流動，但不會快到分散注意力 */
const FLOW_SPEED = 0.65;

const VERTEX_SHADER = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * 封面的每一種顏色各佔一塊區域，邊緣柔和地交融（離哪個色塊中心近，那個顏色就佔多一點）；
 * 顏色依重要性排序，越前面的色塊越大，封面主色佔得最多。色塊沿著各自的軌跡移動、時大時小，
 * 整片畫面緩慢旋轉，再疊幾層正弦扭曲，交界像液體一樣捲動。顏色來自封面，但不會出現封面上的圖案。
 * 時間單位是秒。
 */
const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform vec3 uColors[${MESH_SIZE}];
uniform float uTime;
uniform float uAspect;

/* 越大，各個顏色的區域越分明；太大邊界會變硬 */
const float SHARPNESS = 9.0;

vec2 flow(vec2 p, float t) {
  p += 0.16 * vec2(sin(p.y * 1.9 + t * 0.31), cos(p.x * 1.7 - t * 0.27));
  p += 0.10 * vec2(sin(p.y * 3.3 - t * 0.23 + 1.3), cos(p.x * 2.9 + t * 0.29 + 0.7));
  p += 0.05 * vec2(sin((p.x + p.y) * 5.1 + t * 0.37), cos((p.x - p.y) * 4.7 - t * 0.33));
  return p;
}

void main() {
  /* 以畫面高度為 1、中心為原點的座標 */
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float angle = uTime * 0.035;
  float c = cos(angle);
  float s = sin(angle);
  p = flow(mat2(c, s, -s, c) * p, uTime);

  float energy[${MESH_SIZE}];
  float lowest = 1e6;
  for (int i = 0; i < ${MESH_SIZE}; i++) {
    float fi = float(i);
    vec2 center = vec2(
      0.40 * uAspect * sin(uTime * (0.13 + 0.037 * fi) + fi * 2.1),
      0.36 * cos(uTime * (0.11 + 0.041 * fi) + fi * 1.3)
    );
    vec2 d = p - center;
    float size = (1.0 + 0.3 * sin(uTime * 0.19 + fi * 1.7)) * (1.45 - 0.18 * fi);
    energy[i] = SHARPNESS * dot(d, d) / size;
    lowest = min(lowest, energy[i]);
  }
  /* 權重以最近的色塊為基準（exp 不會下溢成 0） */
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < ${MESH_SIZE}; i++) {
    float w = exp(lowest - energy[i]);
    sum += uColors[i] * w;
    total += w;
  }
  vec3 color = sum / total;
  /* 緩慢移動的明暗，增加層次 */
  color *= 0.94 + 0.08 * sin(p.x * 2.3 + uTime * 0.21) * cos(p.y * 1.9 - uTime * 0.17);
  gl_FragColor = vec4(pow(color, vec3(${(1 / GAMMA).toFixed(6)})), 1.0);
}`;

interface GlState {
  gl: WebGLRenderingContext;
  uniforms: { colors: WebGLUniformLocation | null; time: WebGLUniformLocation | null; aspect: WebGLUniformLocation | null };
}

/** 能不能建立 WebGL（「自動」品質用來決定起始等級）。 */
export function webglAvailable(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * 播放頁的背景：高、中品質用 WebGL 畫流動的封面色彩，低品質（或 WebGL 不可用）是 CSS 畫的靜態色塊。
 * 另外依背景亮度調整遮罩濃度、提供陰影用的顏色。
 */
export class BackgroundRenderer {
  private readonly canvas = document.createElement('canvas');
  private readonly staticLayer = document.createElement('div');
  private glState: GlState | null = null;
  private mode: 'animated' | 'static' = 'static';
  private fps = 60;
  private lastRender = -Infinity;
  private readonly epoch = performance.now();
  /** 換封面時從 from 漸變到 to */
  private from: Rgb[] = NEUTRAL_PALETTE.mesh;
  private to: Rgb[] = NEUTRAL_PALETTE.mesh;
  private transitionStart = -Infinity;

  constructor(private readonly root: HTMLElement) {
    this.canvas.className = 'bg-canvas';
    this.staticLayer.className = 'bg-static';
    root.prepend(this.canvas, this.staticLayer);
    new ResizeObserver(() => this.resize()).observe(root);
    this.applyPalette(NEUTRAL_PALETTE);
  }

  setQuality(profile: QualityProfile): void {
    this.fps = profile.backgroundFps;
    const wanted = profile.background === 'animated' && this.ensureGl() ? 'animated' : 'static';
    if (wanted === this.mode) return;
    this.mode = wanted;
    this.root.dataset.background = wanted;
    if (wanted === 'animated') {
      this.resize();
      this.lastRender = -Infinity;
    }
  }

  setArtwork(artwork: Artwork | null): void {
    const palette = artwork?.palette ?? NEUTRAL_PALETTE;
    const now = performance.now();
    this.from = this.colorsAt(now);
    this.to = palette.mesh;
    this.transitionStart = now;
    this.lastRender = -Infinity;
    this.applyPalette(palette);
  }

  /** 由主迴圈每個影格呼叫；依品質設定的更新率決定要不要重畫。 */
  render(now: number): void {
    if (this.mode !== 'animated' || !this.glState) return;
    if (now - this.lastRender < 1000 / Math.max(1, this.fps) - 2) return;
    this.lastRender = now;
    const { gl, uniforms } = this.glState;
    const linear = (channel: number) => (channel / 255) ** GAMMA;
    const flat = new Float32Array(this.colorsAt(now).flatMap((c) => [linear(c.r), linear(c.g), linear(c.b)]));
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform3fv(uniforms.colors, flat);
    gl.uniform1f(uniforms.time, ((now - this.epoch) / 1000) * FLOW_SPEED);
    gl.uniform1f(uniforms.aspect, this.canvas.width / Math.max(1, this.canvas.height));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** 目前（可能正在漸變中）的背景色 */
  private colorsAt(now: number): Rgb[] {
    const t = Math.min(1, Math.max(0, (now - this.transitionStart) / CROSSFADE_MS));
    const eased = t * t * (3 - 2 * t);
    return this.to.map((to, i) => mixRgb(this.from[i] ?? to, to, eased));
  }

  /** 遮罩濃度、陰影色，以及低品質靜態背景用的 CSS 顏色（CSS 那邊有過渡動畫） */
  private applyPalette(palette: Palette): void {
    const style = document.documentElement.style;
    style.setProperty('--scrim', scrimOpacity(palette.luminance).toFixed(3));
    style.setProperty('--art-shadow', rgbChannels(shade(palette.vibrant, 0.32)));
    style.setProperty('--art-average', rgbChannels(palette.average));
    palette.mesh.forEach((color, i) => style.setProperty(`--mesh-${i + 1}`, `rgb(${rgbChannels(color)})`));
    style.setProperty('--mesh-base', `rgb(${rgbChannels(shade(palette.mesh[0], BASE_SHADE))})`);
  }

  private resize(): void {
    const width = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.round(this.root.clientWidth * RESOLUTION_SCALE)));
    const height = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.round(this.root.clientHeight * RESOLUTION_SCALE)));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.lastRender = -Infinity;
    }
  }

  private ensureGl(): boolean {
    if (this.glState) return true;
    const gl = this.canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
    if (!gl) return false;
    const program = createProgram(gl);
    if (!program) return false;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    this.glState = {
      gl,
      uniforms: { colors: uniform('uColors'), time: uniform('uTime'), aspect: uniform('uAspect') },
    };
    // 顯示卡驅動重置等情況會失去 WebGL：改用靜態背景，不再嘗試
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.glState = null;
      this.mode = 'static';
      this.root.dataset.background = 'static';
    });
    return true;
  }
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('背景著色器編譯失敗', gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('背景著色器連結失敗', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}
