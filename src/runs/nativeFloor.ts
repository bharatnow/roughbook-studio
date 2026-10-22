// The craft floor for the native families (decision 23 of the frameworks plan): what a source scan
// can see in a Flutter, SwiftUI or Jetpack Compose iteration, each written for its own toolkit,
// since the markup floor (craftFloor.ts) reads JSX and CSS and would pass these by reading nothing.
// Placeholder copy, and icon-only buttons with no name for a screen reader: an IconButton with no
// tooltip in Flutter, a Button whose label is an Image with no accessibilityLabel in SwiftUI, an
// IconButton whose Icon says contentDescription = null in Compose. Each is a warning, named once
// per file with how often. The same rules as the backend's utils/compile/nativeFloor.ts, read from
// the files on this machine.
import type { Finding } from './types.js';

export const NATIVE_FAMILIES = ['flutter', 'swiftui', 'compose'] as const;
export type NativeFamily = (typeof NATIVE_FAMILIES)[number];

const SOURCES: Record<NativeFamily, RegExp> = {
  flutter: /\.dart$/i,
  swiftui: /\.swift$/i,
  compose: /\.kts?$/i
};

const PLACEHOLDER =
  /\blorem ipsum\b|\bdolor sit amet\b|\b(?:John|Jane) (?:Doe|Smith)\b|\bYour (?:Company|Name)\b|\bCompany Name\b/i;

const times = (n: number) => (n === 1 ? '' : ` (${n} of them)`);

/** The text from an opening bracket at `open` to its match, or null when it never closes. */
function balanced(text: string, open: number): { body: string; end: number } | null {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const close = pairs[text[open]!];
  if (!close) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let at = open; at < text.length; at += 1) {
    const char = text[at]!;
    if (quote) {
      if (char === '\\') at += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === text[open]) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return { body: text.slice(open + 1, at), end: at };
    }
  }
  return null;
}

/** The next non-space character at or after `from`, and where it is. */
function next(text: string, from: number): { char: string; at: number } | null {
  const match = /\S/.exec(text.slice(from));
  return match ? { char: match[0], at: from + match.index } : null;
}

/** Flutter: an IconButton (any of its forms) with no tooltip, which is its name. */
function flutterUnnamed(text: string): number {
  let count = 0;
  for (const match of text.matchAll(/\bIconButton(?:\.\w+)?\s*\(/g)) {
    const args = balanced(text, match.index + match[0].length - 1);
    if (args && !/\btooltip\s*:/.test(args.body) && !/\bSemantics\b/.test(args.body)) count += 1;
  }
  return count;
}

/** SwiftUI: a Button whose label is an Image alone, with no accessibilityLabel after it. */
function swiftUnnamed(text: string): number {
  let count = 0;
  for (const match of text.matchAll(/\bButton\s*(?=[({])/g)) {
    let at = match.index + match[0].length;
    let label: { body: string; end: number } | null = null;
    const first = next(text, at);
    if (!first) continue;
    if (first.char === '(') {
      const args = balanced(text, first.at);
      if (!args) continue;
      // Button("Title") or Button(title, systemImage:) carry their own name.
      if (/^\s*["A-Za-z_]/.test(args.body) && !/^\s*action\s*:/.test(args.body)) continue;
      at = args.end + 1;
      const trailing = next(text, at);
      if (trailing?.char === '{') label = balanced(text, trailing.at);
    } else {
      // Button { action } label: { label }
      const action = balanced(text, first.at);
      if (!action) continue;
      const after = /^\s*label\s*:\s*\{/.exec(text.slice(action.end + 1));
      if (after) label = balanced(text, action.end + after[0].length);
    }
    if (!label || !/\bImage\s*\(/.test(label.body) || /\b(?:Text|Label)\s*\(/.test(label.body)) {
      continue;
    }
    const tail = text.slice(label.end + 1, label.end + 400);
    if (!/^\s*(?:\.\w+(?:\([^()]*\))?\s*)*?\.accessibilityLabel\s*\(/.test(tail)) count += 1;
  }
  return count;
}

/** Compose: an IconButton whose Icon says contentDescription = null, and nothing else names it. */
function composeUnnamed(text: string): number {
  let count = 0;
  for (const match of text.matchAll(/\b(?:Filled|FilledTonal|Outlined)?IconButton\s*\(/g)) {
    const args = balanced(text, match.index + match[0].length - 1);
    if (!args) continue;
    const trailing = next(text, args.end + 1);
    const content = trailing?.char === '{' ? (balanced(text, trailing.at)?.body ?? '') : args.body;
    const unnamed =
      /\bcontentDescription\s*=\s*null\b/.test(content) &&
      !/\bText\s*\(/.test(content) &&
      !/\bsemantics\b|\bcontentDescription\s*=\s*"/.test(args.body);
    if (unnamed) count += 1;
  }
  return count;
}

const UNNAMED: Record<NativeFamily, { count: (text: string) => number; what: string }> = {
  flutter: { count: flutterUnnamed, what: 'an IconButton with no tooltip' },
  swiftui: {
    count: swiftUnnamed,
    what: 'a Button labelled by an Image alone with no accessibilityLabel'
  },
  compose: { count: composeUnnamed, what: 'an IconButton whose Icon has contentDescription = null' }
};

/** An icon-only button with no name, as a native family's code has one: what the warning names. */
export function unnamedButtonIn(family: NativeFamily): string {
  return UNNAMED[family].what;
}

/** The native floor's warnings for an iteration's files, file by file in the order given. */
export function nativeFloorFindings(files: Map<string, string>, family: NativeFamily): Finding[] {
  const findings: Finding[] = [];
  for (const [file, text] of files) {
    if (!SOURCES[family].test(file)) continue;
    if (PLACEHOLDER.test(text)) {
      findings.push({
        code: 'PLACEHOLDER_COPY',
        message: `${file} has placeholder copy, such as lorem ipsum or a stand-in name like Jane Doe.`
      });
    }
    const unnamed = UNNAMED[family].count(text);
    if (unnamed) {
      findings.push({
        code: 'ICON_BUTTON_UNNAMED',
        message: `${file} has an icon-only button with no name for a screen reader${times(unnamed)}: ${UNNAMED[family].what}.`
      });
    }
  }
  return findings;
}

/**
 * A native family's string literals as a reader sees them: the backslash before a quote or a
 * dollar sign dropped, so `Don\'t` in Dart and `\"Go\"` in Swift or Kotlin match the headline.
 */
export function unescapeNative(source: string): string {
  return source.replace(/\\(['"$])/g, '$1');
}
