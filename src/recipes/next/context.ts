// The in-page view's switch for Next.js (B5 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 41 and 42),
// in development only. A Turbopack rule in next.config, under its `development` condition, runs a
// loader on the app's own component files: an adopted component's module becomes a wrapper that
// re-exports the file as it is (imported again with ?roughbook-original, which the rule leaves
// alone) and puts the adopted export inside its marker. On the server the wrapper reads the
// request's address from Next.js's own request store, never `headers()`, which Cache Components
// would make the page wait for; for `?roughbook-swap=<page>/<component>/<iteration>` on this
// machine, it renders the iteration in the component's place with the same props, the page's own
// data. The iterations are loaded from a generated registry, compiled only when a page asks for
// one (turbopackLazyDynamicImportsSSR); one that does not compile (src/recipes/compiles.ts) is
// never imported there, since Turbopack would keep its failure in the page's graph afterwards.
//
//   <app>/rough-preview/context/loader.cjs          the rule's loader            (with the route, gitignored)
//   <app>/rough-preview/context/section.tsx         the wrapper on the server
//   <app>/rough-preview/context/section-browser.tsx the wrapper in the browser
//   <app>/rough-preview/context/pick.tsx            Pick: a click names its section
//   rough/context-registry.ts                       the adopted modules and their iterations (generated)
//   rough/context-keys.ts                           the adopted modules alone, for the browser (generated)
//   rough/context-modules.json                      the files the loader wraps (generated)
//   next.config.*                                   an import and the rule, both at the file's ends
import fs from 'node:fs';
import path from 'node:path';
import { ROUGH_DIR } from '../../repo/root.js';
import { read, type PrepChange } from '../../repo/plan.js';
import {
  CONTEXT_SENTINEL,
  MARKER_ELEMENT,
  MARKERS_PARAM,
  PICK_PARAM,
  SECTION_ATTRIBUTE,
  SWAP_PARAM,
  SWAPPED_ATTRIBUTE,
  contextSections,
  type ContextSection
} from '../context.js';
import { compileProblem } from '../compiles.js';
import { LAZY_IMPORT_ERROR } from './fault.js';
import { previewRouteDir } from './preview.js';

export const CONTEXT_REGISTRY = `${ROUGH_DIR}/context-registry.ts`;
export const CONTEXT_MODULES = `${ROUGH_DIR}/context-modules.json`;
/**
 * The adopted modules' keys alone, which the browser's wrapper reads: it never swaps, so no
 * iteration is in its graph, where a server-only one would not compile (B6's integration).
 */
export const CONTEXT_KEYS = `${ROUGH_DIR}/context-keys.ts`;
const MARKER = 'Roughbook preview route';
const ENTRY = 'index.tsx';

export const NEXT_CONFIGS = [
  'next.config.ts',
  'next.config.mts',
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs'
];

/** The switch's own folder, beside the preview route. */
export function contextDir(appDir: string): string {
  return `${previewRouteDir(appDir)}/context`;
}

/** The marker's attributes as the wrappers write them. */
const MARKER_PROPS = `{ "${SECTION_ATTRIBUTE}": key, style: { display: "contents" } }`;

/** The rule's loader: CommonJS, run by Turbopack in Node. */
function loaderFile(appDir: string): string {
  const up = appDir.split('/').length + 2;
  return `// ${MARKER}: the in-page view's loader (${CONTEXT_SENTINEL}). Development only: next.config's rule
// runs it in \`next dev\` alone. An adopted component's file becomes a wrapper that re-exports it as it
// is and puts the adopted export inside its marker; every other file is left as it is.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, ${JSON.stringify('../'.repeat(up).replace(/\/$/, ''))});
const LIST = path.join(ROOT, ${JSON.stringify(ROUGH_DIR)}, "context-modules.json");

module.exports = function roughbookContext(source) {
  const options = (this.getOptions && this.getOptions()) || {};
  // The list changes as components are adopted: the wrapper follows without a restart.
  if (typeof this.addDependency === "function") this.addDependency(LIST);
  let modules;
  try {
    modules = JSON.parse(fs.readFileSync(LIST, "utf8"));
  } catch {
    return source;
  }
  const file = path.relative(ROOT, this.resourcePath).split(path.sep).join("/");
  const name = modules[file];
  if (typeof name !== "string" || !/^[A-Za-z_$][\\w$]*$/.test(name)) return source;
  const own = JSON.stringify("./" + path.basename(this.resourcePath) + "?roughbook-original");
  let helper = path
    .relative(path.dirname(this.resourcePath), path.join(__dirname, options.browser ? "section-browser" : "section"))
    .split(path.sep)
    .join("/");
  if (!helper.startsWith(".")) helper = "./" + helper;
  const wrapped = "roughbookWrap(" + JSON.stringify(file + "#" + name) + ", RoughbookOriginal[" + JSON.stringify(name) + "])";
  const lines = [
    "import * as RoughbookOriginal from " + own + ";",
    "import { wrap as roughbookWrap } from " + JSON.stringify(helper) + ";",
    "export * from " + own + ";",
  ];
  if (name === "default") lines.push("export default " + wrapped + ";");
  else {
    lines.push("export const " + name + " = " + wrapped + ";");
    if (/\\bexport\\s+default\\b|\\bas\\s+default\\b/.test(source)) lines.push("export { default } from " + own + ";");
  }
  return lines.join("\\n") + "\\n";
};
`;
}

/** The address matching both wrappers use: a dynamic segment (\`[slug]\`) matches any one segment. */
const MATCHES = `function matches(address: string | null, pathname: string): boolean {
  if (address === null) return false;
  const want = address.replace(/\\/+$/, "").split("/");
  const have = pathname.replace(/\\/+$/, "").split("/");
  return want.length === have.length && want.every((part, index) => /^\\[.*\\]$|^\\{.*\\}$|^:/.test(part) || part === have[index]);
}

/** The marker's key: the page the request's path is, among those the component is adopted on, else the first. */
function keyFor(keys: { key: string; address: string | null }[], pathname: string): string {
  return (keys.find((item) => matches(item.address, pathname)) ?? keys[0]!).key;
}`;

function sectionFile(appDir: string): string {
  const up = '../'.repeat(appDir.split('/').length + 2);
  return `// ${MARKER}: the in-page view on the server (${CONTEXT_SENTINEL}). Development only, for requests to
// this machine: an adopted component renders inside its marker, and with ?${SWAP_PARAM}=<page>/<component>/<iteration>
// the iteration renders in its place, with the same props, the page's own data. The request's address is read
// from Next.js's request store rather than headers(), so a page with Cache Components renders as it does without.
import * as React from "react";
import { cache, createElement, type ComponentType, type ReactNode } from "react";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { Pick } from "./pick";
import { loaders, modules } from "${up}${ROUGH_DIR}/context-registry";

const SENTINEL = "${CONTEXT_SENTINEL}";
const LOOPBACK = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?$/;
// Only the server components' React has no useState: an iteration is swapped in there alone, so the
// HTML of a client component is the same on the server and in the browser.
const SERVER_COMPONENTS = typeof (React as Record<string, unknown>)["use" + "State"] !== "function";

type Load = () => Promise<{ default: ComponentType<Record<string, unknown>> }>;

/** The request's path and query, when it was addressed to this machine; null otherwise. */
function request(): { pathname: string; search: URLSearchParams } | null {
  try {
    const store = workUnitAsyncStorage.getStore() as
      | { type?: string; url?: { pathname: string; search: string }; headers?: Headers }
      | undefined;
    if (store?.type !== "request" || !store.url) return null;
    if (!LOOPBACK.test(store.headers?.get("host") ?? "")) return null;
    return { pathname: store.url.pathname, search: new URLSearchParams(store.url.search) };
  } catch {
    return null;
  }
}

/** The sections swapped in this request: once each, so an iteration that renders the original shows it. */
const swapped = cache(() => new Set<string>());

${MATCHES}

async function Iteration({ load, props }: { load: Load; props: Record<string, unknown> }) {
  const Shown = (await load()).default;
  return createElement(Shown, props);
}

export function wrap<P extends Record<string, unknown>>(id: string, Original: ComponentType<P>): ComponentType<P> {
  if (process.env.NODE_ENV !== "development" || !Original) return Original;
  function RoughbookSection(props: P): ReactNode {
    const keys = modules[id];
    const at = keys?.length ? request() : null;
    if (!keys?.length || !at) return createElement(Original, props);
    const key = keyFor(keys, at.pathname);
    const swap = at.search.get("${SWAP_PARAM}");
    let body: ReactNode = createElement(Original, props);
    let shown: string | undefined;
    if (SERVER_COMPONENTS && swap && swap.startsWith(key + "/") && loaders[swap] && !swapped().has(key)) {
      swapped().add(key);
      shown = swap;
      body = createElement(Iteration, { load: loaders[swap] as Load, props });
    }
    if (at.search.get("${MARKERS_PARAM}") === "0") return body;
    const swappedProp = shown ? { "${SWAPPED_ATTRIBUTE}": shown } : {};
    return createElement("${MARKER_ELEMENT}", { ...swappedProp, ...${MARKER_PROPS} }, body, createElement(Pick));
  }
  RoughbookSection.displayName = SENTINEL;
  return Object.assign(RoughbookSection, Original) as ComponentType<P>;
}
`;
}

function browserFile(appDir: string): string {
  const up = '../'.repeat(appDir.split('/').length + 2);
  return `// ${MARKER}: the in-page view in the browser (${CONTEXT_SENTINEL}), for an adopted component a client
// component renders. Development only, on this machine: it renders inside its marker, as on the server.
import { createElement, type ComponentType, type ReactNode } from "react";
import { Pick } from "./pick";
import { modules } from "${up}${ROUGH_DIR}/context-keys";

const SENTINEL = "${CONTEXT_SENTINEL}";
const LOOPBACK = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/;

${MATCHES}

export function wrap<P extends Record<string, unknown>>(id: string, Original: ComponentType<P>): ComponentType<P> {
  if (process.env.NODE_ENV !== "development" || !Original) return Original;
  function RoughbookSection(props: P): ReactNode {
    const keys = modules[id];
    const here = typeof window === "undefined" ? null : window.location;
    if (!keys?.length || !here || !LOOPBACK.test(here.hostname)) return createElement(Original, props);
    if (new URLSearchParams(here.search).get("${MARKERS_PARAM}") === "0") return createElement(Original, props);
    const key = keyFor(keys, here.pathname);
    return createElement("${MARKER_ELEMENT}", ${MARKER_PROPS}, createElement(Original, props), createElement(Pick));
  }
  RoughbookSection.displayName = SENTINEL;
  return Object.assign(RoughbookSection, Original) as ComponentType<P>;
}
`;
}

const PICK_FILE = `"use client";
// ${MARKER}: Pick (${CONTEXT_SENTINEL}). With ?${PICK_PARAM}=1, a click on the page posts
// { roughbook: "section", key } to the frame, naming the marked section it fell in, instead of following the page.
import { useEffect } from "react";

let listening = false;

export function Pick() {
  useEffect(() => {
    if (listening || new URLSearchParams(window.location.search).get("${PICK_PARAM}") !== "1") return;
    listening = true;
    document.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const section = event.target instanceof Element ? event.target.closest("[${SECTION_ATTRIBUTE}]") : null;
        const key = section?.getAttribute("${SECTION_ATTRIBUTE}");
        if (key) window.parent.postMessage({ roughbook: "section", key }, "*");
      },
      true,
    );
  }, []);
  return null;
}
Pick.displayName = "${CONTEXT_SENTINEL}";
`;

/** The switch's files beside the preview route, as `init` writes them. */
export function contextFiles(appDir: string): { file: string; content: string }[] {
  const dir = contextDir(appDir);
  return [
    { file: `${dir}/loader.cjs`, content: loaderFile(appDir) },
    { file: `${dir}/section.tsx`, content: sectionFile(appDir) },
    { file: `${dir}/section-browser.tsx`, content: browserFile(appDir) },
    { file: `${dir}/pick.tsx`, content: PICK_FILE }
  ];
}

/** The module id the loader gives an adopted component: its file and export. */
export function moduleId(section: Pick<ContextSection, 'source'>): string | null {
  const file = section.source.files[0];
  const name = section.source.export;
  if (!file || !/\.(tsx|jsx|js)$/.test(file) || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  return `${file}#${name}`;
}

/**
 * rough/context-registry.ts, rough/context-keys.ts (its modules alone, for the browser) and
 * rough/context-modules.json, as the adopted components are now. An iteration `broken` names (key -> why) is never imported: its loader fails with the reason, so the
 * page's graph never holds it and only the swap that asks for it fails (decision 45).
 */
export function renderContext(
  sections: ContextSection[],
  broken: Map<string, string> = new Map()
): { registry: string; modules: string; keys: string } {
  const modules = new Map<string, { key: string; address: string | null }[]>();
  const files: Record<string, string> = {};
  const loaders: string[] = [];
  for (const section of sections) {
    const id = moduleId(section);
    if (!id) continue;
    modules.set(id, [...(modules.get(id) ?? []), { key: section.key, address: section.address }]);
    files[section.source.files[0]!] = section.source.export;
    for (const iteration of section.iterations) {
      const why = broken.get(iteration.key);
      loaders.push(
        why === undefined
          ? `  ${JSON.stringify(iteration.key)}: () => import(${JSON.stringify(`./${iteration.key}/index`)}),`
          : `  ${JSON.stringify(iteration.key)}: () => Promise.reject(new Error(${JSON.stringify(`${iteration.key} does not compile: ${why}`)})),`
      );
    }
  }
  const moduleLines = [...modules].map(
    ([id, keys]) => `  ${JSON.stringify(id)}: ${JSON.stringify(keys).replace(/,/g, ', ')},`
  );
  const registry = `// Generated by Roughbook from the adopted components in this folder, for the in-page view. Do not edit.

/** Each adopted component's module, \`<file>#<export>\`: the pages it is adopted on, by key and address. */
export const modules: Record<string, { key: string; address: string | null }[]> = {
${moduleLines.map(line => `${line}\n`).join('')}};

/**
 * The iterations a page can show in a component's place, loaded only when a page asks for one. Each
 * takes the props of the component it stands for, so its default export is typed as unknown here.
 */
export const loaders: Record<string, () => Promise<{ default: unknown }>> = {
${loaders.map(line => `${line}\n`).join('')}};
`;
  const keys = `// Generated by Roughbook from the adopted components in this folder, for the in-page view in the browser:
// the adopted modules alone, so no iteration is ever compiled into a client component's graph. Do not edit.

/** Each adopted component's module, \`<file>#<export>\`: the pages it is adopted on, by key and address. */
export const modules: Record<string, { key: string; address: string | null }[]> = {
${moduleLines.map(line => `${line}\n`).join('')}};
`;
  return { registry, modules: `${JSON.stringify(files, null, 2)}\n`, keys };
}

/**
 * Rewrites the switch's generated files when the adopted components or whether their iterations
 * compile changed. Returns whether it wrote.
 */
export function writeContext(repo: string): boolean {
  const sections = contextSections(repo, ENTRY);
  const broken = new Map<string, string>();
  for (const iteration of sections.flatMap(section => section.iterations)) {
    const why = compileProblem(repo, `${ROUGH_DIR}/${iteration.key}`, ENTRY);
    if (why !== null) broken.set(iteration.key, why);
  }
  const { registry, modules, keys } = renderContext(sections, broken);
  let wrote = false;
  for (const [file, text] of [
    [CONTEXT_REGISTRY, registry],
    [CONTEXT_KEYS, keys],
    [CONTEXT_MODULES, modules]
  ] as const) {
    const full = path.join(repo, ...file.split('/'));
    const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    if (current === text) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    wrote = true;
  }
  return wrote;
}

// The edit in next.config: an import at the top, the rule at the end, each marked by its words.
const IMPORT_LINE = `import { existsSync as roughbookExists } from "node:fs";`;
const REQUIRE_LINE = `const { existsSync: roughbookExists } = require("node:fs");`;
const BLOCK_START = '// Roughbook, development only: the in-page view';
/**
 * Turbopack's development cache off (decision 67): `next dev` restarted onto it after files changed
 * while it was down can answer "Lazily compiled dynamic import … was not activated" for an
 * iteration the earlier run never compiled.
 */
const CACHE_SETTING = 'turbopackFileSystemCacheForDev: false';

/** The config file this app has, or null. */
export function nextConfigFile(repo: string): string | null {
  return NEXT_CONFIGS.find(name => read(repo, name) !== null) ?? null;
}

/**
 * What doctor says of a config whose block was written before the cache setting (version 7 and
 * before), or null when it has the setting or no block.
 */
export function nextConfigBehind(repo: string): string | null {
  const file = nextConfigFile(repo);
  const text = file ? read(repo, file) : null;
  if (!file || !text?.includes(BLOCK_START) || text.includes(CACHE_SETTING)) return null;
  return `${file}: the switch's block leaves Turbopack's development cache on (it has no ${CACHE_SETTING}), so \`next dev\` restarted onto that cache can answer "${LAZY_IMPORT_ERROR}" for a preview or a swap`;
}

/** The rule's block, at the end of the config, for the config's variable `name`. */
function configBlock(name: string, appDir: string, typed: boolean, eol: string): string {
  const dir = contextDir(appDir);
  const own = (text: string) => (typed ? `${text} as const` : text);
  return [
    `${BLOCK_START}: shows an iteration in its real page and marks the page's`,
    '// sections (rough/CONTRACT.md). Its rules apply in `next dev` alone, and only once the files beside the',
    `// preview route are there; roughbook uninstall takes this out.`,
    `if (roughbookExists(${JSON.stringify(`${dir}/loader.cjs`)})) {`,
    typed
      ? `  const roughbookConfig: import("next").NextConfig = ${name};`
      : `  const roughbookConfig = ${name};`,
    `  const roughbookRule = (browser${typed ? ': boolean' : ''}) => ({`,
    `    condition: {`,
    `      all: [`,
    `        ${own('"development"')},`,
    `        { not: ${own('"foreign"')} },`,
    `        browser ? ${own('"browser"')} : { not: ${own('"browser"')} },`,
    `        { not: { path: /^(?:${ROUGH_DIR}|${dir.replace(/\//g, '\\/').replace(`\\/context`, '')})\\// } },`,
    `        { not: { query: /roughbook-original/ } },`,
    `      ],`,
    `    },`,
    `    loaders: [{ loader: ${JSON.stringify(`./${dir}/loader.cjs`)}, options: { browser } }],`,
    `  });`,
    `  // An iteration is compiled only when a page asks to show it, so one that does not compile never breaks a page.`,
    `  // Without the development cache: next dev restarted onto it after files changed can lose such an import`,
    `  // ("Lazily compiled dynamic import ... was not activated"). next build keeps its own.`,
    `  roughbookConfig.experimental = {`,
    `    ...roughbookConfig.experimental,`,
    `    ...{ turbopackLazyDynamicImportsSSR: true, ${CACHE_SETTING} },`,
    `  };`,
    `  roughbookConfig.turbopack = {`,
    `    ...roughbookConfig.turbopack,`,
    `    rules: { ...roughbookConfig.turbopack?.rules, "*.{tsx,jsx,js}": [roughbookRule(false), roughbookRule(true)] },`,
    `  };`,
    `}`
  ].join(eol);
}

/** How a config exports itself: `export default <name>;` or `module.exports = <name>;`. */
function exportOf(text: string): { name: string; esm: boolean } | null {
  const esm = /^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(text);
  if (esm) return { name: esm[1]!, esm: true };
  const cjs = /^module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(text);
  return cjs ? { name: cjs[1]!, esm: false } : null;
}

/** The config with the switch's rule; null when it does not export a variable this can extend. */
export function editNextConfig(text: string, file: string, appDir: string): string | null {
  if (text.includes(BLOCK_START)) return null;
  const exported = exportOf(text);
  if (!exported) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const typed = /\.m?ts$/.test(file);
  const first = exported.esm ? IMPORT_LINE : REQUIRE_LINE;
  const lines = text.split(/\r?\n/);
  // After the file's imports (or first statement), so a directive or a type import stays first.
  let at = 0;
  lines.forEach((line, index) => {
    if (/^import\b.*from\s+['"][^'"]+['"];?\s*$/.test(line) || /^const .*= require\(/.test(line)) {
      at = index + 1;
    }
  });
  lines.splice(at, 0, first);
  const body = lines.join(eol).replace(/(?:\r?\n)*$/, '');
  return `${body}${eol}${eol}${configBlock(exported.name, appDir, typed, eol)}${eol}`;
}

/** The config as it was before the edit, or null when it does not have it. */
export function undoNextConfig(text: string): string | null {
  const start = text.indexOf(BLOCK_START);
  if (start === -1) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const close = text.indexOf(`${eol}}`, start);
  if (close === -1) return null;
  let before = text.slice(0, start).replace(/(?:\r?\n)+$/, '');
  const after = text.slice(close + eol.length + 1).replace(/^(?:\r?\n)+/, '');
  for (const line of [IMPORT_LINE, REQUIRE_LINE]) {
    before = before.replace(`${line}${eol}`, '');
  }
  return `${before}${eol}${after}`;
}

/** next.config's edit as `init` plans it: null when it is there; a manual step when it cannot be made. */
export function planNextConfig(
  repo: string,
  appDir: string
): PrepChange | { manual: string } | null {
  const file = nextConfigFile(repo);
  const text = file ? read(repo, file) : null;
  if (file && text?.includes(BLOCK_START)) {
    const plain = undoNextConfig(text);
    const now = plain === null ? null : editNextConfig(plain, file, appDir);
    if (now === null || now === text) return null;
    return { file, action: 'edit', summary: 'Update the in-page view’s rule.', after: now };
  }
  const after = file && text !== null ? editNextConfig(text, file, appDir) : null;
  if (!file || after === null) {
    return {
      manual: `${file ?? 'next.config.ts'}: the in-page view needs a development-only Turbopack rule, which roughbook init adds when the config exports a variable (export default nextConfig;). Add it by hand after rough/CONTRACT.md, or show iterations alone.`
    };
  }
  return {
    file,
    action: 'edit',
    summary: 'Let the dev server show an iteration in its page and mark its sections.',
    after
  };
}
