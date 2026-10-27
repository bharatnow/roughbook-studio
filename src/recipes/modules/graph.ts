// The import graph of a JavaScript app and what each of its components renders, for the
// discoverers of the stacks that are modules (Next.js, Expo, Vite with React). esbuild bundles
// every route at once without writing anything, its metafile gives each file's imports as
// resolved (tsconfig paths and all), and packages stay external, so nothing needs installing
// (decision 19 of the brownfield plan measured it on repos with no node_modules). Each file a page
// is made of is then read through esbuild's JSX transform, where every element is a call to one
// function in source order: `<Hero title="x" />` becomes `__rb(Hero, { title: "x" })`, and nesting
// is in the parentheses. Reading only: nothing is written, and none of the app's code runs.
import {
  build,
  transform,
  transformSync,
  type Loader,
  type Plugin,
  type TransformOptions
} from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DiscoverMemo, MemoImport } from '../../map/types.js';
import { readText } from '../../map/walk.js';

/** One import of a file, as the metafile has it: a repo file, or something outside it. */
export type GraphImport = MemoImport;

export type ModuleGraph = {
  /** Every repo file the entries reach, with its imports. */
  inputs: Map<string, GraphImport[]>;
  /** Entries esbuild could not read, with its first message. */
  failed: Map<string, string>;
  /** With a memo: the files whose stamp changed since it was kept, read again; null for all. */
  changed?: Set<string> | null;
};

export const CODE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.mts', '.cts'];

/** Assets a component imports, which the graph never needs to read. */
const ASSET =
  /\.(css|scss|sass|less|styl|pcss|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|json|md|mdx|txt|html|glsl|wasm|graphql|gql|ya?ml)(\?.*)?$/i;

/** A bare import's package name: `react-dom/client` is react-dom, `@radix-ui/react-tabs/x` is the scoped name. */
function packageName(spec: string): string | null {
  if (/^[./]/.test(spec) || /^[a-z]:/i.test(spec) || spec.includes(':')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? (parts.length > 1 ? `${parts[0]}/${parts[1]}` : null) : parts[0]!;
}

/**
 * Resolves as esbuild would, and leaves outside what is not the repo's own: a package, a file in
 * node_modules, an asset, or an import that does not resolve (a package not installed). An import
 * of a package the repo has installed is left outside at once, unresolved: resolving each one into
 * node_modules only to leave it there tripled a large app's map.
 */
function repoOnly(repo: string): Plugin {
  const installed = new Map<string, boolean>();
  const isInstalled = (name: string) => {
    if (!installed.has(name)) {
      installed.set(name, existsSync(path.join(repo, 'node_modules', ...name.split('/'))));
    }
    return installed.get(name)!;
  };
  return {
    name: 'roughbook-repo-only',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, async args => {
        if (args.pluginData?.roughbookInner) return undefined;
        if (args.kind === 'entry-point') return undefined;
        if (ASSET.test(args.path)) return { path: args.path, external: true };
        const name = packageName(args.path);
        if (name && isInstalled(name)) return { path: args.path, external: true };
        const resolved = await builder.resolve(args.path, {
          kind: args.kind,
          resolveDir: args.resolveDir,
          importer: args.importer,
          pluginData: { roughbookInner: true }
        });
        if (resolved.errors.length || !resolved.path || resolved.external) {
          return { path: args.path, external: true };
        }
        if (resolved.path.split(path.sep).includes('node_modules')) {
          return { path: args.path, external: true };
        }
        if (!CODE_EXTENSIONS.includes(path.extname(resolved.path))) {
          return { path: args.path, external: true };
        }
        return resolved;
      });
    }
  };
}

/**
 * TypeScript read with its legacy decorators allowed, as an app whose tsconfig.json turns them on
 * in a way esbuild does not see (a server's parameter decorators beside the pages): each file is
 * first transformed alone, its JSX kept, so the bundle only follows its imports.
 */
const decorated: Plugin = {
  name: 'roughbook-decorators',
  setup(builder) {
    builder.onLoad({ filter: /\.(ts|tsx|mts|cts)$/ }, async args => {
      const source = await readFile(args.path, 'utf8');
      const tsx = args.path.endsWith('.tsx');
      const { code } = transformSync(source, {
        loader: tsx ? 'tsx' : 'ts',
        jsx: 'preserve',
        tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
        logLevel: 'silent'
      });
      return { contents: code, loader: tsx ? 'jsx' : 'js' };
    });
  }
};

/**
 * Leaves outside every import of a file not being read again, so a refresh resolves only the
 * changed files' imports (B7): the files they import are loaded, never followed.
 */
function onlyFrom(repo: string, files: string[]): Plugin {
  const reading = new Set(files.map(file => path.join(repo, ...file.split('/'))));
  return {
    name: 'roughbook-only-from',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.pluginData?.roughbookInner || args.kind === 'entry-point') return undefined;
        return reading.has(args.importer) ? undefined : { path: args.path, external: true };
      });
    }
  };
}

async function graphOf(
  repo: string,
  entries: string[],
  options: { decorators?: boolean; only?: boolean } = {}
): Promise<{ inputs: Map<string, GraphImport[]> } | { error: string }> {
  const plugins = [repoOnly(repo), ...(options.decorators ? [decorated] : [])];
  if (options.only) plugins.unshift(onlyFrom(repo, entries));
  try {
    const result = await build({
      absWorkingDir: repo,
      entryPoints: entries,
      bundle: true,
      write: false,
      metafile: true,
      outdir: 'roughbook-map',
      format: 'esm',
      platform: 'neutral',
      mainFields: ['module', 'main'],
      logLevel: 'silent',
      jsx: 'preserve',
      loader: { '.js': 'jsx', '.mjs': 'jsx', '.cjs': 'jsx' },
      plugins
    });
    const inputs = new Map<string, GraphImport[]>();
    for (const [file, input] of Object.entries(result.metafile.inputs)) {
      inputs.set(
        file,
        input.imports.map(item => ({
          path: item.path,
          original: item.original ?? null,
          external: Boolean(item.external)
        }))
      );
    }
    return { inputs };
  } catch (error) {
    const failure = error as { errors?: { text: string; location?: { file?: string } }[] };
    const first = failure.errors?.[0];
    return {
      error: first
        ? `${first.location?.file ? `${first.location.file}: ` : ''}${first.text}`
        : error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

/**
 * The graph from every entry at once; when one of them does not read, each alone, so one broken
 * file leaves the rest of the map standing and is named with esbuild's reason. With a memo of the
 * last reading and the files' stamps now, only what changed is read again (B7), and the memo is
 * brought up to date.
 */
export async function buildGraph(
  repo: string,
  entries: string[],
  kept?: { memo: DiscoverMemo; stamps: Map<string, string> }
): Promise<ModuleGraph> {
  if (kept && kept.memo.imports.size && !settingsChanged(kept.memo.stamps, kept.stamps)) {
    return graphAgain(repo, entries, kept.memo, kept.stamps);
  }
  const inputs = new Map<string, GraphImport[]>();
  const failed = new Map<string, string>();
  const remember = (decorators: boolean) => {
    if (!kept) return;
    kept.memo.imports = new Map(inputs);
    kept.memo.stamps = new Map(kept.stamps);
    kept.memo.decorators = decorators;
  };
  if (!entries.length) {
    remember(false);
    return { inputs, failed, changed: null };
  }
  let all = await graphOf(repo, entries);
  // Decorators esbuild refused: read again with them allowed, which is slower, so only then.
  const decorators = 'error' in all && /decorators/i.test(all.error);
  if (decorators) all = await graphOf(repo, entries, { decorators });
  if ('inputs' in all) {
    for (const [file, imports] of all.inputs) inputs.set(file, imports);
    remember(decorators);
    return { inputs, failed, changed: null };
  }
  for (const entry of entries) {
    const one = await graphOf(repo, [entry], { decorators });
    if ('error' in one) failed.set(entry, one.error);
    else for (const [file, imports] of one.inputs) inputs.set(file, imports);
  }
  remember(decorators);
  return { inputs, failed, changed: null };
}

/** The files that change how every import resolves: everything is read again when one does. */
const SETTINGS = /(^|\/)(tsconfig[^/]*|jsconfig[^/]*|package)\.json$/;

function settingsChanged(before: Map<string, string>, now: Map<string, string>): boolean {
  for (const [file, stamp] of now) {
    if (SETTINGS.test(file) && before.get(file) !== stamp) return true;
  }
  for (const file of before.keys()) if (SETTINGS.test(file) && !now.has(file)) return true;
  return false;
}

/** An import that resolved to nothing of the repo's and names no package: a file that may appear. */
function unresolvedLocal(item: GraphImport): boolean {
  return item.external && !ASSET.test(item.path) && packageName(item.path) === null;
}

/** What a file's code imports, as written: its imports, its exports from, `import()` and `require`. */
const SPECIFIERS = [
  /\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?['"]([^'"\n]+)['"]/g,
  /\bexport\s*[\w$*{}\s,]+?\s*from\s*['"]([^'"\n]+)['"]/g,
  /\b(?:import|require)\(\s*['"]([^'"\n]+)['"]\s*\)/g
];

/**
 * A changed file's imports when it still imports what it did, by the specifiers its text names
 * against those the graph resolved for it: then they resolve as they did, and esbuild, whose
 * resolving takes milliseconds an import, need not read it again. Null when the text says what
 * the graph has not (a type-only import esbuild drops), or the other way round: it is read again.
 */
function sameSpecifiers(repo: string, file: string, imports: GraphImport[]): GraphImport[] | null {
  const text = readText(repo, file);
  if (text === null) return null;
  const named = new Map<string, number>();
  for (const pattern of SPECIFIERS) {
    for (const match of text.matchAll(pattern)) {
      if (!named.has(match[1]!)) named.set(match[1]!, match.index);
    }
  }
  const spec = (item: GraphImport) => item.original ?? item.path;
  const resolved = new Set(imports.map(spec));
  if (named.size !== resolved.size || ![...named.keys()].every(item => resolved.has(item))) {
    return null;
  }
  // In the order the text has them now, as esbuild would list them.
  return [...imports].sort((a, b) => named.get(spec(a))! - named.get(spec(b))!);
}

/**
 * The graph again from the last one: the files whose stamp changed, the entries it never read,
 * and the files they newly reach are read, each with its own imports resolved and nothing
 * followed; everything else is the memo's. When files came or went, the files whose imports did
 * not resolve, or named one that went, are read again too, since theirs may resolve differently.
 */
async function graphAgain(
  repo: string,
  entries: string[],
  memo: DiscoverMemo,
  stamps: Map<string, string>
): Promise<ModuleGraph> {
  const changed = new Set<string>();
  for (const [file, stamp] of stamps) if (memo.stamps.get(file) !== stamp) changed.add(file);
  const removed = [...memo.stamps.keys()].filter(file => !stamps.has(file));
  for (const file of removed) {
    changed.add(file);
    memo.imports.delete(file);
  }
  const cameOrWent = removed.length > 0 || [...changed].some(file => !memo.stamps.has(file));
  const gone = new Set(removed);
  let reading = new Set<string>(entries.filter(entry => !memo.imports.has(entry)));
  for (const file of changed) {
    if (!memo.imports.has(file)) continue;
    const same = sameSpecifiers(repo, file, memo.imports.get(file)!);
    if (same) memo.imports.set(file, same);
    else reading.add(file);
  }
  if (cameOrWent) {
    for (const [file, imports] of memo.imports) {
      if (imports.some(item => unresolvedLocal(item) || (!item.external && gone.has(item.path)))) {
        reading.add(file);
      }
    }
  }
  const broken = new Map<string, string>();
  const decorators = memo.decorators ?? false;
  while (reading.size) {
    const files = [...reading].filter(file => stamps.has(file));
    reading = new Set();
    if (!files.length) break;
    const read = await graphOf(repo, files, { decorators, only: true });
    const results: [string, Map<string, GraphImport[]> | string][] = [];
    if ('inputs' in read) for (const file of files) results.push([file, read.inputs]);
    else {
      for (const file of files) {
        const one = await graphOf(repo, [file], { decorators, only: true });
        results.push([file, 'inputs' in one ? one.inputs : one.error]);
      }
    }
    for (const [file, result] of results) {
      if (typeof result === 'string') {
        broken.set(file, result);
        memo.imports.delete(file);
        continue;
      }
      const imports = result.get(file) ?? [];
      memo.imports.set(file, imports);
      for (const item of imports) {
        if (!item.external && !memo.imports.has(item.path) && !broken.has(item.path)) {
          reading.add(item.path);
        }
      }
    }
  }
  memo.stamps = new Map(stamps);
  // An entry that reaches a file that does not read fails whole, as it does when all are read.
  const failed = new Map<string, string>();
  const fine: string[] = [];
  const graph = { inputs: memo.imports, failed };
  for (const entry of entries) {
    const reason =
      broken.get(entry) ??
      [...reachable(graph, [entry])]
        .flatMap(file => memo.imports.get(file)!.map(item => broken.get(item.path)))
        .find(Boolean);
    if (reason) failed.set(entry, reason);
    else if (memo.imports.has(entry)) fine.push(entry);
  }
  const inputs = new Map<string, GraphImport[]>();
  for (const file of reachable(graph, fine)) inputs.set(file, memo.imports.get(file)!);
  return { inputs, failed, changed };
}

/** Every repo file the entries reach through their imports. */
export function reachable(graph: ModuleGraph, entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entries.filter(entry => graph.inputs.has(entry));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const item of graph.inputs.get(file) ?? []) {
      if (!item.external && graph.inputs.has(item.path)) queue.push(item.path);
    }
  }
  return seen;
}

/** The repo file an import of `file` names, or null when it is a package or does not resolve. */
export function resolveImport(graph: ModuleGraph, file: string, spec: string): string | null {
  const found = graph.inputs.get(file)?.find(item => item.original === spec && !item.external);
  return found ? found.path : null;
}

// What a file holds, read from esbuild's transform of it.

/** One element in the code, as the transform's call: `name` null for an HTML element. */
export type JsxCall = {
  name: string | null;
  /** An HTML element's tag: `div`, `script`. */
  tag: string | null;
  start: number;
  end: number;
  parent: number;
  /** It is handed `children` (or `props.children`): it wraps what its parent gives it. */
  passesChildren: boolean;
  /** It is inside a `.map()`: one of a list's items, however many the data holds. */
  repeated: boolean;
};

/** One top-level statement: what it declares, and where it is in the code. */
type Statement = { name: string | null; isDefault: boolean; start: number; end: number };

export type ModuleInfo = {
  code: string;
  calls: JsxCall[];
  statements: Statement[];
  /** By local name: the import it is, as the specifier and the name imported (`default`, `*`). */
  imports: Map<string, { spec: string; name: string }>;
  /** Re-exports: the name exported, the name it has where it comes from, and from where (null: here). */
  reexports: { name: string; original: string; from: string | null }[];
  /** `export * from` specifiers. */
  starFrom: string[];
  /** Names declared at the top level. */
  declared: Set<string>;
  /** The default export's own name, when it has one. */
  defaultName: string | null;
};

const JSX = '__rb';
const IDENTIFIER = /[A-Za-z0-9_$]/;

function loaderFor(file: string): Loader {
  const ext = path.extname(file);
  if (ext === '.tsx') return 'tsx';
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'ts';
  return 'jsx';
}

/**
 * The elements in transformed code, with their nesting, and where its top-level statements start.
 * Strings, template literals and comments are skipped; esbuild's output is regular enough that
 * this is all it takes.
 */
export function scanCode(code: string): { calls: JsxCall[]; starts: number[] } {
  const calls: JsxCall[] = [];
  const starts: number[] = [0];
  const open: { call: number; depth: number }[] = [];
  const templates: number[] = [];
  /** The depths at which a `.map(` or `.flatMap(` call is open. */
  const repeats: number[] = [];
  let depth = 0;
  let inTemplate = false;
  let i = 0;
  const n = code.length;
  const closeTemplateAt = () => {
    for (; i < n; i++) {
      const char = code[i]!;
      if (char === '\\') {
        i++;
        continue;
      }
      if (char === '`') {
        inTemplate = false;
        i++;
        return;
      }
      if (char === '$' && code[i + 1] === '{') {
        templates.push(depth);
        depth++;
        inTemplate = false;
        i += 2;
        return;
      }
    }
  };
  while (i < n) {
    if (inTemplate) {
      closeTemplateAt();
      continue;
    }
    const char = code[i]!;
    if (char === '"' || char === "'") {
      for (i++; i < n && code[i] !== char && code[i] !== '\n'; i++) if (code[i] === '\\') i++;
      i++;
      continue;
    }
    if (char === '`') {
      inTemplate = true;
      i++;
      continue;
    }
    if (char === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (char === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (char === '\n') {
      if (depth === 0 && i + 1 < n && /[^\s})\]]/.test(code[i + 1]!)) starts.push(i + 1);
      i++;
      continue;
    }
    if (
      char === JSX[0] &&
      code.startsWith(`${JSX}(`, i) &&
      (i === 0 || !IDENTIFIER.test(code[i - 1]!))
    ) {
      let j = i + JSX.length + 1;
      while (j < n && /\s/.test(code[j]!)) j++;
      let name: string | null = null;
      let tag: string | null = null;
      if (code[j] !== '"') {
        const match = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(code.slice(j, j + 200));
        name = match ? match[0] : null;
      } else {
        tag = /^"([^"]*)"/.exec(code.slice(j, j + 100))?.[1] ?? null;
      }
      calls.push({
        name,
        tag,
        start: i,
        end: n,
        parent: open.length ? open.at(-1)!.call : -1,
        passesChildren: false,
        repeated: repeats.length > 0
      });
      open.push({ call: calls.length - 1, depth });
      depth++;
      i += JSX.length + 1;
      continue;
    }
    if (char === '.' && /^\.(map|flatMap)\(/.test(code.slice(i, i + 9))) {
      const length = code.startsWith('.map(', i) ? 5 : 9;
      repeats.push(depth);
      depth++;
      i += length;
      continue;
    }
    if (
      char === 'c' &&
      code.startsWith('children', i) &&
      !IDENTIFIER.test(code[i - 1] ?? ' ') &&
      !IDENTIFIER.test(code[i + 8] ?? ' ') &&
      open.length
    ) {
      calls[open.at(-1)!.call]!.passesChildren = true;
      i += 8;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth++;
    } else if (char === ')' || char === ']' || char === '}') {
      if (char === '}' && templates.length && templates.at(-1) === depth - 1) {
        templates.pop();
        depth--;
        inTemplate = true;
        i++;
        continue;
      }
      depth = Math.max(0, depth - 1);
      if (char === ')' && open.length && open.at(-1)!.depth === depth) {
        calls[open.pop()!.call]!.end = i;
      } else if (char === ')' && repeats.length && repeats.at(-1) === depth) {
        repeats.pop();
      }
    }
    i++;
  }
  return { calls, starts };
}

const DECLARATION =
  /^(export\s+)?(default\s+)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/;

function namesIn(list: string): { local: string; imported: string }[] {
  return list
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [imported, local] = item.split(/\s+as\s+/).map(part => part.trim());
      return { imported: imported!, local: local ?? imported! };
    });
}

const modules = new Map<string, ModuleInfo | null>();

/**
 * Forgets what was read, for a map run after the files changed: every file, or only those named
 * (a refresh, B7), with what was worked out from them.
 */
export function forgetModules(repo?: string, files?: Iterable<string>): void {
  seenVisible.clear();
  seenSlots.clear();
  if (!repo || !files) {
    modules.clear();
    return;
  }
  for (const file of files) modules.delete(`${repo}\u0000${file}`);
}

function transformOptions(file: string): TransformOptions {
  return {
    loader: loaderFor(file),
    jsx: 'transform',
    jsxFactory: JSX,
    jsxFragment: `${JSX}Fragment`,
    // Legacy decorators read as such: what they decorate is not what the map reads.
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    logLevel: 'silent'
  };
}

/** What a repo file holds, read once per map; null when it does not read. */
export function readModule(repo: string, file: string): ModuleInfo | null {
  const cacheKey = `${repo}\u0000${file}`;
  if (modules.has(cacheKey)) return modules.get(cacheKey)!;
  const source = readText(repo, file);
  let info: ModuleInfo | null = null;
  if (source !== null) {
    try {
      info = moduleInfo(transformSync(source, transformOptions(file)).code);
    } catch {
      info = null;
    }
  }
  modules.set(cacheKey, info);
  return info;
}

/** How many files esbuild transforms at once while the modules are read ahead. */
const AHEAD = 16;

/**
 * Reads ahead the files not read yet, several at once and without holding the event loop, so the
 * analysis that follows finds them read: one at a time, a large app's thousand files took
 * seconds (B7), while `roughbook start` serves the canvas.
 */
export async function readModulesAhead(repo: string, files: Iterable<string>): Promise<void> {
  const queue = [...files].filter(
    file => CODE_EXTENSIONS.includes(path.extname(file)) && !modules.has(`${repo}\u0000${file}`)
  );
  const next = async (): Promise<void> => {
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      const cacheKey = `${repo}\u0000${file}`;
      let info: ModuleInfo | null = null;
      try {
        const source = await readFile(path.join(repo, ...file.split('/')), 'utf8');
        info = moduleInfo((await transform(source, transformOptions(file))).code);
      } catch {
        info = null;
      }
      if (!modules.has(cacheKey)) modules.set(cacheKey, info);
    }
  };
  await Promise.all(Array.from({ length: AHEAD }, next));
}

/** A module's imports, exports and statements, from its transformed code. */
export function moduleInfo(code: string): ModuleInfo {
  const { calls, starts } = scanCode(code);
  const statements: Statement[] = starts.map((start, index) => {
    const end = starts[index + 1] ?? code.length;
    const match = DECLARATION.exec(code.slice(start, start + 300));
    return {
      name: match ? (match[3] ?? match[4] ?? match[5] ?? null) : null,
      isDefault: Boolean(match?.[2]) || code.startsWith('export default', start),
      start,
      end
    };
  });
  const imports = new Map<string, { spec: string; name: string }>();
  for (const match of code.matchAll(
    /^import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}|\*\s*as\s+([A-Za-z_$][\w$]*))?\s*from\s*"([^"]+)"/gm
  )) {
    const [, defaultName, named, namespace, spec] = match;
    if (defaultName) imports.set(defaultName, { spec: spec!, name: 'default' });
    if (namespace) imports.set(namespace, { spec: spec!, name: '*' });
    for (const item of namesIn(named ?? '')) {
      imports.set(item.local, { spec: spec!, name: item.imported });
    }
  }
  // next/dynamic and React.lazy: `const Hero = dynamic(() => import("./hero"))`, maybe `.then(m => m.Hero)`.
  for (const match of code.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$]+\.)?(?:dynamic|lazy)\(\s*(?:async\s*)?\(\)\s*=>\s*import\(\s*"([^"]+)"\s*\)(?:\.then\(\s*\(?([\w$]+)\)?\s*=>\s*\3\.([\w$]+)\s*\))?/g
  )) {
    imports.set(match[1]!, { spec: match[2]!, name: match[4] ?? 'default' });
  }
  const reexports: ModuleInfo['reexports'] = [];
  const starFrom: string[] = [];
  for (const match of code.matchAll(/^export\s*\{([^}]*)\}(?:\s*from\s*"([^"]+)")?/gm)) {
    for (const item of namesIn(match[1]!)) {
      reexports.push({ name: item.local, original: item.imported, from: match[2] ?? null });
    }
  }
  for (const match of code.matchAll(/^export\s*\*\s*from\s*"([^"]+)"/gm)) starFrom.push(match[1]!);
  const declared = new Set(
    statements.map(item => item.name).filter((name): name is string => Boolean(name))
  );
  let defaultName = statements.find(item => item.isDefault && item.name)?.name ?? null;
  const bare = /^export\s+default\s+(?:[\w$.]+\(\s*)*([A-Za-z_$][\w$]*)\s*\)*\s*;/m.exec(code);
  if (!defaultName && bare && declared.has(bare[1]!)) defaultName = bare[1]!;
  defaultName ??= reexports.find(item => item.name === 'default' && !item.from)?.original ?? null;
  return { code, calls, statements, imports, reexports, starFrom, declared, defaultName };
}

/** A component in the app: the file that defines it, and its export there. */
export type ComponentRef = { file: string; export: string };

export function refKey(ref: ComponentRef): string {
  return `${ref.file}#${ref.export}`;
}

/**
 * Where an export really lives: through a barrel's `export { X } from`, `export { default as X }`
 * and `export *`, to the file that declares it.
 */
export function definingExport(
  repo: string,
  graph: ModuleGraph,
  file: string,
  name: string,
  depth = 0
): ComponentRef {
  const info = readModule(repo, file);
  if (!info || depth > 8) return { file, export: name };
  const re = info.reexports.find(item => item.name === name);
  if (re?.from) {
    const target = resolveImport(graph, file, re.from);
    if (target) return definingExport(repo, graph, target, re.original, depth + 1);
  }
  if (re && !re.from) {
    // `export { Local as Name }` of something it imported: follow the import.
    const imported = info.imports.get(re.original);
    if (imported && !info.declared.has(re.original)) {
      const target = resolveImport(graph, file, imported.spec);
      if (target) return definingExport(repo, graph, target, imported.name, depth + 1);
    }
    return { file, export: name };
  }
  // `export const Loader = dynamic(() => import("./view"))`: the component is the module imported.
  const lazy = info.declared.has(name) ? info.imports.get(name) : undefined;
  if (lazy) {
    const target = resolveImport(graph, file, lazy.spec);
    if (target) return definingExport(repo, graph, target, lazy.name, depth + 1);
  }
  if (name === 'default' || info.declared.has(name)) return { file, export: name };
  for (const spec of info.starFrom) {
    const target = resolveImport(graph, file, spec);
    if (!target) continue;
    const found = definingExport(repo, graph, target, name, depth + 1);
    const there = readModule(repo, found.file);
    if (
      there &&
      (there.declared.has(found.export) || there.reexports.some(item => item.name === found.export))
    ) {
      return found;
    }
  }
  return { file, export: name };
}

/** A component's name in the code: its export's, the default export's own, or its file's. */
export function componentName(repo: string, ref: ComponentRef): string {
  if (ref.export !== 'default') return ref.export;
  const own = readModule(repo, ref.file)?.defaultName;
  if (own) return own;
  const base = path.posix.basename(ref.file).replace(/\.[^.]+$/, '');
  return base === 'index' ? path.posix.basename(path.posix.dirname(ref.file)) : base;
}

/** The statement that declares an export of a module: its default, or a name. */
function rootStatement(info: ModuleInfo, exported: string): Statement | null {
  if (exported === 'default') {
    const own = info.statements.find(item => item.isDefault);
    if (own?.name || !info.defaultName) return own ?? null;
    return info.statements.find(item => item.name === info.defaultName) ?? own ?? null;
  }
  const local =
    info.reexports.find(item => item.name === exported && !item.from)?.original ?? exported;
  return info.statements.find(item => item.name === local) ?? null;
}

/** What one element in a component is, once its name is looked up. */
type Element =
  | { kind: 'html'; tag: string | null }
  | { kind: 'component'; ref: ComponentRef }
  | { kind: 'package'; name: string }
  | { kind: 'inline'; name: string }
  | { kind: 'slot' };

/** A tree of the elements a component renders, with the file's own helpers inlined. */
type Node = { element: Element; passesChildren: boolean; repeated: boolean; children: Node[] };

export type Analysis = {
  repo: string;
  graph: ModuleGraph;
  /** Whether a component is an atom: the design system's, never a section (decision 5). */
  isAtom(ref: ComponentRef, name: string): boolean;
};

function elementOf(analysis: Analysis, file: string, info: ModuleInfo, call: JsxCall): Element {
  const { name } = call;
  if (name === null || name === `${JSX}Fragment`) return { kind: 'html', tag: call.tag };
  const [base, member] = name.split('.') as [string, string | undefined];
  const imported = info.imports.get(base);
  if (imported) {
    const target = resolveImport(analysis.graph, file, imported.spec);
    if (!target) return { kind: 'package', name: member ?? base };
    const exported = imported.name === '*' ? (member ?? 'default') : imported.name;
    return {
      kind: 'component',
      ref: definingExport(analysis.repo, analysis.graph, target, exported)
    };
  }
  if (info.declared.has(base)) return { kind: 'inline', name: base };
  return { kind: 'slot' };
}

/** The elements a statement renders, as a tree, with the file's own components inlined. */
function treeOf(
  analysis: Analysis,
  file: string,
  info: ModuleInfo,
  statement: Statement,
  seen: Set<string>
): Node[] {
  const inside = info.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.start >= statement.start && call.start < statement.end);
  const indexes = new Set(inside.map(item => item.index));
  const nodes = new Map<number, Node>();
  const roots: Node[] = [];
  for (const { call, index } of inside) {
    const element = elementOf(analysis, file, info, call);
    const node: Node = {
      element,
      passesChildren: call.passesChildren,
      repeated: call.repeated,
      children: []
    };
    if (element.kind === 'inline' && !seen.has(element.name)) {
      const helper = info.statements.find(item => item.name === element.name);
      if (helper && helper !== statement) {
        node.children.push(
          ...treeOf(analysis, file, info, helper, new Set([...seen, element.name]))
        );
      }
    }
    nodes.set(index, node);
    const parent = indexes.has(call.parent) ? nodes.get(call.parent) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** One place in a page's order: a component, or one that wraps others (a provider, a shell). */
type Candidate = { ref: ComponentRef; wrapper: boolean };

function isSection(
  analysis: Analysis,
  element: Element
): element is Extract<Element, { kind: 'component' }> {
  return (
    element.kind === 'component' &&
    !analysis.isAtom(element.ref, componentName(analysis.repo, element.ref))
  );
}

const seenSlots = new Map<string, boolean>();

/** Whether a component's own code renders the `children` it is given. */
function rendersChildren(analysis: Analysis, ref: ComponentRef): boolean {
  const key = `${analysis.repo}\u0000${refKey(ref)}`;
  const known = seenSlots.get(key);
  if (known !== undefined) return known;
  seenSlots.set(key, false);
  const info = readModule(analysis.repo, ref.file);
  const statement = info && rootStatement(info, ref.export);
  const result =
    info && statement
      ? treeOf(analysis, ref.file, info, statement, new Set()).some(holdsSlot)
      : true;
  seenSlots.set(key, result);
  return result;
}

/** Whether a node, or anything in it, is a section or a slot. */
function holdsSection(analysis: Analysis, node: Node): boolean {
  return (
    isSection(analysis, node.element) ||
    node.element.kind === 'slot' ||
    node.children.some(child => holdsSection(analysis, child))
  );
}

/**
 * Whether an element wraps what its parent gives it, and so is no section of its own: it passes
 * `children` through, it is given sections to show (a shell's page), or it renders the content it
 * is given (a container's). A section handed small JSX through a prop (a header's actions, a
 * table's empty state) stays a section.
 */
function wraps(analysis: Analysis, node: Node): boolean {
  if (node.passesChildren) return true;
  if (!node.children.length) return false;
  if (node.children.some(child => holdsSection(analysis, child))) return true;
  return node.element.kind === 'component' && rendersChildren(analysis, node.element.ref);
}

/** HTML elements, and elements of packages, that show nothing on the page. */
const UNSEEN_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'noscript',
  'template',
  'title',
  'base'
]);
const UNSEEN_PACKAGES =
  /^(Script|Head|GoogleAnalytics|GoogleTagManager|Analytics|SpeedInsights|NextTopLoader|Toaster)$/;

/** HTML that is a frame's own content even when empty in the code: a bar, a heading, a picture. */
const CHROME_TAGS = new Set([
  'header',
  'footer',
  'nav',
  'aside',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'img',
  'svg',
  'button',
  'a',
  'form',
  'table',
  'ul',
  'ol'
]);

/** Whether a node passes `children` through, here or below. */
function holdsSlot(node: Node): boolean {
  return node.passesChildren || node.children.some(holdsSlot);
}

/**
 * Whether a wrapper draws something of its own beside what it wraps (a shell's top bar and footer
 * written inline, a page header around a page's content): HTML off the path to its `children`.
 * Its own components are parts of their own, and a provider draws nothing.
 */
function drawsChrome(nodes: Node[], slotted = false): boolean {
  return nodes.some(node => {
    if (holdsSlot(node)) return drawsChrome(node.children, true);
    if (!slotted) return false;
    const element = node.element;
    if (element.kind === 'html') {
      if (element.tag === null) return drawsChrome(node.children, slotted);
      if (UNSEEN_TAGS.has(element.tag)) return false;
      return CHROME_TAGS.has(element.tag) || node.children.length > 0;
    }
    return element.kind === 'inline' && drawsChrome(node.children, slotted);
  });
}

const seenVisible = new Map<string, boolean>();

/**
 * Whether a component shows anything: one that renders only scripts, metadata or nothing at all
 * (JSON-LD, analytics, an effect) is no section, however a page places it.
 */
function visible(analysis: Analysis, ref: ComponentRef, depth = 0): boolean {
  const key = `${analysis.repo}\u0000${refKey(ref)}`;
  const known = seenVisible.get(key);
  if (known !== undefined) return known;
  seenVisible.set(key, true);
  const info = readModule(analysis.repo, ref.file);
  const statement = info && rootStatement(info, ref.export);
  if (!info || !statement || depth > 4) return true;
  const shows = (nodes: Node[]): boolean =>
    nodes.some(node => {
      const element = node.element;
      if (element.kind === 'html') {
        return element.tag === null ? shows(node.children) : !UNSEEN_TAGS.has(element.tag);
      }
      if (element.kind === 'package') {
        return !UNSEEN_PACKAGES.test(element.name) || shows(node.children);
      }
      if (element.kind === 'component') return visible(analysis, element.ref, depth + 1);
      if (element.kind === 'inline') return shows(node.children);
      return true;
    });
  const result = shows(treeOf(analysis, ref.file, info, statement, new Set()));
  seenVisible.set(key, result);
  return result;
}

type Found = {
  inline: Set<string>;
  hidden: Map<string, ComponentRef>;
  items: Map<string, ComponentRef>;
  /** The containers holding content written inline, one per block. */
  blocks: string[];
};

function candidatesIn(
  analysis: Analysis,
  nodes: Node[],
  into: Candidate[],
  found: Found,
  inList = false
) {
  for (const node of nodes) {
    const repeated = inList || node.repeated;
    if (node.element.kind === 'inline') found.inline.add(node.element.name);
    if (isSection(analysis, node.element)) {
      const wrapper = wraps(analysis, node);
      if (!wrapper && !visible(analysis, node.element.ref)) {
        found.hidden.set(refKey(node.element.ref), node.element.ref);
        continue;
      }
      if (repeated) {
        // One of a list's items (a card per plan, a row per post): below a section, like an atom.
        found.items.set(refKey(node.element.ref), node.element.ref);
      } else {
        into.push({ ref: node.element.ref, wrapper });
      }
      if (wrapper) {
        const before = into.length + found.items.size;
        candidatesIn(analysis, node.children, into, found, repeated);
        // A container whose content is the page's own HTML: a block of the page, not a section.
        if (!repeated && node.children.length && into.length + found.items.size === before) {
          found.blocks.push(componentName(analysis.repo, node.element.ref));
        }
      }
    } else {
      candidatesIn(analysis, node.children, into, found, repeated);
    }
  }
}

export type Rendered = {
  /** The components it is made of, in order, wrappers left out and their own parts put in. */
  sections: ComponentRef[];
  /** The files that contributed: the root's, and those of the shells and views it went through. */
  files: string[];
  /** Components declared in the root's own file, which cannot be shown alone. */
  inline: string[];
  /** Components it renders that show nothing: scripts, metadata, effects. */
  hidden: ComponentRef[];
  /** Components it renders once per item of a list: below its sections. */
  items: ComponentRef[];
  /** Blocks of content written inline, by the container each is in. */
  blocks: string[];
  /** How many elements its root renders, components or not: none for a redirect. */
  elements: number;
  /** It wraps what it is given and draws chrome of its own beside it: a shell, a part itself. */
  frame: boolean;
};

/** Names that say a component is a page's whole view, which the page only renders. */
const VIEW_NAME =
  /(Page|View|Screen|Content|Client|Template|Container|Main|Body|Wrapper|Shell|Layout|Root|Index)$/;

/**
 * The sections a component renders, in the order it shows them: the components among its
 * elements, through HTML, packages and its own file's helpers; a wrapper's own parts in its place;
 * and, for a route (`descend`), the sections of the one view it renders instead of the view.
 */
export function rendered(
  analysis: Analysis,
  root: ComponentRef,
  options: { descend: boolean; depth?: number; seen?: Set<string> } = { descend: true }
): Rendered {
  const depth = options.depth ?? 0;
  const seen = options.seen ?? new Set<string>();
  const empty: Rendered = {
    sections: [],
    files: [],
    inline: [],
    hidden: [],
    items: [],
    blocks: [],
    elements: 0,
    frame: false
  };
  if (depth > 4 || seen.has(refKey(root))) return empty;
  seen.add(refKey(root));
  const info = readModule(analysis.repo, root.file);
  if (!info) return empty;
  const statement = rootStatement(info, root.export);
  if (!statement) return { ...empty, files: [root.file] };
  const tree = treeOf(
    analysis,
    root.file,
    info,
    statement,
    new Set(statement.name ? [statement.name] : [])
  );
  const candidates: Candidate[] = [];
  const found: Found = { inline: new Set(), hidden: new Map(), items: new Map(), blocks: [] };
  candidatesIn(analysis, tree, candidates, found);
  const sections: ComponentRef[] = [];
  const files = [root.file];
  const add = (ref: ComponentRef) => {
    if (!sections.some(item => refKey(item) === refKey(ref))) sections.push(ref);
  };
  for (const candidate of candidates) {
    if (!candidate.wrapper) {
      add(candidate.ref);
      continue;
    }
    // A provider or a shell: its own parts (a shell's sidebar) stand in its place, and a shell
    // that draws chrome of its own (a top bar written inline) is a part itself.
    const own = rendered(analysis, candidate.ref, { descend: false, depth: depth + 1, seen });
    for (const ref of own.hidden) found.hidden.set(refKey(ref), ref);
    for (const ref of own.items) found.items.set(refKey(ref), ref);
    if (own.frame) {
      add(candidate.ref);
      if (!files.includes(candidate.ref.file)) files.push(candidate.ref.file);
    }
    if (own.sections.length) {
      for (const file of own.files) if (!files.includes(file)) files.push(file);
      own.sections.forEach(add);
    }
  }
  const inline = [...found.inline].filter(name => name !== statement.name);
  const elements = info.calls.filter(
    call => call.start >= statement.start && call.start < statement.end
  ).length;
  if (options.descend && sections.length === 1) {
    const only = sections[0]!;
    const inner = rendered(analysis, only, {
      descend: true,
      depth: depth + 1,
      seen: new Set(seen)
    });
    const name = componentName(analysis.repo, only);
    // A view: named as one, beside its route (app/jobs/jobs-list.tsx), or of two sections or more.
    const beside = `${path.posix.dirname(only.file)}/`.startsWith(
      `${path.posix.dirname(root.file)}/`
    );
    // Two sections or more make a view only of what the route itself renders: below a view, a
    // component of several parts (a table with its filters and pagination) is a section.
    if (
      (inner.sections.length >= 2 && depth === 0) ||
      (inner.sections.length && (VIEW_NAME.test(name) || beside))
    ) {
      for (const ref of inner.hidden) found.hidden.set(refKey(ref), ref);
      for (const ref of inner.items) found.items.set(refKey(ref), ref);
      found.blocks.push(...inner.blocks);
      return {
        sections: inner.sections,
        files: [...files, ...inner.files.filter(file => !files.includes(file))],
        inline,
        hidden: [...found.hidden.values()],
        items: [...found.items.values()],
        blocks: found.blocks,
        elements,
        frame: false
      };
    }
  }
  return {
    sections,
    files,
    inline,
    hidden: [...found.hidden.values()],
    items: [...found.items.values()],
    blocks: found.blocks,
    elements,
    frame: drawsChrome(tree)
  };
}
