import { joinWords, tidyWords, type BackgroundVocal, type LyricLine, type LyricWord } from './model';

const TTM_NS = 'http://www.w3.org/ns/ttml#metadata';
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
/** <p> 沒有 end 也沒有逐字時間時，預設顯示多久 */
const FALLBACK_LINE_MS = 5000;

/**
 * TTML 的時間：`mm:ss.mmm`、`hh:mm:ss.mmm`、`ss.mmm`，或 `12.5s`、`350ms` 這種帶單位的寫法。
 * 格式不對回傳 null。
 */
export function parseTtmlTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  const unit = /^(\d+(?:\.\d+)?)(h|m|s|ms)$/.exec(v);
  if (unit) {
    const n = Number(unit[1]);
    const scale = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 }[unit[2] as 'h' | 'm' | 's' | 'ms'];
    return Math.round(n * scale);
  }
  const parts = v.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(?:\.\d+)?$/.test(p))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return Math.round(seconds * 1000);
}

function ttmAttr(el: Element, name: 'role' | 'agent'): string | null {
  return el.getAttributeNS(TTM_NS, name) || el.getAttribute(`ttm:${name}`);
}

/**
 * 解析 Apple Music／AMLL 格式的 TTML。
 * 每個 <p> 是一行，裡面帶 begin/end 的 <span> 是一個字（或音節）；
 * ttm:role 標記背景人聲（x-bg）、翻譯（x-translation）、羅馬拼音（x-roman）；
 * ttm:agent 不是第一位歌手（也不是合唱）的行，視為對唱、靠右顯示。
 */
export function parseTtml(xml: string): LyricLine[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('TTML 格式錯誤');

  // 用命名空間找才不受前綴影響；有些 DOM 實作（例如測試用的 happy-dom）只認得「ttm:agent」這個名稱
  const byNamespace = Array.from(doc.getElementsByTagNameNS(TTM_NS, 'agent'));
  const agents = byNamespace.length ? byNamespace : Array.from(doc.getElementsByTagName('ttm:agent'));
  const mainAgent = agents[0]?.getAttribute('xml:id') ?? null;
  const groupAgents = new Set(
    agents.filter((a) => a.getAttribute('type') === 'group').map((a) => a.getAttribute('xml:id') ?? ''),
  );

  const lines: LyricLine[] = [];
  for (const p of Array.from(doc.getElementsByTagName('p'))) {
    const line = parseParagraph(p);
    if (!line) continue;
    const agent = ttmAttr(p, 'agent');
    if (agent && mainAgent && agent !== mainAgent && !groupAgents.has(agent)) line.alignEnd = true;
    lines.push(line);
  }
  return lines.sort((a, b) => a.startMs - b.startMs);
}

/** 把一個元素底下的字收集起來；字和字之間的空白併到前一個字。 */
function collectWords(parent: Element, onRole?: (role: string, el: Element) => void): { words: LyricWord[]; plain: string } {
  const words: LyricWord[] = [];
  let plain = '';
  let leading = '';
  const appendText = (text: string) => {
    plain += text;
    const last = words[words.length - 1];
    if (last) last.text += text;
    else leading += text;
  };

  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      appendText(node.textContent ?? '');
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;
    const el = node as Element;
    const role = ttmAttr(el, 'role');
    if (role) {
      onRole?.(role, el);
      continue;
    }
    const startMs = parseTtmlTime(el.getAttribute('begin'));
    const endMs = parseTtmlTime(el.getAttribute('end'));
    const text = el.textContent ?? '';
    if (startMs === null || endMs === null) {
      appendText(text);
      continue;
    }
    plain += text;
    words.push({ text: words.length === 0 ? leading + text : text, startMs, endMs });
  }
  return { words: tidyWords(words), plain: plain.trim() };
}

function parseParagraph(p: Element): LyricLine | null {
  const startMs = parseTtmlTime(p.getAttribute('begin'));
  if (startMs === null) return null;

  let translation: string | undefined;
  let romanization: string | undefined;
  let background: BackgroundVocal | undefined;
  const { words, plain } = collectWords(p, (role, el) => {
    const text = el.textContent?.trim();
    if (role === 'x-translation' && text) translation ??= text;
    else if (role === 'x-roman' && text) romanization ??= text;
    else if (role === 'x-bg') background = parseBackground(el) ?? background;
  });

  const text = words.length ? joinWords(words) : plain;
  if (!text && !background) return null;
  const endMs =
    parseTtmlTime(p.getAttribute('end')) ?? words[words.length - 1]?.endMs ?? startMs + FALLBACK_LINE_MS;

  const line: LyricLine = { startMs, endMs, text };
  if (words.length) line.words = words;
  if (background) line.background = background;
  if (translation) line.translation = translation;
  if (romanization) line.romanization = romanization;
  return line;
}

/** 背景人聲：去掉包住整段的括號，顯示時用比較小的字。 */
function parseBackground(el: Element): BackgroundVocal | undefined {
  const { words, plain } = collectWords(el);
  if (words.length) {
    const first = words[0];
    const last = words[words.length - 1];
    if (/^\s*[(（]/.test(first.text) && /[)）]\s*$/.test(last.text)) {
      words[0] = { ...first, text: first.text.replace(/^(\s*)[(（]/, '$1') };
      const lastIndex = words.length - 1;
      words[lastIndex] = { ...words[lastIndex], text: words[lastIndex].text.replace(/[)）](\s*)$/, '$1') };
    }
  }
  const tidy = tidyWords(words);
  const text = tidy.length ? joinWords(tidy) : plain.replace(/^[(（]([\s\S]*)[)）]$/, '$1').trim();
  if (!text) return undefined;
  const startMs = parseTtmlTime(el.getAttribute('begin')) ?? tidy[0]?.startMs ?? 0;
  const endMs = parseTtmlTime(el.getAttribute('end')) ?? tidy[tidy.length - 1]?.endMs ?? startMs;
  return tidy.length ? { text, startMs, endMs, words: tidy } : { text, startMs, endMs };
}
