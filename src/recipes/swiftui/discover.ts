// What a SwiftUI app has (A13 of ROUGHBOOK-APPLE-PLAN.md, after B1 of the brownfield plan), read
// from text alone: no Swift, no Xcode, nothing run. The app's targets come from Package.swift and
// from an Xcode project's project.pbxproj (its build phases and Xcode 16's synchronized folders, test
// targets left out); then their Swift sources. The pages are the root view of each scene of the
// `@main` App (WindowGroup, Window, Settings), the children of a TabView or a NavigationSplitView's
// detail, and the destinations of NavigationLink and navigationDestination. A screen has no address,
// so a page's is null. A view whose body is a TabView or a split view is the shell: its own parts
// are Shared, as a root layout's are. A page's sections are the app's views its body renders, in
// order, through SwiftUI's stacks, its own helpers and the app's containers (a view generic over its
// content, whose content stands in its place); one rendered in a ForEach or a List's rows is an atom,
// as one in a `.map()` is elsewhere, and so is one an atom's folder or name says is. What it cannot
// place is named in missed: a view shown in a sheet, a page written inline, a file it cannot read,
// an app with no SwiftUI App.
import path from 'node:path';
import { humanName } from '../../map/build.js';
import { isAtom } from '../../map/kinds.js';
import type {
  ComponentKind,
  Discovered,
  DiscoverInput,
  FoundComponent,
  FoundPage,
  Missed
} from '../../map/types.js';
import { listFiles, readText } from '../../map/walk.js';

// ---------------------------------------------------------------------------------------------
// Swift as text

/**
 * The text with its comments and the insides of its string literals (plain, multi-line, raw and
 * interpolated) turned to spaces, newlines kept, so every position still points at the same code.
 */
export function blankSwift(text: string): string {
  const out = text.split('');
  const n = text.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  const isRawOpen = (at: number) => /^#+"/.test(text.slice(at, at + 12));
  // From a string's first character (a quote or a raw string's #), to just past its end.
  const skipString = (start: number): number => {
    let j = start;
    let hashes = 0;
    while (text[j] === '#') {
      hashes += 1;
      j += 1;
    }
    const multi = text.startsWith('"""', j);
    j += multi ? 3 : 1;
    const close = `${multi ? '"""' : '"'}${'#'.repeat(hashes)}`;
    const escape = `\\${'#'.repeat(hashes)}`;
    const from = j;
    while (j < n) {
      if (text.startsWith(escape, j)) {
        const after = j + escape.length;
        if (text[after] === '(') {
          let depth = 1;
          let k = after + 1;
          while (k < n && depth > 0) {
            if (text[k] === '"' || (text[k] === '#' && isRawOpen(k))) {
              k = skipString(k);
              continue;
            }
            if (text[k] === '(') depth += 1;
            else if (text[k] === ')') depth -= 1;
            k += 1;
          }
          j = k;
        } else j = after + 1;
        continue;
      }
      if (text.startsWith(close, j)) {
        blank(from, j);
        return j + close.length;
      }
      if (!multi && text[j] === '\n') break;
      j += 1;
    }
    blank(from, j);
    return j;
  };
  let i = 0;
  while (i < n) {
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (text.startsWith('/*', i)) {
      let depth = 1;
      let k = i + 2;
      while (k < n && depth > 0) {
        if (text.startsWith('/*', k)) {
          depth += 1;
          k += 2;
        } else if (text.startsWith('*/', k)) {
          depth -= 1;
          k += 2;
        } else k += 1;
      }
      blank(i, k);
      i = k;
    } else if (text[i] === '"' || (text[i] === '#' && isRawOpen(i))) {
      i = skipString(i);
    } else i += 1;
  }
  return out.join('');
}

const PAIRS: Record<string, string> = { '(': ')', '{': '}', '[': ']' };

/** Where the bracket at `open` closes in blanked text, or -1 when it never does. */
function closeOf(text: string, open: number): number {
  const opener = text[open]!;
  const closer = PAIRS[opener]!;
  let depth = 0;
  for (let k = open; k < text.length; k += 1) {
    if (text[k] === opener) depth += 1;
    else if (text[k] === closer) {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// Targets

/** The Swift files a target compiles, by package manifest or Xcode project. */
type Targets = { files: Set<string>; manifests: string[]; missed: Missed[] };

function joinPath(base: string, own: string): string | null {
  const joined = path.posix.normalize(path.posix.join(base || '.', own || '.'));
  if (joined === '.' || joined === './') return '';
  if (joined.startsWith('..') || path.posix.isAbsolute(joined)) return null;
  return joined.replace(/^\.\//, '').replace(/\/+$/, '');
}

const under = (folder: string, file: string) => !folder || file.startsWith(`${folder}/`);

/** The non-test targets a Package.swift declares, each with its sources' folder. */
function packageTargets(manifest: string, text: string, files: string[]): string[] | null {
  const clean = blankSwift(text);
  const dir = path.posix.dirname(manifest) === '.' ? '' : path.posix.dirname(manifest);
  const folders: string[] = [];
  let count = 0;
  for (const match of clean.matchAll(
    /\.(target|executableTarget|testTarget|macro|plugin|binaryTarget|systemLibrary)\s*\(/g
  )) {
    const open = match.index + match[0].length - 1;
    const close = closeOf(clean, open);
    if (close < 0) continue;
    count += 1;
    if (match[1] !== 'target' && match[1] !== 'executableTarget') continue;
    const args = text.slice(open + 1, close);
    const name = /\bname\s*:\s*"([^"]+)"/.exec(args)?.[1];
    if (!name) continue;
    const own = /\bpath\s*:\s*"([^"]+)"/.exec(args)?.[1];
    const candidates = own
      ? [own]
      : ['Sources', 'Source', 'src', 'srcs'].map(root => `${root}/${name}`);
    const folder = candidates
      .map(candidate => joinPath(dir, candidate))
      .find(
        (candidate): candidate is string =>
          candidate !== null && files.some(file => under(candidate, file))
      );
    if (folder !== undefined) folders.push(folder);
  }
  return count ? folders : null;
}

type Plist = string | Plist[] | { [key: string]: Plist };

/** Xcode's old-style property list (project.pbxproj), or a thrown error where it does not parse. */
function parsePlist(text: string): Plist {
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`${what} at character ${i}`);
  };
  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i += 1;
      if (text.startsWith('//', i)) {
        const end = text.indexOf('\n', i);
        i = end < 0 ? text.length : end;
      } else if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        if (end < 0) fail('an unclosed comment');
        i = end + 2;
      } else return;
    }
  };
  const value = (): Plist => {
    skip();
    const c = text[i];
    if (c === undefined) return fail('the end of the file');
    if (c === '{') {
      i += 1;
      const dict: Record<string, Plist> = {};
      for (;;) {
        skip();
        if (text[i] === '}') {
          i += 1;
          return dict;
        }
        const key = value();
        if (typeof key !== 'string') fail('a key that is not a string');
        skip();
        if (text[i] !== '=') fail('a missing =');
        i += 1;
        dict[key as string] = value();
        skip();
        if (text[i] !== ';') fail('a missing ;');
        i += 1;
      }
    }
    if (c === '(') {
      i += 1;
      const list: Plist[] = [];
      for (;;) {
        skip();
        if (text[i] === ')') {
          i += 1;
          return list;
        }
        list.push(value());
        skip();
        if (text[i] === ',') i += 1;
        else if (text[i] !== ')') fail('a missing ,');
      }
    }
    if (c === '"') {
      i += 1;
      let result = '';
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          i += 1;
          const escaped = text[i];
          result += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : (escaped ?? '');
        } else result += text[i];
        i += 1;
      }
      if (text[i] !== '"') fail('an unclosed string');
      i += 1;
      return result;
    }
    const start = i;
    while (
      i < text.length &&
      !/[\s;,=(){}"]/.test(text[i]!) &&
      !text.startsWith('/*', i) &&
      !text.startsWith('//', i)
    ) {
      i += 1;
    }
    if (i === start) fail(`an unexpected ${c}`);
    return text.slice(start, i);
  };
  const root = value();
  skip();
  if (i < text.length) fail('text after the end');
  return root;
}

type PbxObject = Record<string, Plist>;

const str = (value: Plist | undefined): string | null => (typeof value === 'string' ? value : null);
const list = (value: Plist | undefined): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The Swift files an Xcode project's app and framework targets compile, never its tests'. */
function xcodeSources(pbxproj: string, text: string, files: string[]): string[] {
  const root = parsePlist(text);
  if (typeof root !== 'object' || Array.isArray(root)) throw new Error('no objects');
  const objects = root.objects as Record<string, PbxObject> | undefined;
  const project = objects?.[str(root.rootObject) ?? ''];
  if (!objects || !project) throw new Error('no project object');
  // The folder that holds the .xcodeproj, repo-relative.
  const projectDir = path.posix.dirname(path.posix.dirname(pbxproj));
  const base = projectDir === '.' ? '' : projectDir;
  const parent = new Map<string, string>();
  for (const [id, object] of Object.entries(objects)) {
    for (const child of list(object.children)) parent.set(child, id);
  }
  const folderOf = (id: string, depth = 0): string | null => {
    const object = objects[id];
    if (!object || depth > 64) return null;
    const tree = str(object.sourceTree) ?? '<group>';
    const own = str(object.path) ?? '';
    if (tree === 'SOURCE_ROOT') return joinPath(base, own);
    if (tree !== '<group>') return null;
    const up = parent.get(id);
    const above = up ? folderOf(up, depth + 1) : base;
    return above === null ? null : joinPath(above, own);
  };
  const found: string[] = [];
  for (const id of list(project.targets)) {
    const target = objects[id];
    if (!target || str(target.isa) !== 'PBXNativeTarget') continue;
    if (/test/i.test(str(target.productType) ?? '')) continue;
    for (const phaseId of list(target.buildPhases)) {
      const phase = objects[phaseId];
      if (str(phase?.isa) !== 'PBXSourcesBuildPhase') continue;
      for (const buildFile of list(phase!.files)) {
        const ref = str(objects[buildFile]?.fileRef);
        const file = ref ? folderOf(ref) : null;
        if (file && file.endsWith('.swift')) found.push(file);
      }
    }
    for (const groupId of list(target.fileSystemSynchronizedGroups)) {
      const folder = folderOf(groupId);
      if (folder === null) continue;
      const left = new Set<string>();
      for (const exceptionId of list(objects[groupId]?.exceptions)) {
        const exception = objects[exceptionId];
        if (str(exception?.target) !== id) continue;
        for (const item of list(exception!.membershipExceptions)) {
          const file = joinPath(folder, item);
          if (file !== null) left.add(file);
        }
      }
      for (const file of files) {
        if (file.endsWith('.swift') && under(folder, file) && !left.has(file)) found.push(file);
      }
    }
  }
  return found;
}

function readTargets(input: DiscoverInput, files: string[]): Targets {
  const targets: Targets = { files: new Set(), manifests: [], missed: [] };
  for (const manifest of files.filter(file => /(^|\/)Package\.swift$/.test(file))) {
    const text = readText(input.repo, manifest);
    if (text === null) continue;
    targets.manifests.push(manifest);
    const folders = packageTargets(manifest, text, files);
    if (folders === null) {
      targets.missed.push({ what: manifest, why: 'names no target the discoverer can read' });
      continue;
    }
    for (const file of files) {
      if (file.endsWith('.swift') && folders.some(folder => under(folder, file))) {
        targets.files.add(file);
      }
    }
  }
  for (const pbxproj of files.filter(file => /\.xcodeproj\/project\.pbxproj$/.test(file))) {
    const text = readText(input.repo, pbxproj);
    if (text === null) continue;
    targets.manifests.push(pbxproj);
    try {
      for (const file of xcodeSources(pbxproj, text, files)) targets.files.add(file);
    } catch (error) {
      targets.missed.push({
        what: pbxproj,
        why: `could not be read, so its targets are not known: ${(error as Error).message}`
      });
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------------------------
// Views

type Block = { file: string; start: number; end: number };

type SwiftView = {
  name: string;
  file: string;
  /** Generic over its content (`Card<Content: View>`): what it is handed stands in its place. */
  container: boolean;
  /** `body` and every property or function that returns `some View` (or a Scene), by name. */
  helpers: Map<string, Block>;
};

type Declared = {
  views: Map<string, SwiftView>;
  apps: SwiftView[];
  /** A UIKit or AppKit application delegate marked @main, by file. */
  delegates: string[];
  /** Each file's blanked text. */
  texts: Map<string, string>;
  /** The views each file declares, by name. */
  byFile: Map<string, string[]>;
  missed: Missed[];
};

const DECLARATION =
  /((?:@\w+(?:\([^()]*\))?\s*)*)(?:\b(?:public|private|fileprivate|internal|open|final|nonisolated|indirect)\s+)*\b(struct|class|enum|extension|actor)\s+([A-Za-z_][\w.]*)\s*(<[^{}]*?>)?\s*(?::\s*([^{}]*?))?\s*\{/g;

const MEMBER = /\b(var|func)\s+([A-Za-z_]\w*)\b([^{};=]*?)\{/g;

function declare(input: DiscoverInput, sources: string[]): Declared {
  const declared: Declared = {
    views: new Map(),
    apps: [],
    delegates: [],
    texts: new Map(),
    byFile: new Map(),
    missed: []
  };
  const extensions: { name: string; file: string; helpers: Map<string, Block> }[] = [];
  for (const file of sources) {
    const raw = readText(input.repo, file);
    if (raw === null) continue;
    const text = blankSwift(raw);
    type Type = {
      kind: string;
      name: string;
      attributes: string;
      generics: string;
      inherits: string;
      open: number;
      close: number;
    };
    const types: Type[] = [];
    let broken = closeOf(`{${text}}`, 0) !== text.length + 1;
    for (const match of text.matchAll(DECLARATION)) {
      const open = match.index + match[0].length - 1;
      const close = closeOf(text, open);
      if (close < 0) {
        broken = true;
        break;
      }
      types.push({
        kind: match[2]!,
        name: match[3]!,
        attributes: match[1] ?? '',
        generics: match[4] ?? '',
        inherits: match[5] ?? '',
        open,
        close
      });
    }
    if (broken) {
      declared.missed.push({
        what: file,
        why: 'could not be read (its braces do not close), so its views are not known',
        unread: true
      });
      continue;
    }
    declared.texts.set(file, text);
    const helpers = new Map<Type, Map<string, Block>>(types.map(type => [type, new Map()]));
    for (const match of text.matchAll(MEMBER)) {
      const signature = match[3] ?? '';
      if (!/\bsome\s+(?:View|Scene)\b|\bAnyView\b/.test(signature)) continue;
      if (/\b(?:var|let|func)\b/.test(signature)) continue;
      const open = match.index + match[0].length - 1;
      const close = closeOf(text, open);
      if (close < 0) continue;
      // The innermost type it sits in.
      const owner = types
        .filter(type => type.open < match.index && match.index < type.close)
        .sort((a, b) => a.close - a.open - (b.close - b.open))[0];
      if (owner) helpers.get(owner)!.set(match[2]!, { file, start: open + 1, end: close });
    }
    for (const type of types) {
      const main = /@main\b|@UIApplicationMain\b|@NSApplicationMain\b/.test(type.attributes);
      if (type.kind === 'extension') {
        extensions.push({ name: type.name, file, helpers: helpers.get(type)! });
        continue;
      }
      if (main && /\b(?:UI|NS)ApplicationDelegate\b/.test(type.inherits)) {
        declared.delegates.push(file);
        continue;
      }
      const view: SwiftView = {
        name: type.name,
        file,
        container: /\bView\b/.test(type.generics),
        helpers: helpers.get(type)!
      };
      if (main && /\bApp\b/.test(type.inherits)) declared.apps.push(view);
      else if (type.kind === 'struct' && /\bView\b/.test(type.inherits)) {
        if (!declared.views.has(view.name)) declared.views.set(view.name, view);
        declared.byFile.set(file, [...(declared.byFile.get(file) ?? []), view.name]);
      }
    }
  }
  for (const extension of extensions) {
    const view =
      declared.views.get(extension.name) ?? declared.apps.find(app => app.name === extension.name);
    if (!view) continue;
    for (const [name, block] of extension.helpers) {
      if (!view.helpers.has(name)) view.helpers.set(name, block);
    }
  }
  return declared;
}

/**
 * Where a view the walk finds sits: on the page, in a list's rows, a page of its own reached by a
 * tab or a split view's detail (the shell's), a page navigated to, or shown in a sheet.
 */
type Place = 'section' | 'item' | 'tab' | 'destination' | 'presented';

type Rendered = { view: SwiftView; place: Place; container: boolean };

const KEYWORDS = new Set([
  'if',
  'else',
  'guard',
  'switch',
  'case',
  'default',
  'for',
  'while',
  'repeat',
  'return',
  'let',
  'var',
  'in',
  'where',
  'some',
  'any',
  'try',
  'await',
  'func',
  'true',
  'false',
  'nil',
  'do',
  'catch',
  'throw',
  'is',
  'as',
  'self',
  'Self',
  'super'
]);

const PRESENTERS = new Set(['sheet', 'fullScreenCover', 'popover', 'inspector']);

type Span = { start: number; end: number };
type Closure = Span & { label: string };

/** The app's views a block renders, in order, with where each sits. */
function rendered(declared: Declared, owner: SwiftView, block: Block): Rendered[] {
  const out: Rendered[] = [];
  const walking = new Set<string>();
  const text = declared.texts.get(block.file);
  if (text === undefined) return out;

  const walk = (range: Span, place: Place, helperOwner: SwiftView, file: string) => {
    const s = declared.texts.get(file)!;
    let i = range.start;
    while (i < range.end) {
      const c = s[i]!;
      if (!/[A-Za-z_]/.test(c) || (i > 0 && /[\w$#@]/.test(s[i - 1]!))) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < range.end && /\w/.test(s[j]!)) j += 1;
      const name = s.slice(i, j);
      let p = i - 1;
      while (p >= 0 && /\s/.test(s[p]!)) p -= 1;
      const member = p >= 0 && s[p] === '.';
      if (!member && KEYWORDS.has(name)) {
        i = j;
        continue;
      }
      // The call's arguments and trailing closures, labelled ones included.
      let k = j;
      let args: Span | null = null;
      if (s[k] === '(') {
        const close = closeOf(s, k);
        if (close > 0 && close < range.end) {
          args = { start: k + 1, end: close };
          k = close + 1;
        }
      }
      const closures: Closure[] = [];
      for (;;) {
        let m = k;
        while (m < range.end && (s[m] === ' ' || s[m] === '\t')) m += 1;
        if (s[m] === '{') {
          const close = closeOf(s, m);
          if (close < 0 || close >= range.end) break;
          closures.push({ label: '', start: m + 1, end: close });
          k = close + 1;
          continue;
        }
        const labelled = closures.length
          ? /^\s*([a-z]\w*)\s*:\s*\{/.exec(s.slice(k, Math.min(range.end, k + 200)))
          : null;
        if (labelled) {
          const open = k + labelled[0].length - 1;
          const close = closeOf(s, open);
          if (close < 0 || close >= range.end) break;
          closures.push({ label: labelled[1]!, start: open + 1, end: close });
          k = close + 1;
          continue;
        }
        break;
      }
      const all = (ranges: Span[], at: Place) => {
        for (const item of ranges) walk(item, at, helperOwner, file);
      };
      const parts = [...(args ? [args] : []), ...closures];
      const view = member ? undefined : declared.views.get(name);

      if (view && (args || closures.length || s.startsWith('.init', j))) {
        out.push({ view, place, container: view.container });
        // A container's content is the page's; any other view's arguments are its own.
        if (view.container) all(parts, place);
        i = k;
        continue;
      }
      if (member && name === 'navigationDestination') {
        all(parts, 'destination');
        i = k;
        continue;
      }
      if (member && PRESENTERS.has(name)) {
        all(parts, 'presented');
        i = k;
        continue;
      }
      if (!member && name === 'TabView') {
        if (args) walk(args, place, helperOwner, file);
        all(closures, 'tab');
        i = k;
        continue;
      }
      if (!member && name === 'NavigationSplitView') {
        // The sidebar is the shell's; the content and detail columns are its pages.
        closures.forEach((closure, index) =>
          walk(closure, index === 0 && !closure.label ? place : 'tab', helperOwner, file)
        );
        i = k;
        continue;
      }
      if (!member && name === 'NavigationLink') {
        if (args) {
          walk(
            args,
            /\bdestination\s*:/.test(s.slice(args.start, args.end)) ? 'destination' : place,
            helperOwner,
            file
          );
        }
        closures.forEach((closure, index) => {
          const destination =
            closure.label === 'destination' ||
            (closures.length > 1 && index === 0 && !closure.label);
          walk(closure, destination ? 'destination' : place, helperOwner, file);
        });
        i = k;
        continue;
      }
      const rows =
        !member &&
        (name === 'ForEach' ||
          (name === 'List' &&
            args !== null &&
            closures.length > 0 &&
            /^\s*(?:\w+|\([^)]*\))\s+in\b|\$0/.test(
              s.slice(closures[0]!.start, closures[0]!.end)
            )));
      if (rows) {
        if (args) walk(args, place, helperOwner, file);
        all(closures, place === 'section' ? 'item' : place);
        i = k;
        continue;
      }
      // The view's own helper (`header`, `row(for:)`): what it renders is the view's.
      const helper = member ? undefined : helperOwner.helpers.get(name);
      if (helper && name !== 'body') {
        const key = `${helperOwner.name}.${name}`;
        if (!walking.has(key)) {
          walking.add(key);
          walk(helper, place, helperOwner, helper.file);
          walking.delete(key);
        }
      }
      // Anything else (SwiftUI's own views, modifiers, conditions): read straight through.
      i = j;
    }
  };
  walk(block, 'section', owner, block.file);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The discoverer

function pageName(view: SwiftView): string {
  return humanName(view.name.replace(/(?<=.)(View|Screen|Page)$/, ''));
}

export async function discoverSwift(input: DiscoverInput): Promise<Discovered> {
  const files = listFiles(input);
  const targets = readTargets(input, files);
  const missed: Missed[] = [...targets.missed];
  const result = (pages: FoundPage[], components: FoundComponent[], unplaced: string[]) => ({
    by: 'swiftui',
    pages,
    components,
    missed,
    unplaced
  });
  if (!targets.manifests.length) {
    missed.push({
      what: '.',
      why: "no Package.swift or Xcode project names the app's targets, so no Swift was read"
    });
    return result([], [], []);
  }
  const sources = [...targets.files].sort();
  const declared = declare(input, sources);
  missed.push(...declared.missed);

  const reached = new Set<SwiftView>();
  const unplacedFiles = () =>
    [...declared.byFile.entries()]
      .filter(([, names]) => !names.some(name => reached.has(declared.views.get(name)!)))
      .map(([file]) => file)
      .sort();

  if (!declared.apps.length) {
    for (const file of declared.delegates) {
      missed.push({
        what: file,
        why: 'a UIKit or AppKit app (its application delegate is its @main), whose screens the discoverer cannot follow: the map run reads them'
      });
    }
    if (!declared.delegates.length) {
      missed.push({
        what: targets.manifests[0]!,
        why: 'no @main App in its targets, so which views are screens is not known: the map run places them'
      });
    }
    return result([], [], unplacedFiles());
  }

  const components = new Map<string, FoundComponent>();
  const keep = (view: SwiftView, kind: ComponentKind): string => {
    const key = `${view.file}#${view.name}`;
    if (!components.has(key)) {
      components.set(key, {
        key,
        name: view.name,
        kind: isAtom(view.file, view.name) ? 'atom' : kind,
        files: [view.file],
        export: view.name,
        fixture: null,
        fixtureFrom: null
      });
    }
    return key;
  };
  const atom = (view: SwiftView) => isAtom(view.file, view.name);
  const bodyOf = (view: SwiftView): Rendered[] => {
    const body = view.helpers.get('body');
    return body ? rendered(declared, view, body) : [];
  };

  const queued = new Set<SwiftView>();
  const presented = new Set<SwiftView>();
  /** Pages found under what is being read now, to be read right after it. */
  let next: SwiftView[] = [];
  const enqueue = (view: SwiftView) => {
    if (queued.has(view)) return;
    queued.add(view);
    next.push(view);
  };
  const explored = new Set<SwiftView>();
  /** Every view below one already placed: atoms by name or in rows, pages it navigates to. */
  const explore = (view: SwiftView) => {
    reached.add(view);
    if (explored.has(view)) return;
    explored.add(view);
    for (const item of bodyOf(view)) note(item, view);
  };
  const note = (item: Rendered, from: SwiftView) => {
    if (item.place === 'tab' || item.place === 'destination') {
      if (!item.container) enqueue(item.view);
      reached.add(item.view);
      if (item.container) explore(item.view);
      return;
    }
    if (item.place === 'presented') {
      if (!presented.has(item.view)) {
        presented.add(item.view);
        missed.push({
          what: item.view.file,
          why: `${item.view.name} is shown in a sheet from ${from.name}, so it is on no page: the map run decides where it goes`
        });
      }
      explore(item.view);
      return;
    }
    if (!item.container && (item.place === 'item' || atom(item.view))) keep(item.view, 'atom');
    explore(item.view);
  };

  const roots: SwiftView[] = [];
  for (const app of declared.apps) {
    reached.add(app);
    for (const scene of app.helpers.has('body') ? bodyOf(app) : []) {
      if (scene.place === 'presented') note(scene, app);
      else if (scene.container) explore(scene.view);
      else if (!roots.includes(scene.view)) roots.push(scene.view);
    }
  }
  if (!roots.length) {
    missed.push({
      what: declared.apps[0]!.file,
      why: `${declared.apps[0]!.name} shows none of the app's views in a scene, so its screens are not known: the map run places them`
    });
  }

  const shared: FoundPage = {
    address: null,
    name: null,
    files: [],
    sections: [],
    signIn: 'unknown',
    example: null
  };
  const pages: FoundPage[] = [];
  const queue = [...roots, ...next.filter(view => !roots.includes(view))];
  for (const root of roots) queued.add(root);
  while (queue.length) {
    const view = queue.shift()!;
    reached.add(view);
    explored.add(view);
    next = [];
    const found = bodyOf(view);
    const shell = found.some(item => item.place === 'tab');
    const sections: string[] = [];
    const files = [view.file];
    let own = found;
    // A page that renders one view of two sections or more gets that view's sections.
    for (let depth = 0; !shell && depth < 4; depth += 1) {
      const placed = own.filter(item => item.place === 'section' && !item.container);
      if (placed.length !== 1 || atom(placed[0]!.view)) break;
      const inner = bodyOf(placed[0]!.view);
      if (inner.some(item => item.place === 'tab')) break;
      if (inner.filter(item => item.place === 'section' && !item.container).length < 2) break;
      const one = placed[0]!.view;
      reached.add(one);
      explored.add(one);
      if (!files.includes(one.file)) files.push(one.file);
      own = [...own.filter(item => item !== placed[0]), ...inner];
    }
    for (const item of own) {
      if (item.place === 'section' && !item.container && !atom(item.view)) {
        const key = keep(item.view, shell ? 'shared' : 'section');
        const into = shell ? shared.sections : sections;
        if (!into.includes(key)) into.push(key);
        explore(item.view);
      } else note(item, view);
    }
    if (shell) {
      if (own.some(item => item.place === 'section' && !item.container && !atom(item.view))) {
        if (!shared.files.includes(view.file)) shared.files.push(view.file);
      }
    } else {
      pages.push({
        address: null,
        name: pageName(view),
        files,
        sections,
        signIn: 'unknown',
        example: null
      });
      if (!sections.length) {
        missed.push({
          what: view.file,
          why: `${view.name}'s content is written inline, from SwiftUI's own views, so it has no section of its own to show alone`
        });
      }
    }
    queue.unshift(...next);
  }
  if (shared.sections.length) pages.unshift(shared);
  return result(pages, [...components.values()], unplacedFiles());
}
