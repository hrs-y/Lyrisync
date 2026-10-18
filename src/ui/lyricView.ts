import { t } from '../i18n';
import { isJapanese } from '../lyrics/chinese';
import { findLineIndex, type LyricLine, type LyricWord, type Lyrics } from '../lyrics/model';
import type { LyricEffect } from '../settings';
import { LANG_ATTRIBUTE, lineLanguage } from './fonts';
import { QUALITY_PROFILES, type QualityProfile } from './quality';
import { Spring } from './spring';
import { synthesizeWords } from './writing';

export type LyricViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'message'; text: string }
  | { kind: 'instrumental' }
  | { kind: 'lyrics'; lyrics: Lyrics };

/** 歌詞最後的來源說明 */
export interface LyricFooter {
  /** 例如「網易雲音樂（逐字）」 */
  source: string;
  /** 目前是第幾份、共幾份；只有一份時不顯示切換按鈕 */
  version?: { index: number; count: number };
}

/** 目前這一行停在可視高度的哪個位置（0 是頂端） */
const FOCUS_RATIO = 0.36;
/** 書寫效果時，目前這一行寫在畫面中間，上面是已經寫好的行 */
const WRITING_FOCUS_RATIO = 0.5;
/** 書寫效果：剛寫下的字從微微模糊、稍低的位置落定所花的時間 */
const INK_MS = 420;
/** 書寫效果：沒有逐字時間的翻譯、羅馬拼音依這一行的長度寫出來，但不短於、不長於這個範圍 */
const WRITE_PLAIN_MIN_MS = 500;
const WRITE_PLAIN_MAX_MS = 2400;
/** 捲動比歌聲早一點開始，新的一行開唱時已經就定位 */
const SCROLL_LEAD_MS = 250;
/** 和下一行的空檔小於這個值，這一行就一直亮到下一行開始；更長的空檔顯示間奏點點 */
const HOLD_GAP_MS = 4000;
/** 間奏點點在下一行開始前多久退場 */
const INTERLUDE_EXIT_MS = 400;
/** 行熄滅後保留逐字遮罩的時間，等淡出動畫做完 */
const FADE_OUT_MS = 700;
/** 唱超過這個長度的字會發光 */
const LONG_WORD_MS = 1000;
/** 整句被當成一個「字」時不發光 */
const LONG_WORD_MAX_CHARS = 8;
/** 字的上浮至少花這麼久：短字也不會猛然跳起，前後幾個字連成一道平順的波浪 */
const LIFT_MIN_MS = 650;
/** 長音逐字母浮起的波：寬度（佔整個字的比例）至少這麼寬，鄰近的字母會一起被微微帶起 */
const WAVE_MIN_WIDTH = 0.16;
/** 長音開頭與結尾各用多少比例的時間讓波浪淡入淡出，字母不會一開唱就跳起來 */
const WAVE_EDGE = 0.12;
/** 手動捲動後多久回到自動跟隨 */
const BROWSE_TIMEOUT_MS = 3000;
/** 換行時，下面每一行比上一行晚多久開始移動 */
const STAGGER_MS = 42;
const MAX_STAGGER_MS = 420;
/** 焦點一次跳超過這麼多項（例如跳轉）就整塊一起移動，不做錯落 */
const BIG_JUMP_ITEMS = 3;
/** 每遠離目前那一行一項，多模糊多少 */
const BLUR_STEP_PX = 0.85;
const MAX_BLUR_PX = 3.2;
/** 間奏點點呼吸一次的時間 */
const BREATH_PERIOD_MS = 1800;
/** 中日文的字之間可以換行；其他文字（英文音節、韓文）要黏成一串，免得一個單字被拆到兩行 */
const BREAKABLE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

interface WordState {
  el: HTMLElement;
  startMs: number;
  endMs: number;
  /** 長音：會發光，高品質時逐字母浮起 */
  long: boolean;
  /** 逐字母浮起時，每個字母一個 span */
  chars: HTMLElement[];
  /** 已經寫進 CSS 變數的值（--p、--lift、--glow、--ink、每個字母的 --bump）；-1 代表還沒寫過 */
  fill: number;
  lift: number;
  glow: number;
  ink: number;
  bumps: number[];
}

interface ItemState {
  kind: 'line' | 'interlude' | 'footer';
  el: HTMLElement;
  /** 對應 lyrics.lines 的索引；間奏與來源說明是 -1 */
  lineIndex: number;
  startMs: number;
  /** 這一項亮到什麼時候（行：含短空檔；間奏：點點退場的時間） */
  endMs: number;
  words: WordState[];
  dots: HTMLElement[];
  active: boolean;
  /** 書寫效果：還沒唱到、還沒寫出來的行 */
  unwritten: boolean;
  fadeTimer: ReturnType<typeof setTimeout> | null;
  spring: Spring;
  /** 新的捲動目標，以及從什麼時候開始追（做錯落效果） */
  pendingTarget: number;
  startAt: number;
  top: number;
  height: number;
  blur: number;
  /** 上次寫進 transform 的位置，避免重複寫 DOM */
  writtenY: number;
}

/**
 * Apple Music 式的歌詞畫面：
 * 唱到的字由左往右填亮並緩緩上浮，長音發光、逐字母浮起；
 * 每一行用彈簧物理各自移動，換行時下面的行錯開跟上，離目前的行越遠越模糊；
 * 間奏時三個點呼吸並隨進度亮起；最後一行之後是歌詞來源。點一行跳過去，滾輪可以暫時自己捲。
 * 「書寫」效果時，還沒唱到的行看不到，唱到的字才由左往右一個一個寫出來。
 */
export class LyricView {
  private readonly status = document.createElement('div');
  private readonly track = document.createElement('div');
  private readonly footer = document.createElement('div');
  private readonly footerText = document.createElement('span');
  private readonly footerSwitch = document.createElement('button');
  private readonly observer: ResizeObserver;
  private items: ItemState[] = [];
  private lyrics: Lyrics | null = null;
  private profile: QualityProfile = QUALITY_PROFILES.high;
  private effect: LyricEffect = 'fill';
  /** 日文歌：只有漢字的行也用日文字體 */
  private japanese = false;
  /** 使用者的景深模糊設定（動畫品質為高時才會真的模糊） */
  private blurEnabled = true;
  private blurStrength = 1;
  private focusIndex = -1;
  /** 手動捲動時整串歌詞的位移（捲動期間歌詞不會自己移動） */
  private browseY = 0;
  private browsing = false;
  private browseTimer: ReturnType<typeof setTimeout> | null = null;
  private needsMeasure = false;
  private needsSnap = false;
  private lastFrame = 0;

  constructor(
    private readonly root: HTMLElement,
    onSeek: (positionMs: number) => void,
    onSwitchVersion?: () => void,
  ) {
    root.classList.add('lyric-view');
    this.status.className = 'lyric-status';
    this.track.className = 'lyric-track';
    root.append(this.status, this.track);

    this.footer.className = 'item footer';
    this.footer.hidden = true;
    this.footerText.className = 'credit';
    this.footerSwitch.type = 'button';
    this.footerSwitch.className = 'text-button credit-switch';
    this.footerSwitch.title = t('lyrics.otherVersionTitle');
    this.footerSwitch.hidden = true;
    this.footerSwitch.addEventListener('click', () => onSwitchVersion?.());
    this.footer.append(this.footerText, this.footerSwitch);

    // 容器大小、文字折行、字型載入、翻譯開關、字級都會改變行高：一律在下個影格重新量
    this.observer = new ResizeObserver(() => {
      this.needsMeasure = true;
    });
    this.observer.observe(root);
    void document.fonts?.ready.then(() => {
      this.needsMeasure = true;
    });

    this.track.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('.item.line');
      if (!item || !this.lyrics?.synced) return;
      this.stopBrowsing();
      onSeek(this.lyrics.lines[Number(item.dataset.line)].startMs);
    });
    root.addEventListener('wheel', (event) => this.browse(event), { passive: false });

    this.setState({ kind: 'idle' });
  }

  /** 目前捲動焦點所在的歌詞行（除錯面板用）；間奏時回傳 -1 */
  get currentIndex(): number {
    return this.items[this.focusIndex]?.lineIndex ?? -1;
  }

  get hasTranslation(): boolean {
    return Boolean(this.lyrics?.lines.some((line) => line.translation));
  }

  get hasRomanization(): boolean {
    return Boolean(this.lyrics?.lines.some((line) => line.romanization));
  }

  setTranslationVisible(visible: boolean): void {
    this.root.classList.toggle('hide-translation', !visible);
  }

  setRomanizationVisible(visible: boolean): void {
    this.root.classList.toggle('hide-romanization', !visible);
  }

  /** 歌詞效果：fill 是整段先顯示、唱到的字亮起；write 是唱到才一個字一個字寫出來。 */
  setEffect(effect: LyricEffect): void {
    if (effect === this.effect) return;
    this.effect = effect;
    this.root.classList.toggle('writing', effect === 'write');
    // 只有逐行時間的行要拆成一個一個字（或改回整行），重新產生
    if (this.lyrics) this.setState({ kind: 'lyrics', lyrics: this.lyrics });
  }

  /** 書寫效果只用在有時間軸的歌詞上 */
  private get writing(): boolean {
    return this.effect === 'write' && Boolean(this.lyrics?.synced);
  }

  /** 歌詞最後的來源說明；有好幾份歌詞時附「換一份」按鈕。傳 null 隱藏。 */
  setFooter(footer: LyricFooter | null): void {
    this.footer.hidden = !footer;
    if (!footer) return;
    this.footerText.textContent = t('lyrics.credit', { source: footer.source });
    const version = footer.version;
    const switchable = version !== undefined && version.count > 1;
    this.footerSwitch.hidden = !switchable;
    if (switchable) this.footerSwitch.textContent = t('lyrics.otherVersion', { index: version.index + 1, count: version.count });
  }

  setQuality(profile: QualityProfile): void {
    const previous = this.profile;
    this.profile = profile;
    const classes = this.root.classList;
    classes.toggle('springs', profile.springs);
    classes.toggle('word-lift', profile.wordLift);
    classes.toggle('glow', profile.glow);
    classes.toggle('depth-blur', profile.depthBlur && this.blurEnabled);
    // 逐字母浮起要重新產生每個字母的 span；換捲動方式要清掉舊的位移
    if (this.lyrics && previous.letterEmphasis !== profile.letterEmphasis) {
      this.setState({ kind: 'lyrics', lyrics: this.lyrics });
      return;
    }
    if (previous.springs !== profile.springs) {
      for (const item of this.items) {
        item.el.style.transform = '';
        item.writtenY = NaN;
      }
      this.track.style.transform = '';
      this.needsSnap = true;
      this.needsMeasure = true;
    }
    this.applyBlur();
  }

  /** 景深模糊的開關與強度（設定頁「外觀」） */
  setBlur(enabled: boolean, strength: number): void {
    if (enabled === this.blurEnabled && strength === this.blurStrength) return;
    this.blurEnabled = enabled;
    this.blurStrength = strength;
    this.root.classList.toggle('depth-blur', this.profile.depthBlur && enabled);
    // 強度變了：每一行的模糊量都要重算
    for (const item of this.items) item.blur = -1;
    this.applyBlur();
  }

  setState(state: LyricViewState): void {
    for (const item of this.items) if (item.fadeTimer) clearTimeout(item.fadeTimer);
    this.stopBrowsing(false);
    this.observer.disconnect();
    this.observer.observe(this.root);
    this.lyrics = state.kind === 'lyrics' ? state.lyrics : null;
    this.items = [];
    this.focusIndex = -1;
    this.track.replaceChildren();
    this.track.style.transform = '';
    this.footer.style.transform = '';
    this.status.replaceChildren();
    this.root.dataset.state = state.kind === 'lyrics' ? (state.lyrics.synced ? 'synced' : 'unsynced') : state.kind;
    this.root.scrollTop = 0;

    if (state.kind === 'loading') {
      // 和歌詞同樣形狀的骨架，比轉圈圈更像「內容快來了」
      for (const width of [62, 84, 48, 73, 56]) {
        const bar = document.createElement('div');
        bar.className = 'skeleton-line';
        bar.style.width = `${width}%`;
        this.status.append(bar);
      }
      return;
    }
    if (state.kind === 'message') {
      const text = document.createElement('p');
      text.className = 'lyric-message';
      text.textContent = state.text;
      this.status.append(text);
      return;
    }
    if (state.kind === 'instrumental') {
      this.status.append(buildDots('instrumental-dots'));
      const text = document.createElement('p');
      text.className = 'lyric-message';
      text.textContent = t('lyrics.instrumental');
      this.status.append(text);
      return;
    }
    if (state.kind !== 'lyrics') return;

    const lyrics = state.lyrics;
    this.japanese = isJapanese(lyrics.lines);
    const lines = lyrics.synced ? this.buildItems(lyrics) : lyrics.lines.map((line, i) => this.buildLine(line, i, line.endMs));
    // 來源說明跟在最後一行後面一起捲動；永遠不會成為焦點
    this.items = [...lines, createItem('footer', this.footer, -1, Infinity, Infinity, [], [])];
    this.track.append(...this.items.map((item) => item.el));
    for (const item of this.items) this.observer.observe(item.el);
    this.needsMeasure = true;
    this.needsSnap = true;
    this.applyBlur();
  }

  /** 每個影格呼叫一次。 */
  update(timeMs: number, now = performance.now()): void {
    const dt = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16;
    this.lastFrame = now;
    if (!this.lyrics?.synced || !this.items.length) return;

    const writing = this.writing;
    for (const item of this.items) {
      const active = item.startMs <= timeMs && timeMs < item.endMs;
      if (active !== item.active) this.setActive(item, active, timeMs);
      else if (active) paintItem(item, timeMs, writing);
      if (writing && item.kind === 'line') {
        const unwritten = timeMs < item.startMs;
        if (unwritten !== item.unwritten) {
          item.unwritten = unwritten;
          item.el.classList.toggle('unwritten', unwritten);
        }
      }
    }

    const focus = Math.max(0, findLineIndex(this.items, timeMs + SCROLL_LEAD_MS));
    if (this.needsMeasure) this.measure();
    if (focus !== this.focusIndex) this.setFocus(focus, now);
    if (this.needsSnap) this.snapAll();
    if (this.profile.springs) this.stepSprings(dt, now);
  }

  private buildItems(lyrics: Lyrics): ItemState[] {
    const items: ItemState[] = [];
    const lines = lyrics.lines;
    // 前奏夠長也顯示點點
    if (lines[0] && lines[0].startMs >= HOLD_GAP_MS) items.push(this.buildInterlude(0, lines[0].startMs - INTERLUDE_EXIT_MS));
    lines.forEach((line, i) => {
      const end = lineEnd(line);
      const next = lines[i + 1];
      const gap = next ? next.startMs - end : 0;
      const holdEnd = next && gap > 0 && gap < HOLD_GAP_MS ? next.startMs : end;
      items.push(this.buildLine(line, i, holdEnd));
      if (next && gap >= HOLD_GAP_MS) items.push(this.buildInterlude(end, next.startMs - INTERLUDE_EXIT_MS));
    });
    return items;
  }

  private buildLine(line: LyricLine, index: number, endMs: number): ItemState {
    const el = document.createElement('div');
    el.className = 'item line';
    el.dataset.line = String(index);
    if (line.alignEnd) el.classList.add('duet');
    // 依語言用對應的字體（中文字型的假名、漢字字形和日文不同；英文歌可以另選字體）。
    // 中文行也明確標上，介面語言是英文或日文時才不會被當成那個語言
    el.lang = LANG_ATTRIBUTE[lineLanguage(line.text, this.japanese)];

    const inner = document.createElement('div');
    inner.className = 'line-inner';
    const words: WordState[] = [];
    const main = document.createElement('div');
    main.className = 'main';
    const writing = this.writing;
    // 書寫效果要一個字一個字出現：只有逐行時間的行依字數估計每個字的時間
    const timed = line.words?.length ? line.words : writing ? synthesizeWords(line.text, line.startMs, line.endMs) : [];
    if (timed.length) {
      this.appendWords(main, timed, words);
    } else {
      main.textContent = line.text;
      el.classList.add('no-words');
    }
    inner.append(main);

    // 羅馬拼音緊接在主歌詞下面；有逐字時間時也會填色，但不做長音的發光與逐字母浮起
    if (line.romanization) {
      const roma = document.createElement('div');
      roma.className = 'roma';
      if (line.romanizationWords?.length) {
        this.appendWords(roma, line.romanizationWords, words, false);
      } else {
        roma.textContent = line.romanization;
        roma.classList.add('plain');
      }
      inner.append(roma);
    }

    if (line.background) {
      const bg = document.createElement('div');
      bg.className = 'bg';
      if (line.background.words?.length) {
        this.appendWords(bg, line.background.words, words);
      } else {
        bg.textContent = line.background.text;
        bg.classList.add('plain');
      }
      inner.append(bg);
    }
    if (line.translation) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = line.translation;
      inner.append(sub);
    }
    el.append(inner);
    const item = createItem('line', el, index, line.startMs, endMs, words, []);
    if (writing) {
      // 沒有逐字時間的部分（翻譯、羅馬拼音）依這一行的長度寫出來
      const plainMs = Math.min(WRITE_PLAIN_MAX_MS, Math.max(WRITE_PLAIN_MIN_MS, (line.endMs - line.startMs) * 0.7));
      el.style.setProperty('--write-ms', `${Math.round(plainMs)}ms`);
      item.unwritten = true;
      el.classList.add('unwritten');
    }
    return item;
  }

  private buildInterlude(startMs: number, endMs: number): ItemState {
    const el = document.createElement('div');
    el.className = 'item interlude';
    el.setAttribute('aria-hidden', 'true');
    const dots = buildDots('dots');
    el.append(dots);
    return createItem('interlude', el, -1, startMs, Math.max(startMs, endMs), [], Array.from(dots.children) as HTMLElement[]);
  }

  /**
   * 每個字一個 span.w（inline-block 才能做位移和遮罩）。字前後的空白拆成文字節點，
   * 否則 inline-block 會把空白吃掉、單字黏在一起。emphasis 為 false 時不做長音效果（羅馬拼音用）。
   */
  private appendWords(container: HTMLElement, words: readonly LyricWord[], out: WordState[], emphasis = true): void {
    // 中間不能換行的一串字（例如英文單字的幾個音節）
    let run: HTMLElement | null = null;
    for (const word of words) {
      const [, leading, core, trailing] = /^(\s*)([\s\S]*?)(\s*)$/.exec(word.text)!;
      if (leading) {
        container.append(leading);
        run = null;
      }
      if (core) {
        const span = document.createElement('span');
        span.className = 'w';
        const letters = [...core];
        const long = emphasis && word.endMs - word.startMs >= LONG_WORD_MS && letters.length <= LONG_WORD_MAX_CHARS;
        const chars: HTMLElement[] = [];
        if (long) span.classList.add('long');
        if (long && this.profile.letterEmphasis) {
          span.classList.add('letters');
          for (const letter of letters) {
            const ch = document.createElement('span');
            ch.className = 'ch';
            ch.textContent = letter;
            span.append(ch);
            chars.push(ch);
          }
        } else {
          span.textContent = core;
        }
        if (BREAKABLE.test(core)) {
          container.append(span);
          run = null;
        } else {
          if (!run) {
            run = document.createElement('span');
            run.className = 'run';
            container.append(run);
          }
          run.append(span);
        }
        out.push({
          el: span,
          startMs: word.startMs,
          endMs: word.endMs,
          long,
          chars,
          fill: -1,
          lift: -1,
          glow: -1,
          ink: -1,
          bumps: chars.map(() => -1),
        });
      }
      if (trailing) {
        container.append(trailing);
        run = null;
      }
    }
  }

  private setActive(item: ItemState, active: boolean, timeMs: number): void {
    item.active = active;
    item.el.classList.toggle('active', active);
    if (item.fadeTimer) clearTimeout(item.fadeTimer);
    item.fadeTimer = null;
    if (active) {
      item.el.classList.add('masked');
    } else {
      item.fadeTimer = setTimeout(() => {
        item.el.classList.remove('masked');
        item.fadeTimer = null;
      }, FADE_OUT_MS);
    }
    // 剛亮起或剛熄滅時把每個字更新到正確進度（例如往回跳轉後要變回沒唱過）
    paintItem(item, timeMs, this.writing);
    this.applyBlur();
  }

  private measure(): void {
    this.needsMeasure = false;
    for (const item of this.items) {
      item.top = item.el.offsetTop;
      item.height = item.el.offsetHeight;
    }
    this.retarget(performance.now(), false);
  }

  private setFocus(focus: number, now: number): void {
    const previous = this.focusIndex;
    this.focusIndex = focus;
    const jump = previous < 0 || Math.abs(focus - previous) > BIG_JUMP_ITEMS;
    this.retarget(now, this.profile.stagger && !jump && !this.browsing);
    this.applyBlur();
  }

  /** 目前這一行停在可視高度哪裡 */
  private get focusRatio(): number {
    return this.writing ? WRITING_FOCUS_RATIO : FOCUS_RATIO;
  }

  /** 自動跟隨時的捲動位移：目前這一行停在 focusRatio 的位置 */
  private followTarget(): number {
    const focus = this.items[Math.max(0, this.focusIndex)];
    return Math.round(this.root.clientHeight * this.focusRatio - (focus.top + focus.height / 2));
  }

  /** 手動捲動的範圍：第一項最低捲到焦點位置，最後一項（來源說明）最高捲到焦點位置，不會捲到一片空白 */
  private clampBrowse(y: number): number {
    const first = this.items[0];
    const last = this.items[this.items.length - 1];
    const focusY = this.root.clientHeight * this.focusRatio;
    return clampScroll(y, focusY - (first.top + first.height / 2), focusY - (last.top + last.height / 2));
  }

  /** 依焦點算出捲動目標；彈簧模式下每一項各自追，錯落時下面的行晚一點出發。 */
  private retarget(now: number, stagger: boolean): void {
    if (!this.items.length) return;
    const target = this.browsing ? this.clampBrowse(this.browseY) : this.followTarget();
    if (!this.profile.springs) {
      this.track.style.transform = `translate3d(0, ${target}px, 0)`;
      return;
    }
    const anchor = this.focusIndex - 1;
    this.items.forEach((item, i) => {
      item.pendingTarget = target;
      item.startAt = stagger && i > anchor ? now + Math.min((i - anchor) * STAGGER_MS, MAX_STAGGER_MS) : now;
    });
  }

  /** 剛換歌詞或換捲動方式：直接放到定位，不要從頂端滑下來。 */
  private snapAll(): void {
    this.needsSnap = false;
    if (!this.profile.springs) {
      this.track.classList.add('instant');
      requestAnimationFrame(() => this.track.classList.remove('instant'));
      return;
    }
    for (const item of this.items) {
      item.spring.snap(item.pendingTarget);
      writeY(item, item.pendingTarget);
    }
  }

  private stepSprings(dt: number, now: number): void {
    for (const item of this.items) {
      if (now >= item.startAt) item.spring.target = item.pendingTarget;
      if (item.spring.settled) {
        // 停穩時對齊整數像素，文字才不會糊
        if (item.writtenY !== item.spring.target) {
          item.spring.snap(item.spring.target);
          writeY(item, item.spring.target);
        }
        continue;
      }
      item.spring.step(dt);
      writeY(item, item.spring.value);
    }
  }

  /** 離目前的行越遠越模糊；亮著的行、來源說明、手動捲動時都不模糊。 */
  private applyBlur(): void {
    const enabled = this.profile.depthBlur && this.blurEnabled && !this.browsing && this.lyrics?.synced;
    this.items.forEach((item, i) => {
      const distance = Math.abs(i - this.focusIndex);
      const blurred = enabled && !item.active && item.kind !== 'footer' && this.focusIndex >= 0;
      const raw = blurred ? Math.min(MAX_BLUR_PX, distance * BLUR_STEP_PX) * this.blurStrength : 0;
      const blur = Math.round(raw * 100) / 100;
      if (blur === item.blur) return;
      item.blur = blur;
      item.el.style.setProperty('--blur', `${blur}px`);
    });
  }

  /** 滾輪暫時自己捲（範圍限制在歌詞的頭尾之間），停手幾秒後回到目前的行。 */
  private browse(event: WheelEvent): void {
    if (!this.lyrics?.synced || !this.items.length) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? this.root.clientHeight : 1;
    if (!this.browsing) {
      // 從目前的位置開始捲；捲動期間歌詞不會自己移動
      this.browseY = this.followTarget();
      this.browsing = true;
      this.root.classList.add('browsing');
      this.applyBlur();
    }
    this.browseY = this.clampBrowse(this.browseY - event.deltaY * unit);
    this.retarget(performance.now(), false);
    if (this.browseTimer) clearTimeout(this.browseTimer);
    this.browseTimer = setTimeout(() => this.stopBrowsing(), BROWSE_TIMEOUT_MS);
  }

  private stopBrowsing(apply = true): void {
    if (this.browseTimer) clearTimeout(this.browseTimer);
    this.browseTimer = null;
    const wasBrowsing = this.browsing;
    this.browsing = false;
    this.root.classList.remove('browsing');
    if (apply && wasBrowsing) {
      this.retarget(performance.now(), false);
      this.applyBlur();
    }
  }
}

function createItem(
  kind: ItemState['kind'],
  el: HTMLElement,
  lineIndex: number,
  startMs: number,
  endMs: number,
  words: WordState[],
  dots: HTMLElement[],
): ItemState {
  return {
    kind,
    el,
    lineIndex,
    startMs,
    endMs,
    words,
    dots,
    active: false,
    unwritten: false,
    fadeTimer: null,
    spring: new Spring(0),
    pendingTarget: 0,
    startAt: 0,
    top: 0,
    height: 0,
    blur: 0,
    writtenY: NaN,
  };
}

function buildDots(className: string): HTMLElement {
  const dots = document.createElement('div');
  dots.className = className;
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dots.append(dot);
  }
  return dots;
}

function lineEnd(line: LyricLine): number {
  return Math.max(line.endMs, line.background?.endMs ?? 0);
}

/** 把捲動位移限制在 lowest 到 highest 之間；內容比畫面短、lowest 比 highest 大時以 highest 為準 */
export function clampScroll(y: number, highest: number, lowest: number): number {
  return Math.round(Math.max(Math.min(lowest, highest), Math.min(highest, y)));
}

function writeY(item: ItemState, y: number): void {
  const rounded = Math.round(y * 100) / 100;
  if (rounded === item.writtenY) return;
  item.writtenY = rounded;
  item.el.style.transform = `translate3d(0, ${rounded}px, 0)`;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** 緩起緩停：開始和結束的速度都是 0，不會有突然起步或急停的頓挫感 */
const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** 寫入 CSS 變數（取到小數第三位）；和上次寫的一樣就不碰 DOM。回傳這次的值。 */
function writeVar(el: HTMLElement, name: string, value: number, previous: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded !== previous) el.style.setProperty(name, String(rounded));
  return rounded;
}

function paintItem(item: ItemState, timeMs: number, writing: boolean): void {
  if (item.kind === 'interlude') paintDots(item, timeMs);
  else if (item.kind === 'line') paintWords(item, timeMs, writing);
}

/**
 * 每個字寫入兩個進度：--p 是填色的位置（跟著歌聲等速前進），--lift 是上浮的高度。
 * 上浮另外用緩起緩停的曲線、而且至少花 LIFT_MIN_MS，短字也是平順地浮起，不會一個一個彈上去。
 * 長音另外寫入 --glow 與每個字母的 --bump；書寫效果另外寫入墨跡落定的進度 --ink。
 */
function paintWords(item: ItemState, timeMs: number, writing: boolean): void {
  for (const word of item.words) {
    const duration = word.endMs - word.startMs;
    const elapsed = timeMs - word.startMs;
    const fill = duration > 0 ? clamp01(elapsed / duration) : elapsed >= 0 ? 1 : 0;
    word.fill = writeVar(word.el, '--p', fill, word.fill);
    word.lift = writeVar(word.el, '--lift', smoothstep(clamp01(elapsed / Math.max(duration, LIFT_MIN_MS))), word.lift);
    if (writing) word.ink = writeVar(word.el, '--ink', smoothstep(clamp01(elapsed / INK_MS)), word.ink);
    if (!word.long) continue;
    word.glow = writeVar(word.el, '--glow', Math.sin(Math.PI * fill), word.glow);
    paintLetters(word, fill);
  }
}

/** 長音逐字母浮起：一道平滑的波從第一個字母走到最後一個，被唱到的字母隆起，鄰近的字母一起被微微帶起。 */
function paintLetters(word: WordState, fill: number): void {
  const n = word.chars.length;
  if (!n) return;
  const width = Math.max(1.1 / n, WAVE_MIN_WIDTH);
  const envelope = smoothstep(clamp01(fill / WAVE_EDGE)) * (1 - smoothstep(clamp01((fill - (1 - WAVE_EDGE)) / WAVE_EDGE)));
  word.chars.forEach((ch, k) => {
    const d = (fill - (k + 0.5) / n) / width;
    word.bumps[k] = writeVar(ch, '--bump', Math.exp(-0.5 * d * d) * envelope, word.bumps[k]);
  });
}

/** 間奏點點：三個點依進度逐一亮起，整組緩慢呼吸。 */
function paintDots(item: ItemState, timeMs: number): void {
  const span = item.endMs - item.startMs;
  const progress = span > 0 ? clamp01((timeMs - item.startMs) / span) : 1;
  item.dots.forEach((dot, k) => dot.style.setProperty('--fill', clamp01(progress * 3 - k).toFixed(3)));
  const breath = 0.5 + 0.5 * Math.sin((timeMs / BREATH_PERIOD_MS) * 2 * Math.PI);
  item.el.style.setProperty('--breath', breath.toFixed(3));
}
