// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/compile/houseChecks.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// The house rules' own checks (ROUGHBOOK-STUDIO-POWER-PLAN.md, SP1, rule 6): what a source scan
// can see of the floors and of the defaults the other checks do not already read. A floor's
// finding blocks the finish once and no direction lifts it; a default's is a warning, and is
// dropped, with every other check's finding of that default, when the maker's words lifted it
// (houseRules.ts DEFAULT_CODES).
import { DEFAULT_CODES } from './houseRules.js';
import type { Finding } from '../vendor-shims.js';

const CODE = /\.(tsx|jsx|ts|js|mjs)$/i;
const CSS = /\.css$/i;
const MARKUP = /\.(html?|vue|svelte|astro|liquid|php|erb|hbs|njk)$/i;

/** A floor's codes: never dropped, whatever was lifted. */
export const REDUCED_MOTION_MISSING = 'REDUCED_MOTION_MISSING';
export const OPAQUE_MISSING = 'OPAQUE_MISSING';

/** Something that animates: keyframes, a motion component, a frame loop, or a moving transition. */
const ANIMATES = [
  /@keyframes\b/,
  /\banimation\s*:/,
  /(?:^|[\s"'`])animate-(?!none\b)[a-z[]/m,
  /<motion\.[a-z]/,
  /from\s+['"](?:motion\/react|framer-motion|gsap|@react-spring\/[\w-]+)['"]/,
  /\brequestAnimationFrame\s*\(/,
  /\.animate\s*\(\s*[[{]/,
  /transition(?:-property)?\s*:\s*[^;}]*\b(?:transform|translate|scale|rotate|all)\b/,
  /(?:^|[\s"'`])transition(?:-transform|-all)?(?=[\s"'`])/m
];
/** A reduced-motion path: the media query, its hooks or its Tailwind variants. */
const REDUCED = /prefers-reduced-motion|useReducedMotion|reducedMotion|motion-reduce:|motion-safe:/;

/** A translucent surface: a backdrop blur, in CSS or Tailwind. */
const TRANSLUCENT_CSS = /backdrop-filter\s*:\s*(?!none\b)/g;
const TRANSLUCENT_CLASS =
  /(?:^|[\s"'`])backdrop-(?:blur|saturate|brightness)(?:-[\w[\].]+)?(?=[\s"'`])/gm;
const TRANSLUCENT_STYLE = /\bbackdropFilter\s*:\s*['"`](?!none)/g;
/** Its opaque version: the reduced-transparency query, or a fallback where no blur runs. */
const OPAQUE =
  /prefers-reduced-transparency|@supports\s+not\s*\(\s*(?:-webkit-)?backdrop-filter|contrast-more:|forced-colors/;

/** A height taken from the window (no-full-height). */
const FULL_HEIGHT =
  /(?:^|[\s"'`])(?:min-)?h-(?:screen|dvh|svh|lvh)(?=[\s"'`])|\b100(?:\.0+)?[dsl]?vh\b/gm;

/** A duration over the 300 ms the motion default allows. */
const DURATIONS = [
  /(?:^|[\s"'`])duration-\[?(\d+)(?:ms)?\]?(?=[\s"'`])/gm,
  /(?:transition|animation)(?:-duration)?\s*:[^;}]*?\b(\d+(?:\.\d+)?)(ms|s)\b/g,
  /\bduration\s*:\s*(\d+(?:\.\d+)?)\b/g
];

/** Motion tied to scroll (no-load-scroll-motion). */
const SCROLL_MOTION =
  /\bwhileInView\b|\buseScroll\b|\bScrollTrigger\b|animation-timeline\s*:\s*(?:scroll|view)\b|\bscroll-timeline\b/g;

const times = (n: number) => (n === 1 ? '1 time' : `${n} times`);
const count = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].length;

/** The longest duration a file asks for, in ms, by the patterns above; 0 when none. */
function longestMs(text: string): number {
  let longest = 0;
  for (const pattern of DURATIONS) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (!Number.isFinite(value)) continue;
      // A bare `duration:` (motion's options) is in seconds; a Tailwind duration-500 is in ms.
      const ms =
        match[2] === 's' || (pattern === DURATIONS[2] && value < 20) ? value * 1000 : value;
      longest = Math.max(longest, ms);
    }
  }
  return longest;
}

/**
 * The house rules' findings for an iteration's files: the floors over the iteration as a whole
 * (a reduced-motion path or an opaque version may sit in any of its files), the defaults file by
 * file. Nothing is dropped here; liftFindings does that.
 */
export function houseFindings(files: Map<string, string>): Finding[] {
  const read = [...files].filter(
    ([file]) => CODE.test(file) || CSS.test(file) || MARKUP.test(file)
  );
  const all = read.map(([, text]) => text).join('\n');
  const findings: Finding[] = [];

  const moving = read.filter(([, text]) => ANIMATES.some(pattern => pattern.test(text)));
  if (moving.length && !REDUCED.test(all)) {
    findings.push({
      code: REDUCED_MOTION_MISSING,
      message: `${moving.map(([file]) => file).join(', ')} animate${moving.length === 1 ? 's' : ''} with no reduced-motion path. Under prefers-reduced-motion: reduce, stop the movement (a fade may stay).`,
      blocks: true
    });
  }
  const translucent = read.filter(
    ([, text]) =>
      count(text, TRANSLUCENT_CSS) + count(text, TRANSLUCENT_CLASS) + count(text, TRANSLUCENT_STYLE)
  );
  if (translucent.length && !OPAQUE.test(all)) {
    findings.push({
      code: OPAQUE_MISSING,
      message: `${translucent.map(([file]) => file).join(', ')} blur${translucent.length === 1 ? 's' : ''} what is behind a surface with no opaque version. Give it a solid background under prefers-reduced-transparency, so its text keeps its contrast.`,
      blocks: true
    });
  }

  for (const [file, text] of read) {
    const glass =
      count(text, TRANSLUCENT_CSS) +
      count(text, TRANSLUCENT_CLASS) +
      count(text, TRANSLUCENT_STYLE);
    if (glass) {
      findings.push({
        code: 'TELL_DECORATIVE_GLASS',
        message: `${file} has a frosted glass surface ${times(glass)}.`
      });
    }
    const tall = count(text, FULL_HEIGHT);
    if (tall) {
      findings.push({
        code: 'HOUSE_FULL_HEIGHT',
        message: `${file} sizes something to the window ${times(tall)} (min-h-screen, h-screen or 100vh); let its content set its height.`
      });
    }
    const longest = longestMs(text);
    if (longest > 300) {
      findings.push({
        code: 'HOUSE_MOTION_OVER_CAP',
        message: `${file} has motion of ${Math.round(longest)} ms; keep it to 150 to 300 ms.`
      });
    }
    const scrolled = count(text, SCROLL_MOTION);
    if (scrolled) {
      findings.push({
        code: 'HOUSE_SCROLL_MOTION',
        message: `${file} moves things on scroll ${times(scrolled)}; motion shows what changed when a control is used.`
      });
    }
  }
  return findings;
}

/** The findings less those of a lifted default (DEFAULT_CODES); a floor's always stay. */
export function liftFindings(findings: Finding[], lifted: readonly string[]): Finding[] {
  if (!lifted.length) return findings;
  return findings.filter(item => {
    const owner = DEFAULT_CODES[item.code];
    return !owner || !lifted.includes(owner);
  });
}
