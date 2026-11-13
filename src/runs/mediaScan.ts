// The media scan (ROUGHBOOK-MEDIA-PLAN.md, V0): given a sketch's files, the media it uses, each
// with the lines that show it and how sure the scan is. It is pure and free. `media-eval` measures
// it against the owner's labels, and V2's avoid check is built on it.
//
// A copy of the backend's utils/rules/mediaScan.ts for the look-screen check (lookScreen.ts, V2
// and V3), with the look's own file names it imports; a change to one belongs in both.
//
// What it reads:
// - 3D: `preserve-3d`, perspective, `rotateX(`/`rotateY(` other than 0, `rotate3d(`, three or
//   model-viewer.
// - Video: a `<video>`, a .mp4 or .webm source, a video player's embed.
// - Motion graphics: an animation that runs at rest, unasked: one that loops, one longer than
//   300 ms on an element shown on load, or a Web Animations call outside an event handler.
//   Motion started by the way in (a list's rows entering once, within 600 ms, among it), hover
//   and focus transitions, a loading spinner and the 300 ms entrance the first-screen rules allow
//   are not Motion graphics (decisions 2 and 3).
// - SVG diagrams and Illustration: an inline `<svg>` that is not an icon (small, small inside a
//   button or link, or drawn on an icon's grid), by decision 7's line: a
//   drawing that carries labelled information (text, or lines as connectors, axes or a route) is
//   an SVG diagram, and one without is an illustration. The render worker's measured boxes
//   (`svgBoxes.ts`) decide when given; the files alone give only a 'low' reading, unless the
//   look-screen check asks for a sure reading of a drawing that carries its own <text> (V2).
// - Product UI: a frame drawn as an app window or device, or a sidebar-and-panel app layout, or
//   the product's screen written as HTML: a titled table of its records with a control or status
//   of its own, at rest and away from the way in (reports/Media baseline.md, coverwell). Nothing read a product screen before, and
//   a table's meaning is not in its markup, so it is always 'low'.
// - Photography: raster files and photo addresses, read as the look-screen check's
//   PICTURE_NOT_ALLOWED reads them (`pictureUses`, `isPhoto`).
import type { SvgBox, SvgBoxes } from './svgBoxes.js';

/** The look's own files on the web, written for the model, which the scan never reads. */
const LOOK_CSS = 'look.css';
const LOOK_WORDS = 'look.ts';

export type ScannedMedium =
  | 'Product UI'
  | 'Photography'
  | 'Illustration'
  | 'SVG diagrams'
  | '3D'
  | 'Video'
  | 'Motion graphics';

/**
 * A line that shows a medium, 1-based. A measured box is cited as `rendered 1280px` or
 * `rendered 390px`, with its place among the page's inline SVGs (from 1) as its line.
 */
export type MediaEvidence = { file: string; line: number; text: string };

export type MediaUse = {
  medium: ScannedMedium;
  confidence: 'high' | 'low';
  evidence: MediaEvidence[];
};

export type MediaScanOptions = {
  /**
   * Read an inline `<svg>` in the files as an SVG diagram 'high' when it carries labelled
   * information the files show for certain: `<text>` inside the <svg> itself, written out rather
   * than composed from expressions or components, in a drawing larger than a control's icon by its
   * viewBox or its own size, and outside the header, the nav and any link (where a large svg is a
   * wordmark or logo). Every other drawing read from the files stays 'low', an illustration
   * included: V0 validated the scan only with the render's measured boxes, so a file-only reading
   * of shapes never blocks until media-eval measures it. The look-screen check asks for it
   * (ROUGHBOOK-MEDIA-PLAN.md, V2), since it runs before the render measures anything.
   */
  sureFromFiles?: boolean;
};

/** At most this many lines are kept as a medium's evidence. */
const MAX_EVIDENCE = 6;
/** An evidence line is cut to this many characters. */
const LINE_CHARS = 140;
/** The longest entrance the first-screen rules allow (`STATE_AND_MOTION_RULES`). */
const ENTRANCE_MS = 300;
/** A rendered svg this small on both sides is an icon. */
const ICON_PX = 48;
/** A viewBox this small on its longer side is an icon's grid (16, 20, 24, 32). */
const ICON_GRID = 32;
/** An svg inside a button or link this small on both sides is the control's icon. */
const CONTROL_ICON_PX = 96;
/** The longest entrance of a list's rows, run once, that is the way in's own animation. */
const ROW_ENTRANCE_MS = 600;
/** A drawing this many times longer than it is wide is a line: a rule, a connector or a route. */
const STRIP_RATIO = 8;
/** A rendered line shorter than this is an ornament, not a route. */
const ROUTE_PX = 120;

const CODE = /\.(?:tsx|jsx|ts|js|mjs|html?)$/i;
const CSS = /\.css$/i;
/** The files a picture can be named in, as the look-screen check reads them. */
const STYLED = /\.(?:tsx|jsx|ts|js|mjs|css|html)$/i;

// ---------------------------------------------------------------------------------------------
// Pictures. Moved here from compile/lookScreen.ts so the scan and PICTURE_NOT_ALLOWED read
// pictures the same way; lookScreen.ts imports them from here.

/** A tag's attributes, stepping over {expressions} two levels deep, as the craft floor reads them. */
const ATTRS = String.raw`(?:[^>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*`;
const IMG = new RegExp(String.raw`<img\b(${ATTRS})>`, 'g');
const SRC = /\bsrc\s*=\s*(?:(["'])(.*?)\1|\{\s*(["'`])(.*?)\3\s*\})/;
const CSS_URL = /url\(\s*(["']?)([^"')]*)\1\s*\)/g;
/** A string that is a picture's address: a project file, a photo service, or a raster file. */
const PICTURE_STRING =
  /(["'`])((?:https?:)?\/\/(?:images\.unsplash\.com|unsplash\.com|images\.pexels\.com|picsum\.photos|placehold\.co|via\.placeholder\.com|loremflickr\.com|source\.unsplash\.com)\/[^"'`\s]*|\/api\/files\/[^"'`\s]+|(?:https?:)?\/\/[^"'`\s]+\.(?:jpe?g|png|webp|gif|avif)(?:\?[^"'`\s]*)?)\1/gi;
const RASTER = /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)|^data:image\/(?:png|jpe?g|webp|gif|avif)/i;
const SVG_PICTURE = /^data:image\/svg\+xml|\.svg(?:[?#]|$)/i;
const PHOTO_PLACE = /^\/api\/files\/|^(?:https?:)?\/\//i;
/** Addresses that are fonts or styles, never pictures. */
const NOT_PICTURE = /\.(?:woff2?|ttf|otf|eot|css)(?:[?#]|$)|fonts\.(?:googleapis|gstatic)\.com/i;

export type PictureUse = { file: string; src: string; img: boolean };

/** Every picture the files point at: <img> sources, CSS url()s, and picture addresses in strings. */
export function pictureUses(own: [string, string][]): PictureUse[] {
  const uses: PictureUse[] = [];
  for (const [file, text] of own) {
    for (const [, attrs] of text.matchAll(IMG)) {
      const src = SRC.exec(attrs ?? '');
      const value = src ? (src[2] ?? src[4] ?? '') : '';
      if (value && !value.includes('${')) uses.push({ file, src: value.trim(), img: true });
    }
    for (const [, , value] of text.matchAll(CSS_URL)) {
      if (value?.trim()) uses.push({ file, src: value.trim(), img: false });
    }
    for (const [, , value] of text.matchAll(PICTURE_STRING)) {
      if (value) uses.push({ file, src: value, img: false });
    }
  }
  return uses;
}

/** A use that is a picture at all: not a #fragment, a font or a stylesheet. */
export function isPicture(use: PictureUse): boolean {
  return !use.src.startsWith('#') && !NOT_PICTURE.test(use.src);
}

/**
 * A picture that is a photo, whatever the stance: a raster file or a photo address, never an
 * SVG or a drawn data: URI. What PICTURE_NOT_ALLOWED refuses with type or illustration.
 */
export function isPhoto(use: PictureUse): boolean {
  return (
    isPicture(use) &&
    !SVG_PICTURE.test(use.src) &&
    (RASTER.test(use.src) || PHOTO_PLACE.test(use.src) || (use.img && !use.src.startsWith('data:')))
  );
}

// ---------------------------------------------------------------------------------------------
// Sources: each file with its comments blanked, so offsets and lines stay the file's own.

type Source = { file: string; raw: string; text: string; starts: number[]; css: boolean };

const blankOut = (match: string) => match.replace(/[^\n]/g, ' ');

function source(file: string, raw: string): Source {
  const css = CSS.test(file);
  let text = raw.replace(/(?<![\w"'`\\])\/\*[\s\S]*?\*\//g, blankOut);
  if (!css)
    text = text.replace(/(^|[\s;{}(),])(\/\/[^\n]*)/g, (_, lead, rest) => lead + blankOut(rest));
  if (/\.html?$/i.test(file)) text = text.replace(/<!--[\s\S]*?-->/g, blankOut);
  const starts = [0];
  for (let i = 0; i < raw.length; i++) if (raw[i] === '\n') starts.push(i + 1);
  return { file, raw, text, starts, css };
}

function lineOf(src: Source, offset: number): number {
  let low = 0;
  let high = src.starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (src.starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function cite(src: Source, offset: number): MediaEvidence {
  const line = lineOf(src, offset);
  const end = src.starts[line] ?? src.raw.length + 1;
  const text = src.raw.slice(src.starts[line - 1], end - 1).trim();
  return {
    file: src.file,
    line,
    text: text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS - 3)}...` : text
  };
}

/** The text of a balanced (…) or {…} that opens at `open`, or to the end. */
function balanced(text: string, open: number): string {
  const opener = text[open];
  const closer = opener === '(' ? ')' : '}';
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/** Where a tag that starts at `start` ends: its `>`, stepping over {expressions} and quotes. */
function tagEnd(text: string, start: number): number {
  let depth = 0;
  let quote = '';
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return text.length;
}

// ---------------------------------------------------------------------------------------------
// The scan's tally: one entry per medium, 'high' as soon as one reading is sure.

type Tally = Map<ScannedMedium, { confidence: 'high' | 'low'; evidence: MediaEvidence[] }>;

function add(
  tally: Tally,
  medium: ScannedMedium,
  confidence: 'high' | 'low',
  evidence: MediaEvidence[]
): void {
  const found = tally.get(medium) ?? { confidence, evidence: [] };
  if (confidence === 'high') found.confidence = 'high';
  for (const item of evidence) {
    const same = found.evidence.some(kept => kept.file === item.file && kept.line === item.line);
    if (!same && found.evidence.length < MAX_EVIDENCE) found.evidence.push(item);
  }
  tally.set(medium, found);
}

/** Every match of a pattern in the sources, as evidence. */
function matches(sources: Source[], pattern: RegExp): MediaEvidence[] {
  const found: MediaEvidence[] = [];
  for (const src of sources) {
    for (const match of src.text.matchAll(pattern)) found.push(cite(src, match.index ?? 0));
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// 3D and Video: what code can see for certain.

const THREE_D = [
  /\bpreserve-3d\b/g,
  /\bperspective\(/g,
  /\bperspective\s*:\s*["'`]?\d/g,
  /\btransformPerspective\s*:/g,
  // A turn of 0 about X or Y is flat: `rotateX(0deg)`, `rotateY: 0`.
  /\brotate[XY]\((?!\s*-?0(?:\.0+)?(?:deg|rad|grad|turn)?\s*\))/g,
  /\brotate3d\(/g,
  /\brotate[XY]\s*:\s*(?!(["'`]?)-?0(?:\.0+)?(?:deg|rad|grad|turn)?\1(?![\w.]))[-\d"'`[]/g,
  /\bfrom\s+["'](?:three|three\/[^"']*|@react-three\/[^"']+|@google\/model-viewer[^"']*)["']/g,
  /\b(?:import|require)\(\s*["'](?:three|@google\/model-viewer)[^"']*["']\s*\)/g,
  /\bimport\s+["'](?:three|@google\/model-viewer)[^"']*["']/g,
  /<model-viewer\b/g
];

const VIDEO = [
  /<video\b/g,
  /["'`(][^"'`()\s]*\.(?:mp4|webm|m4v|mov|ogv)(?:[?#][^"'`()\s]*)?["'`)]/gi,
  /\b(?:youtube(?:-nocookie)?\.com\/embed|player\.vimeo\.com\/video)\//g
];

// ---------------------------------------------------------------------------------------------
// Motion graphics.

/** A loading or busy indicator: shown while something is asked for, never at rest. */
const LOADER = /spin|loader|loading|busy|pending|progress|skeleton|shimmer|submitting|waiting/i;
/** A selector that applies only on a state: hover, focus, an aria or data state, `.is-…`. */
const STATE_SELECTOR =
  /:(?:hover|focus(?:-visible|-within)?|active|checked|disabled|invalid|valid|user-invalid|target|open|popover-open)\b|\[(?:aria-|data-|open\b)|\.(?:is|has)-[\w-]/i;
const KEYWORDS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'initial',
  'inherit',
  'unset'
]);

type Anim = { name: string | null; ms: number | null; loops: boolean; paused: boolean };
type Verdict = 'loop' | 'long';

/** Split at the top level (outside parentheses) on commas, or on spaces. */
function topSplit(value: string, by: ',' | ' '): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && (by === ',' ? c === ',' : /\s/.test(c!))) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

const toMs = (value: string, unit: string) => parseFloat(value) * (unit === 'ms' ? 1 : 1000);

/** The animations an `animation` shorthand names: the first time is the duration. */
function parseAnimations(value: string): Anim[] {
  return topSplit(value, ',').map(part => {
    const anim: Anim = { name: null, ms: null, loops: false, paused: false };
    let timed = false;
    for (const token of topSplit(part, ' ')) {
      const t = token.toLowerCase();
      const time = /^(-?\d*\.?\d+)(ms|s)$/.exec(t);
      const inner = /^calc\(/.test(t) ? /(\d*\.?\d+)(ms|s)\b/.exec(t) : null;
      if (time || inner) {
        const [, n, unit] = (time ?? inner) as RegExpExecArray;
        if (!timed) anim.ms = toMs(n!, unit!);
        timed = true;
      } else if (t === 'infinite') anim.loops = true;
      else if (/^\d*\.?\d+$/.test(t)) anim.loops ||= parseFloat(t) > 1;
      else if (t === 'paused') anim.paused = true;
      else if (t === 'none') anim.name ??= 'none';
      else if (
        !KEYWORDS.has(t) &&
        !t.startsWith('var(') &&
        !t.startsWith('cubic-bezier(') &&
        !t.startsWith('steps(')
      ) {
        anim.name ??= t;
      }
    }
    return anim;
  });
}

function verdictOf(anim: Anim): Verdict | null {
  if (!anim.name || anim.name === 'none' || anim.paused) return null;
  if (anim.loops) return 'loop';
  return anim.ms !== null && anim.ms > ENTRANCE_MS ? 'long' : null;
}

type CssRule = {
  selector: string;
  at: string[];
  decls: { prop: string; value: string; offset: number }[];
};

/** The style rules of a stylesheet, with each declaration's offset; nested @rules kept. */
function cssRules(css: string, base = 0): CssRule[] {
  const rules: CssRule[] = [];
  const stack: { prelude: string; rule?: CssRule }[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  const declare = (end: number) => {
    const rule = stack[stack.length - 1]?.rule;
    const segment = css.slice(start, end);
    const colon = segment.indexOf(':');
    if (!rule || colon < 0) return;
    const lead = segment.length - segment.trimStart().length;
    rule.decls.push({
      prop: segment.slice(0, colon).trim().toLowerCase(),
      value: segment.slice(colon + 1).trim(),
      offset: base + start + lead
    });
  };
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth > 0) continue;
    else if (c === '{') {
      const prelude = css.slice(start, i).trim();
      const at = stack.map(item => item.prelude).filter(item => item.startsWith('@'));
      const rule = prelude.startsWith('@') ? undefined : { selector: prelude, at, decls: [] };
      if (rule) rules.push(rule);
      stack.push({ prelude, rule });
      start = i + 1;
    } else if (c === ';') {
      declare(i);
      start = i + 1;
    } else if (c === '}') {
      declare(i);
      stack.pop();
      start = i + 1;
    }
  }
  return rules;
}

/** The animations a rule runs, from its shorthand and its longhands. */
function ruleAnimations(rule: CssRule): { anim: Anim; offset: number }[] {
  let found: { anim: Anim; offset: number }[] = [];
  for (const decl of rule.decls) {
    if (decl.prop === 'animation') {
      found = parseAnimations(decl.value).map(anim => ({ anim, offset: decl.offset }));
    }
  }
  for (const decl of rule.decls) {
    const value = decl.value.toLowerCase();
    if (decl.prop === 'animation-name' && !found.length) {
      found = topSplit(value, ',').map(name => ({
        anim: { name, ms: null, loops: false, paused: false },
        offset: decl.offset
      }));
    }
  }
  for (const decl of rule.decls) {
    const value = decl.value.toLowerCase();
    for (const item of found) {
      if (decl.prop === 'animation-duration') {
        const time = /(\d*\.?\d+)(ms|s)\b/.exec(value);
        if (time) item.anim.ms = toMs(time[1]!, time[2]!);
      } else if (decl.prop === 'animation-iteration-count') {
        item.anim.loops = value.includes('infinite') || parseFloat(value) > 1;
      } else if (decl.prop === 'animation-play-state') {
        item.anim.paused = value.includes('paused');
      }
    }
  }
  return found;
}

/**
 * Whether the text at `offset` sits in a branch that shows only on a state: a `cond && …`,
 * a ternary, or a JSX branch such as `{results && (` that is still open.
 */
function inConditional(text: string, offset: number, length = 0): boolean {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  // One character past the offset, so `ref.current?.animate(` reads as optional chaining.
  if (/&&|\|\||\?(?![.?])/.test(text.slice(lineStart, offset + 1))) return true;
  if (length && /^["'`]?\s*:\s*[\w!(]/.test(text.slice(offset + length, offset + length + 40))) {
    return true;
  }
  const from = Math.max(0, offset - 2000);
  for (const match of text.slice(from, offset).matchAll(/(?:&&|\?(?![.?])|\)\s*:)\s*\(/g)) {
    let depth = 0;
    for (let i = from + (match.index ?? 0) + match[0].length - 1; i < offset; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) break;
    }
    if (depth > 0) return true;
  }
  return false;
}

/** A loading word on the line or the few lines before it. */
function nearLoader(text: string, offset: number): boolean {
  let from = offset;
  for (let lines = 0; lines < 4 && from > 0; lines++) from = text.lastIndexOf('\n', from - 1);
  const to = text.indexOf('\n', offset);
  return LOADER.test(text.slice(Math.max(0, from), to < 0 ? undefined : to));
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A class every use of which in the code is on a state, so its element is not shown on load. */
function onStateOnly(name: string, code: Source[]): boolean {
  const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, 'g');
  let uses = 0;
  for (const src of code) {
    for (const match of src.text.matchAll(pattern)) {
      uses++;
      if (!inConditional(src.text, match.index ?? 0, name.length)) return false;
    }
  }
  return uses > 0;
}

/** A `.map(` callback, `(row, i) =>`, `row =>` or `function`, whose call opens at the `(`. */
const MAP_CALL =
  /\.map\(\s*(?:(?:async\s*)?(?:\([^()]*\)|[\w$]+)\s*(?::\s*[^=;{}()]+)?=>|function\b)/g;

/** Whether the text at `offset` sits inside a `.map(` callback: a row of a list. */
function inMap(text: string, offset: number): boolean {
  const from = Math.max(0, offset - 4000);
  for (const match of text.slice(from, offset).matchAll(MAP_CALL)) {
    let depth = 0;
    let open = true;
    for (let i = from + (match.index ?? 0) + '.map'.length; i < offset; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) {
        open = false;
        break;
      }
    }
    if (open) return true;
  }
  return false;
}

/**
 * A class every use of which in the code (its stylesheets aside) is on a row a `.map(` draws: the
 * rows of a list, which the way in fills.
 */
function inMapOnly(name: string, code: Source[]): boolean {
  const pattern = new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, 'g');
  let uses = 0;
  for (const src of code) {
    const styles = sheets(src).map(sheet => [sheet.base, sheet.base + sheet.css.length]);
    for (const match of src.text.matchAll(pattern)) {
      const at = match.index ?? 0;
      if (styles.some(([start, end]) => at >= start! && at < end!)) continue;
      uses++;
      if (!inMap(src.text, at)) return false;
    }
  }
  return uses > 0;
}

/**
 * Whether a selector applies to something shown at rest, on load, unasked. An `entrance` (run
 * once, at most ROW_ENTRANCE_MS) on a list's rows is the way in's animation of its results.
 */
function atRest(selector: string, name: string | null, code: Source[], entrance = false): boolean {
  if (name && LOADER.test(name)) return false;
  return topSplit(selector, ',').some(part => {
    if (STATE_SELECTOR.test(part) || LOADER.test(part)) return false;
    const classes = [...part.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(match => match[1]);
    if (entrance && classes.some(name => inMapOnly(name!, code))) return false;
    return !classes.some(name => onStateOnly(name!, code));
  });
}

/** The stylesheets in a source: the file itself, its <style> blocks and its CSS template strings. */
function sheets(src: Source): { css: string; base: number }[] {
  if (src.css) return [{ css: src.text, base: 0 }];
  const found: { css: string; base: number }[] = [];
  for (const match of src.text.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>/g)) {
    found.push({ css: match[2]!, base: (match.index ?? 0) + match[1]!.length });
  }
  for (const match of src.text.matchAll(/`([^`]*)`/g)) {
    if (/@keyframes\b|\{[^{}]*\banimation(?:-[a-z-]+)?\s*:/.test(match[1]!)) {
      found.push({ css: match[1]!, base: (match.index ?? 0) + 1 });
    }
  }
  return found;
}

type Context = 'handler' | 'mount' | 'effect' | 'rest';

const EFFECT =
  /\buse(?:Layout)?Effect\(\s*(?:async\s*)?(?:\(\s*\)\s*=>|function\s*\w*\s*\(\s*\))\s*$/;
const HANDLERS = [
  /\bon[A-Z]\w*\s*=\s*$/,
  /\b(?:on|handle)[A-Z]\w*\s*[=:]\s*\{?\s*(?:useCallback\(\s*)?(?:async\s+)?(?:\([^()]*\)|\w+)\s*(?::\s*[^=;{}]+)?=>\s*$/,
  /\bfunction\s+(?:on|handle)[A-Z]\w*\s*\([^()]*\)\s*(?::\s*[^{};]+)?$/,
  /addEventListener\(\s*["'][\w-]+["']\s*,\s*(?:async\s+)?(?:\([^()]*\)|\w+)\s*=>\s*$/
];
const NAMED_FUNCTION =
  /\b(?:function\s+([a-z]\w*)\s*\([^()]*\)\s*(?::\s*[^{};]+)?|(?:const|let)\s+([a-z]\w*)\s*=\s*(?:useCallback\(\s*)?(?:async\s+)?(?:\([^()]*\)|\w+)\s*(?::\s*[^=;{}]+)?=>)\s*$/;

/** How an effect runs: once on mount (`[]`), on its dependencies, or after every render. */
function effectKind(text: string, open: number): Context {
  const body = balanced(text, open);
  const after = text.slice(open + body.length, open + body.length + 40);
  if (/^\s*,\s*\[\s*\]/.test(after)) return 'mount';
  return /^\s*,\s*\[/.test(after) ? 'effect' : 'rest';
}

/**
 * What starts the code at `offset`: an event handler (the way in), an effect, or the component
 * itself (at rest). A plain named function is what calls it, one level up.
 */
function contextOf(text: string, offset: number, levels = 1): Context {
  let depth = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth > 0) {
        depth--;
        continue;
      }
      const prefix = text.slice(Math.max(0, i - 200), i);
      if (EFFECT.test(prefix)) return effectKind(text, i);
      if (HANDLERS.some(pattern => pattern.test(prefix))) return 'handler';
      const named = NAMED_FUNCTION.exec(prefix);
      if (named) {
        const name = named[1] ?? named[2];
        if (levels <= 0) return 'handler';
        const calls = [
          ...text.matchAll(new RegExp(`(?<![\\w.$])${escapeRegExp(name!)}\\(`, 'g'))
        ].filter(
          call => !/function\s+$/.test(text.slice(Math.max(0, (call.index ?? 0) - 12), call.index))
        );
        const contexts = calls.map(call => contextOf(text, call.index ?? 0, levels - 1));
        return (
          (['mount', 'rest', 'effect'] as const).find(kind => contexts.includes(kind)) ?? 'handler'
        );
      }
    }
  }
  return 'rest';
}

const usesMotion = (text: string) =>
  /\bfrom\s+["'](?:motion|motion\/react|framer-motion)["']/.test(text);

function motionFindings(sources: Source[], tally: Tally): void {
  const code = sources.filter(src => !src.css);
  const found = (confidence: 'high' | 'low', src: Source, offset: number) =>
    add(tally, 'Motion graphics', confidence, [cite(src, offset)]);

  // Stylesheets: a looping animation, or a long one on something shown on load.
  for (const src of sources) {
    for (const sheet of sheets(src)) {
      for (const rule of cssRules(sheet.css, sheet.base)) {
        if (rule.at.some(at => /^@(?:-\w+-)?keyframes\b/i.test(at))) continue;
        if (rule.at.some(at => /prefers-reduced-motion\s*:\s*reduce/i.test(at))) continue;
        for (const { anim, offset } of ruleAnimations(rule)) {
          const verdict = verdictOf(anim);
          const entrance = verdict === 'long' && anim.ms !== null && anim.ms <= ROW_ENTRANCE_MS;
          if (verdict && atRest(rule.selector, anim.name, code, entrance)) {
            found('high', src, offset);
          }
        }
      }
    }
  }

  for (const src of code) {
    const { text } = src;
    const shown = (offset: number) =>
      !inConditional(text, offset) &&
      !nearLoader(text, offset) &&
      contextOf(text, offset) !== 'handler';
    const sure = (offset: number) => (contextOf(text, offset) === 'effect' ? 'low' : 'high');
    const animates = usesMotion(text) || /\.animate\(/.test(text);

    // Inline styles: `animation: '…'` in a style object, or in a style attribute.
    for (const match of text.matchAll(
      /\banimation\s*:\s*(["'`])([^"'`]+)\1|style\s*=\s*"([^"]*\banimation\s*:[^"]*)"/g
    )) {
      const value = match[2] ?? /\banimation\s*:\s*([^;]+)/.exec(match[3] ?? '')?.[1] ?? '';
      const offset = match.index ?? 0;
      if (parseAnimations(value).some(anim => verdictOf(anim)) && shown(offset)) {
        found(sure(offset), src, offset);
      }
    }
    for (const match of text.matchAll(/\banimationIterationCount\s*:\s*["'`]?(infinite|\d+)/g)) {
      const offset = match.index ?? 0;
      if ((match[1] === 'infinite' || Number(match[1]) > 1) && shown(offset))
        found(sure(offset), src, offset);
    }

    // Tailwind's animate-* classes: ping, pulse and bounce loop; spin is a loader.
    for (const match of text.matchAll(/(?<![\w-])animate-(\[[^\]\s]+\]|[a-z][\w-]*)/g)) {
      const offset = match.index ?? 0;
      const lineStart = text.lastIndexOf('\n', offset) + 1;
      if (!/\bclass(?:Name)?\b|clsx|cn\(/.test(text.slice(lineStart, offset))) continue;
      const kind = match[1]!;
      if (['spin', 'none', 'in', 'out'].includes(kind) || !shown(offset)) continue;
      if (kind.startsWith('[')) {
        const anims = parseAnimations(kind.slice(1, -1).replace(/_/g, ' '));
        if (anims.some(anim => verdictOf(anim))) found('high', src, offset);
      } else {
        found(['ping', 'pulse', 'bounce'].includes(kind) ? 'high' : 'low', src, offset);
      }
    }

    // Motion and the Web Animations API: a repeat or more than one iteration.
    if (animates) {
      for (const match of text.matchAll(/\b(repeat|iterations)\s*:\s*(Infinity|\d+(?:\.\d+)?)/g)) {
        const count = match[2] === 'Infinity' ? Infinity : Number(match[2]);
        const loops = match[1] === 'repeat' ? count >= 1 : count > 1;
        const offset = match.index ?? 0;
        if (loops && shown(offset)) found(sure(offset), src, offset);
      }
    }

    // A Web Animations or Motion `animate()` call outside an event handler, longer than the
    // allowed entrance or of a length the scan cannot read.
    const motionAnimate =
      usesMotion(text) && /\buseAnimate\(|\{[^}]*\banimate\b[^}]*\}\s*from/.test(text);
    for (const match of text.matchAll(/(\.)?\banimate\(/g)) {
      const web = match[1] === '.';
      if (!web && !motionAnimate) continue;
      const offset = match.index ?? 0;
      const args = balanced(text, offset + match[0].length - 1);
      if (!/^\(\s*[[{\w]/.test(args) || /\b(?:repeat|iterations)\s*:/.test(args)) continue;
      const context = contextOf(text, offset);
      if (context === 'handler' || inConditional(text, offset)) continue;
      const duration =
        /\bduration\s*:\s*(\d*\.?\d+)/.exec(args) ?? (web ? /,\s*(\d+)\s*\)$/.exec(args) : null);
      if (!duration) {
        if (web) found('low', src, offset);
        continue;
      }
      const ms = parseFloat(duration[1]!) * (web ? 1 : 1000);
      if (ms > ENTRANCE_MS) found(context === 'effect' ? 'low' : 'high', src, offset);
    }

    // A Motion element that enters on load for longer than the allowed entrance. Whether it is
    // shown on load is read, not known, so it is 'low'.
    if (usesMotion(text)) {
      for (const match of text.matchAll(/<motion\.\w+\b/g)) {
        const offset = match.index ?? 0;
        const attrs = text
          .slice(offset, tagEnd(text, offset))
          .replace(/\bexit\s*=\s*\{\{[\s\S]*?\}\}/g, '');
        if (/\binitial\s*=\s*\{\s*false\s*\}/.test(attrs)) continue;
        if (!/\b(?:initial|whileInView)\s*=/.test(attrs)) continue;
        const longest = Math.max(
          0,
          ...[...attrs.matchAll(/\bduration\s*:\s*(\d*\.?\d+)\b/g)].map(item =>
            parseFloat(item[1]!)
          )
        );
        if (longest * 1000 <= ENTRANCE_MS || inConditional(text, offset)) continue;
        const presence = text.lastIndexOf('<AnimatePresence', offset);
        if (
          presence >= 0 &&
          /\binitial\s*=\s*\{\s*false\s*\}/.test(text.slice(presence, tagEnd(text, presence))) &&
          !text.slice(presence, offset).includes('</AnimatePresence>')
        ) {
          continue;
        }
        found('low', src, offset);
      }
    }

    // SVG's own animation (SMIL) starts on load unless it waits for an event.
    for (const match of text.matchAll(/<animate(?:Transform|Motion)?\b[^>]*>/g)) {
      const tag = match[0];
      const offset = match.index ?? 0;
      if (/\bbegin\s*=\s*["'][^"']*[a-z]/i.test(tag) || inConditional(text, offset)) continue;
      const repeat = /\brepeatCount\s*=\s*["']([^"']+)["']/.exec(tag)?.[1];
      const dur = /\bdur\s*=\s*["'](\d*\.?\d+)(ms|s)?["']/.exec(tag);
      const loops = repeat === 'indefinite' || (repeat !== undefined && Number(repeat) > 1);
      if (loops || (dur && toMs(dur[1]!, dur[2] ?? 's') > ENTRANCE_MS)) found('high', src, offset);
    }

    // A frame loop that calls itself, started at rest, or a timer that changes the screen at
    // rest: read, not known.
    const looped = new Set(
      [...text.matchAll(/\brequestAnimationFrame\(\s*(\w+)\s*\)/g)].map(match => match[1]!)
    );
    for (const name of looped) {
      const named = escapeRegExp(name);
      const calls = [
        ...text.matchAll(
          new RegExp(`\\brequestAnimationFrame\\(\\s*${named}\\s*\\)|(?<![\\w.$])${named}\\(`, 'g')
        )
      ]
        .map(call => call.index ?? 0)
        .filter(at => !/function\s+$/.test(text.slice(Math.max(0, at - 12), at)));
      const inside = (at: number) => enclosingPrefix(text, at, name) !== '';
      const starts = calls.filter(at => !inside(at));
      if (calls.some(inside) && starts.some(at => contextOf(text, at) !== 'handler')) {
        found('low', src, starts[0]!);
      }
    }
    for (const match of text.matchAll(/\buseAnimationFrame\(/g))
      found('low', src, match.index ?? 0);
    if (animates || /\btransition\b|@keyframes/.test(text)) {
      for (const match of text.matchAll(/\bsetInterval\(/g)) {
        const offset = match.index ?? 0;
        const context = contextOf(text, offset);
        if (context === 'mount' || context === 'rest') found('low', src, offset);
      }
    }
  }
}

/** The text before the nearest enclosing function named `name`, or '' when it is elsewhere. */
function enclosingPrefix(text: string, offset: number, name: string): string {
  let depth = 0;
  for (let i = offset - 1; i >= 0; i--) {
    if (text[i] === '}') depth++;
    else if (text[i] === '{') {
      if (depth > 0) {
        depth--;
        continue;
      }
      const prefix = text.slice(Math.max(0, i - 200), i);
      const named = NAMED_FUNCTION.exec(prefix);
      if (named && (named[1] ?? named[2]) === name) return prefix;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------------------------
// Inline SVG: icons, drawings and diagrams (decision 7).

type Drawing = { medium: 'Illustration' | 'SVG diagrams'; confidence: 'high' | 'low' };

/** Decision 7's line, from what a drawing holds and its shape. */
function sortDrawing(
  counts: { texts: number; shapes: number; lines: number },
  long: number,
  short: number
): Drawing | null {
  const { texts, shapes, lines } = counts;
  if (short > 0 && long / short >= STRIP_RATIO && shapes + lines <= 3 && !texts) {
    return { medium: 'SVG diagrams', confidence: 'low' };
  }
  if (texts > 0) return { medium: 'SVG diagrams', confidence: 'high' };
  if (lines >= 2 && lines * 2 >= shapes) return { medium: 'SVG diagrams', confidence: 'high' };
  if (shapes + lines <= 1) return { medium: 'Illustration', confidence: 'low' };
  return { medium: 'Illustration', confidence: 'high' };
}

/** A size attribute in pixels: `width="320"`, `height={240}`; null for a percentage or none. */
function sizeAttr(attrs: string, name: 'width' | 'height'): number | null {
  const found = new RegExp(
    String.raw`(?<![\w-])${name}\s*=\s*(?:["'\`]\s*([\d.]+)(?:px)?\s*["'\`]|\{\s*([\d.]+)\s*\})`
  ).exec(attrs);
  return found ? parseFloat(found[1] ?? found[2] ?? '') : null;
}

/** The longer side of a viewBox such as "0 0 24 24", or null when it has none. */
function viewBoxSide(viewBox: string | null): number | null {
  const parts = (viewBox ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? Math.max(parts[2]!, parts[3]!) : null;
}

/** A measured svg as the scan reads it: an icon, a texture or nothing at all, or a drawing. */
function sortBox(box: SvgBox): Drawing | null {
  if (box.width < 2 || box.height < 2) return null;
  const long = Math.max(box.width, box.height);
  const short = Math.min(box.width, box.height);
  // An icon: small, small inside a control, or drawn on an icon's grid at any size.
  if (long <= ICON_PX || (box.inControl && long <= CONTROL_ICON_PX)) return null;
  const grid = viewBoxSide(box.viewBox);
  if (grid !== null && grid <= ICON_GRID) return null;
  if (!box.texts && box.shapes + box.lines === 0) return null;
  if (!box.viewBox && !box.texts && box.shapes + box.lines <= 1) return null;
  if (short > 0 && long / short >= STRIP_RATIO && long < ROUTE_PX) return null;
  return sortDrawing(box, long, short);
}

const SHAPE = /<(?:path|circle|ellipse|rect|polygon|use)\b/g;
const LINE = /<(?:line|polyline)\b/g;
const TEXT = /<(?:text|foreignObject)\b/g;
const DEFS =
  /<(defs|symbol|clipPath|mask|filter|pattern|linearGradient|radialGradient)\b[\s\S]*?<\/\1>/g;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

/**
 * An inline `<svg>` in the files, read without the render: a 'low' reading, unless `sure` asks for
 * a sure one and the drawing is an SVG diagram by its own written-out `<text>`, larger than a
 * control's icon and outside the header, nav or a link (MediaScanOptions; the look-screen check,
 * ROUGHBOOK-MEDIA-PLAN.md, V2).
 */
function fileDrawing(src: Source, start: number, sure = false): Drawing | null {
  const { text } = src;
  const open = tagEnd(text, start);
  const attrs = text.slice(start, open + 1);
  const close = attrs.endsWith('/>') ? open : text.indexOf('</svg>', open);
  const inner = text.slice(open + 1, close < 0 ? undefined : close);
  if (/\b(?:width|height)\s*=\s*(?:["']0["']|\{\s*0\s*\})/.test(attrs)) return null;

  const box =
    /\bviewBox\s*=\s*(?:["'`]|\{\s*["'`])\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(
      attrs
    );
  const width = box ? parseFloat(box[3]!) : 0;
  const height = box ? parseFloat(box[4]!) : 0;
  if (box && Math.max(width, height) <= ICON_GRID) return null;

  // Inside an open <button> or <a>, an icon-sized svg is the control's icon; a card's drawing is
  // still a drawing. Its own width and height say its size, else its viewBox; with neither, an icon.
  const before = text.slice(0, start);
  const unclosed = (tag: string) =>
    Math.max(
      before.lastIndexOf(`<${tag} `),
      before.lastIndexOf(`<${tag}>`),
      before.lastIndexOf(`<${tag}\n`)
    ) > before.lastIndexOf(`</${tag}>`);
  const link = unclosed('a');
  if (unclosed('button') || link) {
    const sides = [sizeAttr(attrs, 'width'), sizeAttr(attrs, 'height')].filter(
      (side): side is number => side !== null
    );
    const longest = sides.length ? Math.max(...sides) : box ? Math.max(width, height) : 0;
    if (longest <= CONTROL_ICON_PX) return null;
  }

  const composed = /<[A-Z][\w.]*|(?:^|>)\s*\{(?!\s*\/\*)/.test(inner);
  const drawn = (composed ? text : inner).replace(DEFS, blankOut);
  const counts = {
    texts: count(drawn, TEXT),
    shapes: count(drawn, SHAPE),
    lines: count(drawn, LINE)
  };
  if (!counts.texts && counts.shapes + counts.lines === 0) return null;
  if (!box && !counts.texts && counts.shapes + counts.lines <= 1) return null;
  const sorted = sortDrawing(counts, Math.max(width, height), box ? Math.min(width, height) : 0);
  if (!sorted) return null;
  const own = [sizeAttr(attrs, 'width'), sizeAttr(attrs, 'height')].filter(
    (side): side is number => side !== null
  );
  const longest = Math.max(box ? Math.max(width, height) : 0, ...own);
  // A brand mark sits in the header, the nav or a link; the files alone cannot tell it from art.
  const brand = link || unclosed('header') || unclosed('nav');
  const labelled = sorted.medium === 'SVG diagrams' && counts.texts > 0;
  const certain = sure && labelled && !composed && !brand && longest > CONTROL_ICON_PX;
  return { ...sorted, confidence: certain ? sorted.confidence : 'low' };
}

function drawingFindings(
  sources: Source[],
  boxes: SvgBoxes | undefined,
  tally: Tally,
  sure = false
): void {
  const inFiles: { drawing: Drawing; evidence: MediaEvidence }[] = [];
  for (const src of sources.filter(item => !item.css)) {
    for (const match of src.text.matchAll(/<svg\b/g)) {
      const drawing = fileDrawing(src, match.index ?? 0, sure);
      if (drawing) inFiles.push({ drawing, evidence: cite(src, match.index ?? 0) });
    }
  }
  const measured = boxes && (boxes.wide || boxes.narrow);
  if (!measured) {
    for (const { drawing, evidence } of inFiles) {
      add(tally, drawing.medium, drawing.confidence, [evidence]);
    }
    return;
  }
  const widths: [string, SvgBox[] | undefined][] = [
    ['rendered 1280px', boxes.wide],
    ['rendered 390px', boxes.narrow]
  ];
  for (const [label, list] of widths) {
    for (const box of list ?? []) {
      const drawing = sortBox(box);
      if (!drawing) continue;
      const fromFiles = inFiles.filter(item => item.drawing.medium === drawing.medium);
      add(tally, drawing.medium, drawing.confidence, [
        {
          file: label,
          line: box.index + 1,
          text: `svg ${Math.round(box.width)}x${Math.round(box.height)}, viewBox ${box.viewBox ?? 'none'}: ${box.texts} texts, ${box.shapes} shapes, ${box.lines} lines`
        },
        ...(fromFiles.length ? fromFiles : inFiles).map(item => item.evidence)
      ]);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Product UI: a drawn app window or device, or an app's sidebar and panel, or the product's screen
// written as HTML: a titled table of its records that works. Always 'low'.

const FRAME_WORDS =
  /(?<![a-z0-9])(?:title-?bar|window-?(?:dots|chrome|controls|frame|bar)|traffic-?lights?|browser-?(?:bar|chrome|frame|window|mock(?:up)?)|address-?bar|url-?bar|app-?(?:window|frame|shell|chrome|screen|mock(?:up)?)|device-?(?:frame|mock(?:up)?)|phone-?(?:frame|bezel|mock(?:up)?|screen)|bezel|mock-?(?:up|screen|window|browser|app)|screen-?mock(?:up)?|dashboard)(?![a-z0-9])/i;
const FRAME_COMPONENT =
  /<(?:Browser|App|Device|Phone|Window|Mock|Laptop|Desktop)\w*(?:Frame|Window|Chrome|Bezel|Bar|Screen|Mockup|Shell)\b/g;
const SIDEBAR = /(?<![a-z0-9])(?:sidebar|side-?nav|side-?panel)(?![a-z0-9])/i;
const APP_PANEL =
  /(?<![a-z0-9])(?:panel|pane|workspace|inspector|toolbar|top-?bar|main-?view|content-?area)(?![a-z0-9])/i;
const TRAFFIC = [
  /#(?:ff5f57|ff605c)\b/i,
  /#(?:febc2e|ffbd2e|ffbd44)\b/i,
  /#(?:28c840|27c93f|28ca42|00ca4e)\b/i
];

/** The class names, ids and selectors in a source, with where each sits. */
function names(src: Source): { value: string; offset: number }[] {
  const found: { value: string; offset: number }[] = [];
  if (src.css) {
    for (const rule of cssRules(src.text)) {
      const offset = rule.decls[0]?.offset ?? 0;
      found.push({
        value: rule.selector,
        offset: Math.max(0, src.text.lastIndexOf(rule.selector, offset))
      });
    }
    return found;
  }
  for (const match of src.text.matchAll(
    /\b(?:className|class|id)\s*=\s*(?:\{([^}\n]*)\}|(["'])([^"'\n]*)\2)/g
  )) {
    found.push({ value: match[1] ?? match[3] ?? '', offset: match.index ?? 0 });
  }
  for (const sheet of sheets(src)) {
    for (const rule of cssRules(sheet.css, sheet.base)) {
      found.push({ value: rule.selector, offset: rule.decls[0]?.offset ?? sheet.base });
    }
  }
  return found;
}

/**
 * A tag closing, `</name>` or a fragment's `</>`, or opening, `<name` or `<>`. Right after a name
 * or a dot only an HTML tag opens, as in `this week<span>`: `useState<Plan>(`, `useRef<number>`
 * and `Array<string>` are types.
 */
const TAG =
  /<\/([A-Za-z][\w.:-]*)?\s*>|(?<![\w$.])<([A-Za-z][\w.:-]*|>)|(?<=[\w$.])<(?!(?:string|number|boolean|bigint|symbol|object|any|unknown|never|void|null|undefined|keyof|typeof)\b)([a-z][\w-]*)/g;
/** HTML's elements that never close. */
const VOID_TAG = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

type TagStep = { tag: string; kind: 'open' | 'close' | 'alone'; end: number };

/** The tag at a TAG match: its name ('' for a fragment), what it does, and the offset past it. */
function tagStep(text: string, match: RegExpExecArray): TagStep {
  const at = match.index;
  if (match[0].startsWith('</'))
    return { tag: match[1] ?? '', kind: 'close', end: at + match[0].length };
  if (match[2] === '>') return { tag: '', kind: 'open', end: at + 2 };
  const tag = match[2] ?? match[3] ?? '';
  const end = tagEnd(text, at);
  const alone = text[end - 1] === '/' || VOID_TAG.test(tag);
  return { tag, kind: alone ? 'alone' : 'open', end: end + 1 };
}

type OpenTag = { tag: string; start: number };

/**
 * Reads the tags that start from `from` up to `to`, keeping the elements open, and stops past the
 * element that opens at `from` when `whole`. A closing tag closes back to its own opening, and one
 * with no opening is passed over.
 */
function readTags(
  text: string,
  from: number,
  to: number,
  whole = false
): { open: OpenTag[]; end: number } {
  const pattern = new RegExp(TAG.source, 'g');
  pattern.lastIndex = from;
  const open: OpenTag[] = [];
  for (let match = pattern.exec(text); match && match.index < to; match = pattern.exec(text)) {
    const step = tagStep(text, match);
    if (step.kind === 'open') open.push({ tag: step.tag, start: match.index });
    else if (step.kind === 'close') {
      const index = open.map(item => item.tag).lastIndexOf(step.tag);
      if (index >= 0) open.length = index;
    }
    pattern.lastIndex = step.end;
    if (whole && !open.length) return { open, end: step.end };
  }
  return { open, end: text.length };
}

/** The elements open around `at`, innermost first, read from the top of the text. */
function ancestors(text: string, at: number): OpenTag[] {
  return readTags(text, 0, at).open.reverse();
}

/** The offset past the element that opens at `start`: its own closing tag, or the end. */
function elementEnd(text: string, start: number): number {
  return readTags(text, start, text.length, true).end;
}

/**
 * A table of records, HTML or ARIA. An ARIA one is found by its role and read from the `<` of its
 * tag, so no match runs on past one attribute.
 */
const RECORDS = /<table\b|\brole\s*=\s*["'{`]*table["'`}]/g;
const COLUMN_HEAD = /<th\b|\brole\s*=\s*["'{`]*columnheader["'`}]/g;
/** Rows drawn from data: a `.map(`, or a framework's own loop. */
const DRAWN_ROWS = /\.map\(|\bv-for\b|\{#each\b|@for\b|\*ngFor\b/;
/**
 * A column naming a price list, the page's offer rather than the product's records: a plan, a
 * price or a term, or a header that is only a cost or a fee.
 */
const PRICE_HEAD =
  /^(?:costs?|fees?)$|\b(?:prices?|pricing|plans?|monthly|yearly|annual(?:ly)?|(?:per|a) (?:month|year)|memberships?|tiers?)\b/i;
const HEADING = /<h([1-6])\b/g;
const HEADING_AT = /<h[1-6]\b/;
/** The way in, or part of it: a form, a field or the look's action. */
const WAY_IN = /<form\b|<input\b|<select\b|<textarea\b|\bdata-look\s*=\s*["'{`]*action/;
/** A screen's own control or live status: what makes it a working screen, not a printed one. */
const WORKING =
  /<button\b|\brole\s*=\s*["'{`]*(?:tab|tablist|switch|status|checkbox|radio)["'`}]|\baria-(?:pressed|selected|checked)\b|\bonClick\b/;
/** A component declared at the top of a file: `function Name`, `const Name =`, exported or not. */
const COMPONENT =
  /^(?:export\s+)?(default\s+)?(?:function\s+|(?:const|let|var)\s+)([A-Z][\w$]*[a-z][\w$]*)\b/gm;
const IMPORT_DEFAULT = /\bimport\s+([A-Z][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*["']([^"']+)["']/g;

/** An opening tag's start, for a match inside it (an ARIA role), or -1 when it is not in one. */
function tagStart(text: string, at: number): number {
  const start = text.lastIndexOf('<', at);
  return start >= 0 && /^<[A-Za-z]/.test(text.slice(start, start + 2)) && tagEnd(text, start) > at
    ? start
    : -1;
}

/** A column header's words, its tags and {expressions} left out. */
function headWords(text: string, start: number): string {
  let words = text.slice(start, elementEnd(text, start));
  for (let last = ''; last !== words;) [last, words] = [words, words.replace(/\{[^{}]*\}/g, ' ')];
  return words
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const baseName = (file: string) => file.replace(/^.*\//, '').replace(/\.\w+$/, '');

/**
 * Where the component around `at` is drawn in the code: each `<Name` of the top-level component
 * that holds it, or of the name another file imports it by when it is the default export.
 */
function drawnAt(code: Source[], src: Source, at: number): { src: Source; at: number }[] {
  let name = '';
  let exported = false;
  for (const match of src.text.slice(0, at).matchAll(COMPONENT)) {
    name = match[2] ?? '';
    exported = Boolean(match[1]);
  }
  const names = new Set(name ? [name] : []);
  if (exported || !name) {
    for (const other of code) {
      for (const match of other.text.matchAll(IMPORT_DEFAULT)) {
        if (baseName(match[2] ?? '') === baseName(src.file)) names.add(match[1] ?? '');
      }
    }
  }
  const found: { src: Source; at: number }[] = [];
  for (const each of names) {
    const use = new RegExp(`(?<![\\w$.])<${escapeRegExp(each)}(?![\\w$.:-])`, 'g');
    for (const other of code) {
      for (const match of other.text.matchAll(use))
        found.push({ src: other, at: match.index ?? 0 });
    }
  }
  return found;
}

/**
 * Whether the element at `at`..`end` sits where a screen is shown: at rest (not on a state, not a
 * list's row), outside any form, and, until a box is found, in a box that is a titled screen. The
 * first element around it that holds a heading is its box, which must hold just one, an h2-h6,
 * none of the way in, and a control or status of its own beside the table. Then the same is asked
 * where its component is drawn, file by file, so a part in its own file is read as it is shown.
 */
function shownAsScreen(
  code: Source[],
  src: Source,
  at: number,
  end: number,
  boxed: boolean,
  depth = 0
): boolean {
  const text = src.text;
  if (inConditional(text, at) || inMap(text, at)) return false;
  const around = ancestors(text, at);
  if (around.some(item => item.tag === 'form')) return false;
  const box = boxed
    ? undefined
    : around.find(item => HEADING_AT.test(text.slice(item.start, elementEnd(text, item.start))));
  if (box) {
    const close = elementEnd(text, box.start);
    const headings = [...text.slice(box.start, close).matchAll(HEADING)];
    const titled =
      headings.length === 1 &&
      headings[0]?.[1] !== '1' &&
      !WAY_IN.test(text.slice(box.start, close)) &&
      !inConditional(text, box.start) &&
      !inMap(text, box.start) &&
      WORKING.test(text.slice(box.start, at) + text.slice(end, close));
    if (!titled) return false;
  }
  const screen = boxed || Boolean(box);
  const uses = depth < 4 ? drawnAt(code, src, at) : [];
  if (!uses.length) return screen;
  return uses.every(use =>
    shownAsScreen(code, use.src, use.at, elementEnd(use.src.text, use.at), screen, depth + 1)
  );
}

/**
 * The product's screen written as HTML: a table of the product's records (two column headers,
 * rows drawn from data) that is not a price list, shown at rest as a working screen: titled by
 * its one h2-h6, with a control or status of its own, away from the way in. A table in the hero
 * beside its h1, in a section's own box with its step headings, in the form, on a state, in a
 * list's row, or printed with nothing to work is not.
 */
function screenFindings(sources: Source[]): MediaEvidence[] {
  const code = sources.filter(src => !src.css);
  const found: MediaEvidence[] = [];
  for (const src of code) {
    const text = src.text;
    for (const match of text.matchAll(RECORDS)) {
      const at = match[0].startsWith('<') ? (match.index ?? 0) : tagStart(text, match.index ?? 0);
      if (at < 0) continue;
      const end = elementEnd(text, at);
      const inner = text.slice(at, end);
      const heads = [...inner.matchAll(COLUMN_HEAD)].map(head => {
        const index = head.index ?? 0;
        return head[0].startsWith('<') ? index : tagStart(inner, index);
      });
      if (heads.filter(index => index >= 0).length < 2 || !DRAWN_ROWS.test(inner)) continue;
      if (heads.some(index => index >= 0 && PRICE_HEAD.test(headWords(inner, index)))) continue;
      if (shownAsScreen(code, src, at, end, false)) found.push(cite(src, at));
    }
  }
  return found;
}

function productFindings(sources: Source[], tally: Tally): void {
  const evidence: MediaEvidence[] = [];
  const sidebars: MediaEvidence[] = [];
  let panels = false;
  for (const src of sources) {
    for (const { value, offset } of names(src)) {
      if (FRAME_WORDS.test(value)) evidence.push(cite(src, offset));
      if (SIDEBAR.test(value)) sidebars.push(cite(src, offset));
      if (APP_PANEL.test(value)) panels = true;
    }
    if (!src.css)
      for (const match of src.text.matchAll(FRAME_COMPONENT))
        evidence.push(cite(src, match.index ?? 0));
    const lights = TRAFFIC.map(pattern => pattern.exec(src.text));
    if (lights.filter(Boolean).length >= 2) {
      evidence.push(cite(src, lights.find(Boolean)?.index ?? 0));
    }
  }
  if (panels) evidence.push(...sidebars);
  // After the frames, so their lines are cited first.
  evidence.push(...screenFindings(sources));
  if (evidence.length) add(tally, 'Product UI', 'low', evidence);
}

// ---------------------------------------------------------------------------------------------

/**
 * Photos, as PICTURE_NOT_ALLOWED reads them, each cited where its address is written. They are
 * read with comments blanked, so a photo commented out is not one.
 */
function photoFindings(sources: Source[], tally: Tally): void {
  const styled = sources.filter(src => STYLED.test(src.file));
  const uses = pictureUses(styled.map(src => [src.file, src.text])).filter(isPhoto);
  for (const use of uses) {
    const src = styled.find(item => item.file === use.file);
    const offset = src?.text.indexOf(use.src) ?? -1;
    if (src && offset >= 0) add(tally, 'Photography', 'high', [cite(src, offset)]);
  }
}

/**
 * The media a sketch's files use, one entry per medium found, sorted by its name. `files` is path
 * to source text; the look's own look.css and look.ts are left out, as the look-screen check
 * leaves them. `boxes` are the inline SVGs the render measured at each width; without them the
 * drawings are read from the files alone, as 'low', unless `options.sureFromFiles` asks otherwise.
 */
export function mediaScan(
  files: Record<string, string>,
  boxes?: SvgBoxes,
  options: MediaScanOptions = {}
): MediaUse[] {
  const sources = Object.entries(files)
    .filter(([path]) => path !== LOOK_CSS && path !== LOOK_WORDS)
    .filter(([path]) => CODE.test(path) || CSS.test(path))
    .map(([path, text]) => source(path, text));
  const tally: Tally = new Map();
  for (const pattern of THREE_D) {
    const found = matches(sources, pattern);
    if (found.length) add(tally, '3D', 'high', found);
  }
  for (const pattern of VIDEO) {
    const found = matches(sources, pattern);
    if (found.length) add(tally, 'Video', 'high', found);
  }
  motionFindings(sources, tally);
  drawingFindings(sources, boxes, tally, options.sureFromFiles === true);
  productFindings(sources, tally);
  photoFindings(sources, tally);
  return [...tally.entries()]
    .map(([medium, found]) => ({ medium, ...found }))
    .sort((a, b) => (a.medium < b.medium ? -1 : a.medium > b.medium ? 1 : 0));
}
