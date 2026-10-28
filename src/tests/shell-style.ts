// The shell-style ratchet (ROUGHBOOK-APPLE-PLAN.md, A1 step 1; the web keeps the same rules in its
// src/lib/shell-style.ts): per file of the local UI, how many of the habits A11 retires it still
// holds. shell-style.test.ts counts them in every .ts and .tsx under ui/src (tests excluded), and
// `npm run shell-style-budget` records the counts in shell-style-budget.json. A count only goes
// down; A11 takes them to zero.
//
// The categories:
//   small-text    text at 11 px or less (text-[11px], text-[0.625rem], fontSize: 10)
//   uppercase     the uppercase class
//   tracking      an arbitrary letter-spacing, tracking-[…]
//   raw-color     a hex or rgb()/rgba() inside a class's arbitrary value (accent-[#…], shadow-[…rgba(…)])
//   shadow        an arbitrary shadow, shadow-[…]
//   outline-none  outline-none in a class string with no visible focus (focus:ring, focus:border, …)
//   title         a title= tooltip on an element other than <iframe> (a component's title prop is not one)
//   violet        a violet class (bg-violet, ring-violet, …), which A11 replaces with the accent tokens
//   text-white    text-white, which A11 replaces with on-accent
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const SHELL_STYLE_ROOTS = ['ui/src'] as const;

/**
 * Files that show a sketch or a client's content rather than the studio's shell, and so are not
 * counted. The studio's sketch frames live in @roughbook/ui, so the local UI has none today.
 */
export const CONTENT_PREVIEWS: readonly string[] = [];

export const SHELL_STYLE_CATEGORIES = [
  'small-text',
  'uppercase',
  'tracking',
  'raw-color',
  'shadow',
  'outline-none',
  'title',
  'violet',
  'text-white'
] as const;

export type ShellStyleCategory = (typeof SHELL_STYLE_CATEGORIES)[number];
export type StyleCounts = Record<ShellStyleCategory, number>;
export type ShellStyleBudget = Record<string, Partial<StyleCounts>>;

const SMALL_TEXT_CLASS = /(?<![\w-])text-\[(\d*\.?\d+)(px|rem)\]/g;
const SMALL_TEXT_STYLE = /\bfontSize:\s*['"]?(\d*\.?\d+)(px|rem)?(?![\w.])/g;
const UPPERCASE = /(?<![\w-])uppercase(?![\w-])/g;
const TRACKING = /(?<![\w-])tracking-\[/g;
const RAW_COLOR = /\[[^\]\s'"`]*?(?:#[0-9a-fA-F]{3,8}(?![\w])|rgba?\()[^\]\s'"`]*\]/g;
const SHADOW = /(?<![\w-])shadow-\[/g;
const OUTLINE_NONE = /(?<![\w:-])outline-none(?![\w-])/g;
const VISIBLE_FOCUS =
  /\bfocus(?:-visible|-within)?:(?:ring|outline(?!-none)|border|shadow|bg-|underline|text-)/;
const VIOLET = /-violet(?![a-zA-Z0-9])/g;
const TEXT_WHITE = /(?<![\w-])text-white(?![\w-])/g;
const TAG = /<([a-zA-Z][\w.-]*)/g;

/** The source without its comment lines (//, /* … *\/ and JSX's {/* … *\/}). */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .filter(line => !/^\s*(?:\/\/|\/\*|\*|\{\s*\/\*)/.test(line))
    .join('\n');
}

function count(code: string, pattern: RegExp): number {
  return [...code.matchAll(pattern)].length;
}

function smallText(code: string): number {
  let found = 0;
  for (const pattern of [SMALL_TEXT_CLASS, SMALL_TEXT_STYLE]) {
    for (const match of code.matchAll(pattern)) {
      const size = Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
      if (size <= 11) found += 1;
    }
  }
  return found;
}

/** The string literal around an index: from the nearest quote before it to the same quote after. */
function enclosingLiteral(code: string, index: number): string {
  for (let start = index - 1; start >= 0; start -= 1) {
    const char = code[start]!;
    if (char === '"' || char === "'" || char === '`') {
      const end = code.indexOf(char, index);
      return code.slice(start + 1, end === -1 ? code.length : end);
    }
  }
  return code.slice(0, index);
}

function hiddenOutlines(code: string): number {
  let found = 0;
  for (const match of code.matchAll(OUTLINE_NONE)) {
    if (!VISIBLE_FOCUS.test(enclosingLiteral(code, match.index))) found += 1;
  }
  return found;
}

/** Whether an opening tag, read from just past its name, sets title= at its own level. */
function hasTitle(code: string, from: number): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let index = from; index < code.length; index += 1) {
    const char = code[index]!;
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    } else if (char === '>' && depth === 0) {
      return false;
    } else if (depth === 0 && /\s/.test(char) && code.startsWith('title=', index + 1)) {
      return true;
    }
  }
  return false;
}

function tooltips(code: string): number {
  let found = 0;
  for (const match of code.matchAll(TAG)) {
    const name = match[1]!;
    if (name === 'iframe' || /^[A-Z]/.test(name) || name.includes('.')) continue;
    if (hasTitle(code, match.index + 1 + name.length)) found += 1;
  }
  return found;
}

/** Each category's count in one source file. */
export function styleCounts(source: string): StyleCounts {
  const code = withoutComments(source);
  return {
    'small-text': smallText(code),
    uppercase: count(code, UPPERCASE),
    tracking: count(code, TRACKING),
    'raw-color': count(code, RAW_COLOR),
    shadow: count(code, SHADOW),
    'outline-none': hiddenOutlines(code),
    title: tooltips(code),
    violet: count(code, VIOLET),
    'text-white': count(code, TEXT_WHITE)
  };
}

/** Every non-test .ts and .tsx under the roots, by its path from the repo, and its counts. */
export function shellStyleCounts(root: string): Record<string, StyleCounts> {
  const counts: Record<string, StyleCounts> = {};
  for (const dir of SHELL_STYLE_ROOTS) {
    for (const entry of readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      const file = path.posix.join(dir, entry.split(path.sep).join('/'));
      if (CONTENT_PREVIEWS.includes(file)) continue;
      counts[file] = styleCounts(readFileSync(path.join(root, file), 'utf8'));
    }
  }
  return counts;
}

/** A file's non-zero counts, in category order, as a budget entry. */
export function budgetEntry(counts: StyleCounts): Partial<StyleCounts> {
  return Object.fromEntries(
    SHELL_STYLE_CATEGORIES.filter(category => counts[category] > 0).map(category => [
      category,
      counts[category]
    ])
  );
}

/** What breaks the budget: a category over its number, or a counted file with no entry. */
export function shellStyleProblems(
  counts: Record<string, StyleCounts>,
  budget: ShellStyleBudget
): string[] {
  const problems: string[] = [];
  for (const [file, fileCounts] of Object.entries(counts)) {
    const held = budgetEntry(fileCounts);
    const categories = Object.keys(held) as ShellStyleCategory[];
    if (categories.length === 0) continue;
    const allowed = budget[file];
    if (allowed === undefined) {
      const list = categories.map(category => `${held[category]} ${category}`).join(', ');
      problems.push(`${file} has ${list} and no budget entry.`);
      continue;
    }
    for (const category of categories) {
      const limit = allowed[category] ?? 0;
      if (held[category]! > limit) {
        problems.push(`${file} has ${held[category]} ${category}; its budget is ${limit}.`);
      }
    }
  }
  return problems;
}
