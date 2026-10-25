// Which pages a Next.js app's proxy (middleware before Next.js 16) sends to a sign-in page, read
// from its source and never run (B1 of the brownfield plan): the paths its matcher names, and,
// from its code, the paths named around its sign-in redirect, less those it lets through before
// it. A proxy that runs on every path and redirects whatever it has not let through guards every
// page but those. A condition the file cannot answer leaves every page to the map run.
import { readText } from '../../map/walk.js';

const FILES = ['', 'src/'].flatMap(base =>
  ['proxy', 'middleware'].flatMap(name => ['.ts', '.js', '.mjs'].map(ext => `${base}${name}${ext}`))
);
/** The sign-in page a proxy names. */
const SIGN_IN_PAGE = /["'`](\/(?:log-?in|sign-?in|auth)\b[\w\-/]*)["'`]/i;
/** Where it sends a visitor to that page. */
const SIGN_IN_REDIRECT = /(?:new\s+URL|\.redirect)\s*\(\s*["'`]\/(?:log-?in|sign-?in|auth)\b/i;
/** A list's name that says what it holds, for a list no condition reaches. */
const PUBLIC_NAME = /public|open|guest|anonymous|unauth|exempt|whitelist|allow|ignored|skip/i;
const GUARDED_NAME = /protect|private|guard|secure|restrict/i;
/** Functions a condition may call that hide no path. */
const GLOBALS = new Set([
  'Boolean',
  'String',
  'Number',
  'URL',
  'RegExp',
  'decodeURIComponent',
  'encodeURIComponent'
]);
const KEYWORDS = new Set([
  'if',
  'typeof',
  'await',
  'new',
  'function',
  'return',
  'void',
  'in',
  'of'
]);
/** A condition that reads the address. */
const READS_PATH = /\b(pathname|nextUrl|url)\b/;

/** Where the string opening at `start` ends: the index after its closing quote. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let at = start + 1; at < text.length; at++) {
    if (text[at] === '\\') at += 1;
    else if (text[at] === quote) return at + 1;
    else if (quote !== '`' && text[at] === '\n') return at;
  }
  return text.length;
}

/** The source with its comments blanked and its strings kept, so a scan is fooled by neither. */
function withoutComments(text: string): string {
  let out = '';
  for (let at = 0; at < text.length;) {
    const char = text[at]!;
    if (char === '"' || char === "'" || char === '`') {
      const end = stringEnd(text, at);
      out += text.slice(at, end);
      at = end;
    } else if (char === '/' && (text[at + 1] === '/' || text[at + 1] === '*')) {
      const close = text[at + 1] === '/' ? text.indexOf('\n', at) : text.indexOf('*/', at + 2);
      const end = close === -1 ? text.length : text[at + 1] === '/' ? close : close + 2;
      out += text.slice(at, end).replace(/[^\n]/g, ' ');
      at = end;
    } else {
      out += char;
      at += 1;
    }
  }
  return out;
}

/** The index of the bracket that closes the one at `open`, or the end. */
function closing(code: string, open: number): number {
  let depth = 0;
  for (let at = open; at < code.length; at++) {
    const char = code[at]!;
    if (char === '"' || char === "'" || char === '`') {
      at = stringEnd(code, at) - 1;
    } else if ('([{'.includes(char)) {
      depth += 1;
    } else if (')]}'.includes(char)) {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return code.length;
}

/** Where the statement from `start` ends: a `;` or a finished line outside brackets, or the bracket it is in closing. */
function statementEnd(code: string, start: number): number {
  let depth = 0;
  for (let at = start; at < code.length; at++) {
    const char = code[at]!;
    if (char === '"' || char === "'" || char === '`') {
      at = stringEnd(code, at) - 1;
    } else if ('([{'.includes(char)) {
      depth += 1;
    } else if (')]}'.includes(char)) {
      if (depth === 0) return at;
      depth -= 1;
    } else if (depth === 0 && char === ';') {
      return at;
    } else if (
      depth === 0 &&
      char === '\n' &&
      !/(\|\||&&|[=(,?:>])\s*$/.test(code.slice(Math.max(start, at - 40), at)) &&
      !/^\s*(\|\||&&|[?:.+])/.test(code.slice(at + 1, at + 40))
    ) {
      return at;
    }
  }
  return code.length;
}

/** What the file defines by name: a constant's value, a function's body. */
function definitions(code: string): Map<string, string> {
  const defined = new Map<string, string>();
  for (const match of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=(?![=>])\s*/g
  )) {
    const from = match.index + match[0].length;
    defined.set(match[1]!, code.slice(from, statementEnd(code, from)));
  }
  for (const match of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const brace = code.indexOf('{', closing(code, match.index + match[0].length - 1));
    if (brace !== -1) defined.set(match[1]!, code.slice(brace, closing(code, brace) + 1));
  }
  return defined;
}

/** Each `if`: its condition, and where its body starts and ends. */
function branches(code: string): { condition: string; start: number; end: number }[] {
  const found: { condition: string; start: number; end: number }[] = [];
  for (const match of code.matchAll(/\bif\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = closing(code, open);
    let start = close + 1;
    while (/\s/.test(code[start] ?? '')) start += 1;
    const end = code[start] === '{' ? closing(code, start) + 1 : statementEnd(code, start) + 1;
    found.push({ condition: code.slice(open + 1, close), start, end });
  }
  return found;
}

/** A path a proxy names: the address itself (exact), or the address and everything under it. */
type Path = { path: string; exact: boolean };
type Named = Path & { negated: boolean };

/** A list the code tests with `.has()` or `.includes()` holds addresses matched exactly. */
function testsExactly(text: string): boolean {
  return /^\s*\.\s*(?:has|includes)\s*\(/.test(text);
}

/**
 * The paths a condition names, each with whether it is negated and matched exactly, through the
 * lists, constants and functions of the file it names; whether it reads the address at all; and
 * whether it tests a file name (an asset's dot), which frees no page. Null when it hands the address
 * to a function the file does not define, or tests it with a pattern that names no path.
 */
function pathsOf(
  text: string,
  defined: Map<string, string>,
  reached: Set<string>,
  context: { negated: boolean; exact: boolean; within: Set<string> } = {
    negated: false,
    exact: false,
    within: new Set()
  }
): { paths: Named[]; reads: boolean; assets: boolean } | null {
  const { negated, within } = context;
  const paths: Named[] = [];
  let reads = READS_PATH.test(text);
  let assets = false;
  for (const match of text.matchAll(/(["'`])(\/[^"'`\s]*)\1/g)) {
    const before = text.slice(0, match.index);
    const not =
      /!\s*[\w$.?]+\.(?:startsWith|endsWith|includes|has|test|match)\(\s*$/.test(before) ||
      /!==?\s*$/.test(before);
    const exact = /[=!]==?\s*$/.test(before)
      ? true
      : /startsWith\(\s*$/.test(before)
        ? false
        : context.exact ||
          testsExactly(text.slice(match.index + match[0].length).replace(/^[^)]*\]/, ''));
    paths.push({ path: match[2]!, negated: negated !== not, exact });
  }
  const bare = text.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
  // Patterns: one that tests a file's dot frees assets, one anchored at a first segment names it.
  for (const match of bare.matchAll(
    /(?<![\w$)\]"])\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])*)\/[dgimsuy]*/g
  )) {
    const source = match[1]!;
    if (source.includes('\\.')) {
      assets = true;
      continue;
    }
    const segment = /^\^\\\/([\w-]+)/.exec(source)?.[1];
    if (!segment) return null;
    paths.push({ path: `/${segment}`, negated, exact: false });
  }
  for (const match of bare.matchAll(/(!*)\s*(?<![.\w$])(new\s+)?([A-Za-z_$][\w$]*)(\s*\()?/g)) {
    const [, bang, made, name, call] = match;
    if (made || KEYWORDS.has(name!) || GLOBALS.has(name!)) continue;
    const value = defined.get(name!);
    if (value === undefined) {
      // A function from elsewhere: it may hide which paths it means when handed the address.
      if (!call) continue;
      const open = match.index + match[0].length - 1;
      if (READS_PATH.test(bare.slice(open, closing(bare, open) + 1))) return null;
      continue;
    }
    if (within.has(name!)) continue;
    reached.add(name!);
    const inner = pathsOf(value, defined, reached, {
      negated: negated !== (bang!.length % 2 === 1),
      exact: !call && testsExactly(bare.slice(match.index + match[0].length)),
      within: new Set([...within, name!])
    });
    if (!inner) return null;
    paths.push(...inner.paths);
    reads ||= inner.reads;
    assets ||= inner.assets;
  }
  return { paths, reads, assets };
}

/** Whether `address` is `path`, or under it when it is not matched exactly; the home page is only itself. */
function under(address: string, { path, exact }: Path): boolean {
  if (exact || path === '/') return address === path;
  return address === path || address.startsWith(`${path}/`);
}

/**
 * Whether an address needs a sign-in by the app's proxy: yes where it sends a visitor to a sign-in
 * page, no where it lets one through, null where it does not say. Null for every address when it
 * cannot tell.
 */
export function signInGuard(repo: string): ((address: string) => 'yes' | 'no' | null) | null {
  const file = FILES.find(name => readText(repo, name) !== null);
  if (!file) return null;
  const code = withoutComments(readText(repo, file)!);
  const signInPage = SIGN_IN_PAGE.exec(code)?.[1];
  if (!/\bredirect\s*\(/.test(code) || !signInPage) return null;

  // The paths its matcher names; none at all, or one for every path but the static files, is all.
  const matcher = /\bmatcher\s*:\s*(\[[^\]]*\]|["'][^"']+["'])/.exec(code)?.[1] ?? null;
  const entries = [...(matcher ?? '').matchAll(/["']([^"']+)["']/g)].map(match => match[1]!);
  const everyPath = matcher === null || entries.some(item => /^\/(\(|:path\*$)/.test(item));
  const guarded: Path[] = entries
    .filter(item => /^\/[\w\-/]*?(\/:path\*)?$/.test(item))
    .map(item => ({ path: item.replace(/\/:path\*$/, ''), exact: !item.endsWith('/:path*') }));
  const open: Path[] = [{ path: signInPage, exact: true }];

  // Its code: what the sign-in redirect's own conditions name is guarded, and what a branch that
  // lets the visitor through names is not; a negated test names the others.
  const defined = definitions(code);
  const reached = new Set<string>();
  const target = SIGN_IN_REDIRECT.exec(code)?.index ?? code.search(/\.redirect\s*\(/);
  for (const branch of branches(code)) {
    const around = branch.start <= target && target < branch.end;
    const through = !around && /NextResponse\.next\s*\(/.test(code.slice(branch.start, branch.end));
    if (!around && !through) continue;
    const named = pathsOf(branch.condition, defined, reached);
    if (!named || (named.reads && !named.paths.length && !named.assets)) return null;
    for (const { negated, ...path } of named.paths)
      (around !== negated ? guarded : open).push(path);
  }
  // A list no condition reaches says by its name what it holds.
  for (const [name, value] of defined) {
    if (reached.has(name) || !/^(?:new\s+Set\s*(?:<[^>]*>)?\s*\(\s*)?\[/.test(value)) continue;
    const exact = [...code.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].some(match =>
      testsExactly(code.slice(match.index + match[0].length))
    );
    const listed = [...value.matchAll(/["'`](\/[^"'`]*)["'`]/g)].map(match => ({
      path: match[1]!,
      exact
    }));
    if (PUBLIC_NAME.test(name)) open.push(...listed);
    else if (GUARDED_NAME.test(name)) guarded.push(...listed);
  }

  // What it lets through needs no sign-in; what it guards does; the rest the proxy leaves alone.
  const trim = (paths: Path[]) =>
    paths.map(({ path, exact }) => ({ path: path.replace(/(.)\/+$/, '$1'), exact }));
  const [guardedPaths, openPaths] = [trim(guarded), trim(open)];
  const isOpen = (address: string) => openPaths.some(path => under(address, path));
  if (guardedPaths.length) {
    return address =>
      isOpen(address) ? 'no' : guardedPaths.some(path => under(address, path)) ? 'yes' : null;
  }
  return everyPath ? address => (isOpen(address) ? 'no' : 'yes') : null;
}
