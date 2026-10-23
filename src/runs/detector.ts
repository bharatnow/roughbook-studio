// The detector (ROUGHBOOK-METHODS-PLAN.md, D7), as the backend's utils/compile/detector.ts checks
// it: the model tells a source scan can see, read from the files on this machine. Each tell found
// is named once per file and is a warning, never a failure. A template (markup.ts) is read as
// markup, with the CSS in its <style> blocks and style attributes.
import { MARKUP, MARKUP_ATTRS, markupClassLists } from './markup.js';
import type { Finding } from './types.js';

/** The tells this detector can see, in the order it reports them. */
export const DETECTED_TELLS = [
  'purple-gradient',
  'identical-cards',
  'decorative-numbering',
  'middle-dot-meta',
  'gradient-text',
  'ambient-backgrounds',
  'default-sans'
];

export type DetectorOptions = {
  /** The tells to look for: the detected ones a studio has not switched off. */
  tells: string[];
  /** Fonts the project's Design System chose, which are never a default. */
  fonts: string[];
};

const CODE = /\.(tsx|jsx|ts|js|mjs)$/i;
const CSS = /\.css$/i;

const CLASS_NAME = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
const PURPLE = String.raw`(?:purple|violet|fuchsia)`;
const BLUE = String.raw`(?:blue|indigo|cyan|sky)`;
const PURPLE_TO_BLUE = new RegExp(
  String.raw`(?:^|\s)from-${PURPLE}-\d+\b[\s\S]*(?:via|to)-${BLUE}-\d+\b|(?:^|\s)from-${BLUE}-\d+\b[\s\S]*(?:via|to)-${PURPLE}-\d+\b`
);
const CSS_PURPLE_TO_BLUE = new RegExp(
  String.raw`linear-gradient\([^)]*\b${PURPLE}\b[^)]*\b${BLUE}\b|linear-gradient\([^)]*\b${BLUE}\b[^)]*\b${PURPLE}\b`,
  'g'
);
const ROUNDED = /(?:^|\s)rounded(?:-[\w[\].]+)?(?=\s|$)/;
const SHADOW = /(?:^|\s)shadow(?:-[\w[\].]+)?(?=\s|$)/;
const MAPPED_ELEMENT =
  /\.map\(\s*(?:\([^)]*\)|\w+)\s*=>\s*\(?\s*<[\w.]+\b[^>]*?className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
/** A template's loop, and the tag it repeats: Blade's @foreach, Liquid's {% for %}, PHP's foreach. */
const LOOPED_TAG = new RegExp(
  String.raw`(?:@(?:foreach|forelse|for)\s*\((?:[^()]|\([^()]*\))*\)|\{%-?\s*for\b[^%]*%\}|\b(?:foreach|for|while)\s*\((?:[^()]|\([^()]*\))*\)\s*[:{]\s*\?>)\s*<[\w.-]+\b(${MARKUP_ATTRS})>`,
  'g'
);
const TAG = new RegExp(String.raw`<[\w.-]+\b(${MARKUP_ATTRS})>`, 'g');
const NUMBERING = /(?:>|['"`])\s*(0[1-9])\.?\s*(?:<|['"`])/g;
const MIDDLE_DOT = /\S[ \t]+(?:·|&middot;|•)[ \t]+\S/g;
const CLIPPED_TEXT_CSS = /(?:-webkit-)?background-clip\s*:\s*text/g;
const CLIPPED_TEXT_STYLE = /(?:WebkitBackgroundClip|backgroundClip)\s*:\s*['"]text['"]/g;
const GLOW = /(?:^|\s)blur-(?:2xl|3xl|\[\d{2,}px\])(?=\s|$)/;
const ROUND_FULL = /(?:^|\s)rounded-full(?=\s|$)/;
const CSS_GLOW = /filter\s*:\s*blur\((?:[4-9]\d|\d{3,})px\)/g;
const DEFAULT_FONTS = ['Inter', 'Space Grotesk'];
const FONT_USES = [
  /family=([A-Za-z+]+)/g,
  /font-family\s*:\s*([^;}]+)/g,
  /fontFamily\s*:\s*['"`]([^'"`]+)['"`]/g,
  /font-\[['"]?([A-Za-z_ ]+)/g,
  /import\s*\{([^}]*)\}\s*from\s*['"]next\/font\/google['"]/g
];

const times = (n: number) => (n === 1 ? '1 time' : `${n} times`);
const words = (text: string) => text.replace(/[+_]/g, ' ').trim().toLowerCase();

function classNames(text: string): string[] {
  return [...text.matchAll(CLASS_NAME)].map(match =>
    (match[1] ?? match[2] ?? match[3] ?? '').trim().replace(/\s+/g, ' ')
  );
}

/** The class list of each tag a template repeats in a loop, or with Vue's v-for. */
function loopedClassNames(text: string): string[] {
  const looped = [
    ...[...text.matchAll(LOOPED_TAG)].map(match => match[1]!),
    ...[...text.matchAll(TAG)]
      .map(match => match[1]!)
      .filter(attributes => /(?<![\w:@.-])v-for\s*=/.test(attributes))
  ];
  return looped.flatMap(attributes => markupClassLists(attributes).slice(0, 1));
}

/** The default fonts a file loads or names, less those the Design System chose. */
function defaultFonts(text: string, chosen: string[]): string[] {
  const allowed = new Set(chosen.map(words));
  const used = FONT_USES.flatMap(pattern => [...text.matchAll(pattern)].map(match => match[1]!));
  return DEFAULT_FONTS.filter(
    font =>
      !allowed.has(words(font)) &&
      used.some(value => new RegExp(String.raw`\b${font.replace(' ', '[ +_]')}\b`, 'i').test(value))
  );
}

function codeFindings(
  file: string,
  text: string,
  options: DetectorOptions,
  markup: boolean
): Finding[] {
  const on = (tell: string) => options.tells.includes(tell);
  const classes = markup
    ? markupClassLists(text).map(item => item.trim().replace(/\s+/g, ' '))
    : classNames(text);
  /** How often a CSS rule appears in a template's <style> blocks and style attributes. */
  const css = (pattern: RegExp) => (markup ? [...text.matchAll(pattern)].length : 0);
  const findings: Finding[] = [];

  const purple = classes.filter(item => PURPLE_TO_BLUE.test(item)).length + css(CSS_PURPLE_TO_BLUE);
  if (on('purple-gradient') && purple) {
    findings.push({
      code: 'TELL_PURPLE_GRADIENT',
      message: `${file} has a purple-to-blue gradient ${times(purple)}.`
    });
  }
  if (on('identical-cards')) {
    const cards = new Map<string, number>();
    for (const item of classes) {
      if (ROUNDED.test(item) && SHADOW.test(item)) cards.set(item, (cards.get(item) ?? 0) + 1);
    }
    const repeated = Math.max(0, ...cards.values());
    const mapped = markup
      ? loopedClassNames(text).some(item => ROUNDED.test(item) && SHADOW.test(item))
      : [...text.matchAll(MAPPED_ELEMENT)].some(match => {
          const item = match[1] ?? match[2] ?? match[3] ?? '';
          return ROUNDED.test(item) && SHADOW.test(item);
        });
    if (repeated >= 3) {
      findings.push({
        code: 'TELL_IDENTICAL_CARDS',
        message: `${file} repeats one rounded, shadowed card ${repeated} times; let the content set them apart.`
      });
    } else if (mapped) {
      findings.push({
        code: 'TELL_IDENTICAL_CARDS',
        message: `${file} renders one rounded, shadowed card for every item in a list; let the content set them apart.`
      });
    }
  }
  if (on('decorative-numbering')) {
    const numbers = new Set([...text.matchAll(NUMBERING)].map(match => match[1]));
    if (numbers.has('01') && numbers.has('02')) {
      findings.push({
        code: 'TELL_DECORATIVE_NUMBERING',
        message: `${file} numbers its items 01, 02 and on, for decoration.`
      });
    }
  }
  const dots = [...text.matchAll(MIDDLE_DOT)].length;
  if (on('middle-dot-meta') && dots) {
    findings.push({
      code: 'TELL_MIDDLE_DOT_META',
      message: `${file} joins meta text with middle dots ${times(dots)}.`
    });
  }
  const clipped =
    classes.filter(item => item.includes('bg-clip-text') && item.includes('text-transparent'))
      .length +
    [...text.matchAll(CLIPPED_TEXT_STYLE)].length +
    css(CLIPPED_TEXT_CSS);
  if (on('gradient-text') && clipped) {
    findings.push({
      code: 'TELL_GRADIENT_TEXT',
      message: `${file} fills text with a gradient ${times(clipped)}.`
    });
  }
  const glows =
    classes.filter(item => GLOW.test(item) && ROUND_FULL.test(item)).length + css(CSS_GLOW);
  if (on('ambient-backgrounds') && glows) {
    findings.push({
      code: 'TELL_GLOW_BLOB',
      message: `${file} has a blurred glow blob ${times(glows)}.`
    });
  }
  findings.push(...fontFindings(file, text, options));
  return findings;
}

function cssFindings(file: string, text: string, options: DetectorOptions): Finding[] {
  const on = (tell: string) => options.tells.includes(tell);
  const findings: Finding[] = [];
  const purple = [...text.matchAll(CSS_PURPLE_TO_BLUE)].length;
  if (on('purple-gradient') && purple) {
    findings.push({
      code: 'TELL_PURPLE_GRADIENT',
      message: `${file} has a purple-to-blue gradient ${times(purple)}.`
    });
  }
  const clipped = [...text.matchAll(CLIPPED_TEXT_CSS)].length;
  if (on('gradient-text') && clipped) {
    findings.push({
      code: 'TELL_GRADIENT_TEXT',
      message: `${file} fills text with a gradient ${times(clipped)}.`
    });
  }
  const glows = [...text.matchAll(CSS_GLOW)].length;
  if (on('ambient-backgrounds') && glows) {
    findings.push({
      code: 'TELL_GLOW_BLOB',
      message: `${file} has a blurred glow blob ${times(glows)}.`
    });
  }
  findings.push(...fontFindings(file, text, options));
  return findings;
}

function fontFindings(file: string, text: string, options: DetectorOptions): Finding[] {
  if (!options.tells.includes('default-sans')) return [];
  const fonts = defaultFonts(text, options.fonts);
  return fonts.length
    ? [
        {
          code: 'TELL_DEFAULT_SANS',
          message: `${file} uses ${fonts.join(' and ')}, a font models choose by default; use the Design System's type.`
        }
      ]
    : [];
}

/** The detector's warnings for an iteration's files, file by file in the order given. */
export function detectorFindings(files: Map<string, string>, options: DetectorOptions): Finding[] {
  const findings: Finding[] = [];
  for (const [file, text] of files) {
    if (CODE.test(file)) findings.push(...codeFindings(file, text, options, false));
    else if (MARKUP.test(file)) findings.push(...codeFindings(file, text, options, true));
    else if (CSS.test(file)) findings.push(...cssFindings(file, text, options));
  }
  return findings;
}
