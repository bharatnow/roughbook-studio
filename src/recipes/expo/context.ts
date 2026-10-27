// The in-page view's switch for Expo (B5b of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 41, 42 and
// 44), on the web target alone and in development only. metro.config gains a block that, while the
// switch's folder is there, hands Metro's config to rough/_context/metro.cjs: its resolver sends the
// app's imports of an adopted component's file, for a development bundle of the web target, to a
// generated wrapper that re-exports the file and puts each adopted export inside its marker. The
// wrapper reads the page's address through Expo Router, the same on the dev server's own render
// and in the browser, so the HTML hydrates; for `?roughbook-swap=<page>/<component>/<iteration>` it
// renders the iteration from the preview registry in the component's place, with the same props,
// the page's own data. Native bundles resolve as before: a device shows components alone.
//
//   rough/_context/metro.cjs        the resolver, run by Metro in Node      (gitignored)
//   rough/_context/section.tsx      the wrapper's marker, swap and Pick
//   rough/_context/modules.json     the adopted files and their wrappers   (generated)
//   rough/_context/<file>.tsx       one wrapper per adopted file           (generated)
//   metro.config.js                 a block at its end (or the file, when the app has none)
//
// The folder's name is no page slug, so the studio never takes it for one. On the server the switch
// relies on the dev server answering this machine alone (`expo start --localhost` binds Metro to
// loopback); in the browser it checks the page's address itself.
import fs from 'node:fs';
import path from 'node:path';
import { readMap } from '../../map/file.js';
import { read, type PrepChange } from '../../repo/plan.js';
import { ROUGH_DIR } from '../../repo/root.js';
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
import { ENTRY, PREVIEW_ROUTE, REGISTRY_FILE } from './preview.js';

export const CONTEXT_DIR = `${ROUGH_DIR}/_context`;
export const METRO_FILE = `${CONTEXT_DIR}/metro.cjs`;
export const SECTION_FILE = `${CONTEXT_DIR}/section.tsx`;
export const CONTEXT_MODULES = `${CONTEXT_DIR}/modules.json`;
export const METRO_CONFIG = 'metro.config.js';
/** Metro configs the switch cannot extend with a CommonJS block. */
const OTHER_CONFIGS = ['metro.config.cjs', 'metro.config.mjs', 'metro.config.ts'];
const MARKER = 'Roughbook preview route';

const MODULE = /\.(tsx|ts|jsx|js)$/;
const NAME = /^(default|[A-Za-z_$][\w$]*)$/;

const METRO = `// ${MARKER}: the in-page view's resolver (${CONTEXT_SENTINEL}). Development only: metro.config
// hands Metro's config here while this folder is there. For a development bundle of the web target, the
// app's imports of an adopted component's file resolve to its wrapper beside this file, which marks it and
// can show an iteration in its place; native bundles and production builds resolve as before.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const LIST = path.join(__dirname, "modules.json");
let cached = { mtime: -1, modules: {} };

/** The adopted files and their wrappers, read again when the list changes. */
function modules() {
  try {
    const mtime = fs.statSync(LIST).mtimeMs;
    if (mtime !== cached.mtime) cached = { mtime, modules: JSON.parse(fs.readFileSync(LIST, "utf8")) };
  } catch {
    cached = { mtime: -1, modules: {} };
  }
  return cached.modules;
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join("/");

function withRoughbookContext(config) {
  if (config && typeof config.then === "function") return config.then(withRoughbookContext);
  // \`expo export\` bundles for production: the switch is not there at all.
  if (process.env.NODE_ENV === "production") return config;
  const own = config.resolver && config.resolver.resolveRequest;
  return {
    ...config,
    resolver: {
      ...config.resolver,
      resolveRequest(context, moduleName, platform) {
        const resolved = own ? own(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
        if (!context.dev || platform !== "web" || !resolved || resolved.type !== "sourceFile") return resolved;
        // The wrappers and the iterations import the app's real files.
        if (relative(context.originModulePath || ROOT).startsWith(${JSON.stringify(`${ROUGH_DIR}/`)})) return resolved;
        const wrapper = modules()[relative(resolved.filePath)];
        return typeof wrapper === "string" ? { type: "sourceFile", filePath: path.join(ROOT, ...wrapper.split("/")) } : resolved;
      },
    },
  };
}

module.exports = withRoughbookContext;
`;

const SECTION = `// ${MARKER}: the in-page view on the web target (${CONTEXT_SENTINEL}). Development only: the wrappers beside
// this file put each adopted component inside its marker, and with ?${SWAP_PARAM}=<page>/<component>/<iteration>
// render the iteration in its place, with the same props, the page's own data. The address comes from Expo
// Router, the same in the dev server's own render and in the browser, so the page hydrates as rendered.
import { createElement, useEffect, type ComponentType, type ReactNode } from "react";
import { Platform } from "react-native";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { loaders } from "../${REGISTRY_FILE.replace(/\.ts$/, '')}";

const SENTINEL = "${CONTEXT_SENTINEL}";
const LOOPBACK = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/;

type Keys = { key: string; address: string | null }[];

/** Whether the page's path is an address: a dynamic segment (\`[slug]\`) matches any one segment. */
function matches(address: string | null, pathname: string): boolean {
  if (address === null) return false;
  const want = address.replace(/\\/+$/, "").split("/");
  const have = pathname.replace(/\\/+$/, "").split("/");
  return want.length === have.length && want.every((part, index) => /^\\[.*\\]$|^\\{.*\\}$|^:/.test(part) || part === have[index]);
}

/** The marker's key: the page the path is, among those the component is adopted on, else the first. */
function keyFor(keys: Keys, pathname: string): string {
  return (keys.find((item) => matches(item.address, pathname)) ?? keys[0]!).key;
}

let listening = false;

/** With ?${PICK_PARAM}=1, a click posts { roughbook: "section", key } to the frame instead of following the page. */
function Pick() {
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

/** The iteration, required only when a page asks to show it. */
function Swapped({ id, props }: { id: string; props: Record<string, unknown> }) {
  const Shown = loaders[id]!().default;
  return createElement(Shown, props);
}

/** What makes a memo or a forwardRef what it is, never copied onto the wrapper. */
const OWN = new Set(["$$typeof", "type", "render", "compare", "prototype", "length", "name"]);

export function wrap<P extends object>(Original: ComponentType<P>, keys: Keys): ComponentType<P> {
  if (!__DEV__ || Platform.OS !== "web" || !Original || !keys.length) return Original;
  function RoughbookSection(props: P): ReactNode {
    const params = useGlobalSearchParams<Record<string, string | string[]>>();
    const pathname = usePathname();
    const one = (name: string) => {
      const value = params[name];
      return Array.isArray(value) ? value[0] : value;
    };
    // In the browser, this machine only; the dev server answers it alone (expo start --localhost).
    const host = typeof window === "undefined" ? null : window.location.hostname;
    if ((host !== null && !LOOPBACK.test(host)) || pathname.startsWith("/${PREVIEW_ROUTE}")) {
      return createElement(Original, props);
    }
    const key = keyFor(keys, pathname);
    const swap = one("${SWAP_PARAM}");
    const shown = swap && swap.startsWith(key + "/") && loaders[swap] ? swap : null;
    const body = shown
      ? createElement(Swapped, { id: shown, props: props as Record<string, unknown> })
      : createElement(Original, props);
    if (one("${MARKERS_PARAM}") === "0") return body;
    return createElement(
      "${MARKER_ELEMENT}",
      { "${SECTION_ATTRIBUTE}": key, ...(shown ? { "${SWAPPED_ATTRIBUTE}": shown } : {}), style: { display: "contents" } },
      body,
      createElement(Pick),
    );
  }
  RoughbookSection.displayName = SENTINEL;
  for (const [name, value] of Object.entries(Original)) {
    if (!OWN.has(name)) (RoughbookSection as unknown as Record<string, unknown>)[name] = value;
  }
  return RoughbookSection as ComponentType<P>;
}
`;

/** The switch's own files, as `init` writes them. */
export function contextFiles(): { file: string; content: string }[] {
  return [
    { file: METRO_FILE, content: METRO },
    { file: SECTION_FILE, content: SECTION }
  ];
}

/** The wrapper of an adopted file: `src/components/hint-row.tsx` is `rough/_context/src__components__hint-row.tsx`. */
function wrapperOf(file: string): string {
  return `${CONTEXT_DIR}/${file.replace(MODULE, '').split('/').join('__')}.tsx`;
}

/** The file's web variant beside it, which Metro resolves the same import to on the web target. */
function webVariant(repo: string, file: string): string | null {
  const base = file.replace(MODULE, '');
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    const variant = `${base}.web${ext}`;
    if (fs.existsSync(path.join(repo, ...variant.split('/')))) return variant;
  }
  return null;
}

/**
 * The wrappers and rough/_context/modules.json, as the adopted components are now. Every file of
 * `mapped` (the map's sections and shared parts) has a wrapper too, passing it through until one
 * of its exports is adopted: Metro keeps an importer's resolutions until the importer changes, so
 * the list stays the same as components are adopted, and only a wrapper's text changes, which
 * Metro sees and reloads while it runs (decision 61).
 */
export function renderContext(
  repo: string,
  sections: ContextSection[],
  mapped: string[] = []
): { modules: string; wrappers: Record<string, string> } {
  const byFile = new Map<string, Map<string, { key: string; address: string | null }[]>>();
  for (const file of mapped) {
    if (MODULE.test(file) && !/\.web\.[jt]sx?$/.test(file)) byFile.set(file, new Map());
  }
  for (const section of sections) {
    const file = section.source.files[0];
    const name = section.source.export;
    if (!file || !MODULE.test(file) || /\.web\.[jt]sx?$/.test(file) || !NAME.test(name)) continue;
    const names = byFile.get(file) ?? new Map<string, { key: string; address: string | null }[]>();
    names.set(name, [...(names.get(name) ?? []), { key: section.key, address: section.address }]);
    byFile.set(file, names);
  }
  const modules: Record<string, string> = {};
  const wrappers: Record<string, string> = {};
  for (const [file, names] of byFile) {
    const wrapper = wrapperOf(file);
    const variant = webVariant(repo, file);
    modules[file] = wrapper;
    if (variant) modules[variant] = wrapper;
    const spec = JSON.stringify(
      path.posix.relative(CONTEXT_DIR, file.replace(MODULE, '')).replace(/^(?!\.)/, './')
    );
    const lines = [
      `// Generated by Roughbook for the in-page view (${CONTEXT_SENTINEL}): ${file} as the app has it, its`,
      '// adopted exports inside their markers. Development only, on the web target. Do not edit.',
      ...(names.size
        ? [
            `import * as RoughbookOriginal from ${spec};`,
            'import { wrap as roughbookWrap } from "./section";'
          ]
        : []),
      `export * from ${spec};`
    ];
    const keyed = (name: string) =>
      `roughbookWrap(RoughbookOriginal.${name}, ${JSON.stringify(names.get(name))})`;
    for (const name of names.keys()) {
      if (name === 'default') lines.push(`export default ${keyed('default')};`);
      else lines.push(`export const ${name} = ${keyed(name)};`);
    }
    const texts = [file, variant].map(item => (item ? (read(repo, item) ?? '') : ''));
    if (
      !names.has('default') &&
      texts.some(text => /\bexport\s+default\b|\bas\s+default\b/.test(text))
    ) {
      lines.push(`export { default } from ${spec};`);
    }
    wrappers[wrapper] = `${lines.join('\n')}\n`;
  }
  const sorted = Object.fromEntries(Object.entries(modules).sort(([a], [b]) => a.localeCompare(b)));
  return { modules: `${JSON.stringify(sorted, null, 2)}\n`, wrappers };
}

/**
 * The files of the map's sections and shared parts that are in the app now: each has a wrapper
 * from the start. Not an atom's, which every page imports many times over.
 */
function mappedFiles(repo: string): string[] {
  let map;
  try {
    map = readMap(repo)?.map;
  } catch {
    return [];
  }
  return (map?.components ?? [])
    .filter(item => item.kind !== 'atom')
    .map(item => item.files[0])
    .filter((file): file is string => !!file && fs.existsSync(path.join(repo, ...file.split('/'))));
}

/** The generated wrappers in rough/_context/ now, repo-relative. */
export function wrapperFiles(repo: string): string[] {
  try {
    return fs
      .readdirSync(path.join(repo, ...CONTEXT_DIR.split('/')))
      .filter(name => name.endsWith('.tsx') && `${CONTEXT_DIR}/${name}` !== SECTION_FILE)
      .map(name => `${CONTEXT_DIR}/${name}`)
      .sort();
  } catch {
    return [];
  }
}

/** Rewrites the wrappers and their list when the adopted components changed. Returns whether it wrote. */
export function writeContext(repo: string): boolean {
  const { modules, wrappers } = renderContext(
    repo,
    contextSections(repo, ENTRY),
    mappedFiles(repo)
  );
  let wrote = false;
  for (const file of wrapperFiles(repo)) {
    if (wrappers[file] !== undefined) continue;
    fs.rmSync(path.join(repo, ...file.split('/')), { force: true });
    wrote = true;
  }
  for (const [file, text] of [[CONTEXT_MODULES, modules], ...Object.entries(wrappers)] as const) {
    const full = path.join(repo, ...file.split('/'));
    if (fs.existsSync(full) && fs.readFileSync(full, 'utf8') === text) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    wrote = true;
  }
  return wrote;
}

// metro.config's block, at the end of the file, marked by its first words.
const BLOCK_START = '// Roughbook, development only: the in-page view';
const OWN_CONFIG_START = '// Written by Roughbook for the in-page view';

function configBlock(eol: string): string {
  return [
    `${BLOCK_START} shows an iteration in its real page on the web target and`,
    "// marks the page's sections (rough/CONTRACT.md). It applies to `expo start` alone, and only while",
    `// ${CONTEXT_DIR}/ is there; roughbook uninstall takes this out.`,
    `if (require("node:fs").existsSync(require("node:path").join(__dirname, ${JSON.stringify(METRO_FILE)}))) {`,
    `  module.exports = require(${JSON.stringify(`./${METRO_FILE}`)})(module.exports);`,
    '}'
  ].join(eol);
}

/** The config with the switch's block at its end; null when it has it. */
export function editMetroConfig(text: string): string | null {
  if (text.includes(BLOCK_START)) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = text.replace(/(?:\r?\n)*$/, '');
  return `${body}${eol}${eol}${configBlock(eol)}${eol}`;
}

/** The config as it was before the edit, or null when it does not have it. */
export function undoMetroConfig(text: string): string | null {
  const start = text.indexOf(BLOCK_START);
  if (start === -1) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const close = text.indexOf(`${eol}}`, start);
  if (close === -1) return null;
  const before = text.slice(0, start).replace(/(?:\r?\n)+$/, '');
  const after = text.slice(close + eol.length + 1).replace(/^(?:\r?\n)+/, '');
  return `${before}${eol}${after}`;
}

/** Expo's default config, with the block, for an app that has none: the switch's own file. */
const OWN_CONFIG = `${OWN_CONFIG_START}, since the app had no Metro config: Expo's
// default, with the development-only switch below. roughbook uninstall removes this file.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);

${configBlock('\n')}
`;

export function isOwnMetroConfig(text: string | null): boolean {
  return Boolean(text?.startsWith(OWN_CONFIG_START));
}

/** metro.config's edit as `init` plans it: null when it is there; a manual step when it cannot be made. */
export function planMetroConfig(repo: string): PrepChange | { manual: string } | null {
  const other = OTHER_CONFIGS.find(file => read(repo, file) !== null);
  const text = read(repo, METRO_CONFIG);
  if (text === null && other) {
    return {
      manual: `${other}: the in-page view needs Metro's config handed to ${METRO_FILE} in development, which roughbook init adds to a CommonJS metro.config.js. Add at its end, by hand: when ${METRO_FILE} exists, export require("./${METRO_FILE}")(config) instead of config. Or show iterations alone.`
    };
  }
  if (text === null) {
    return {
      file: METRO_CONFIG,
      action: 'create',
      summary: "Add Expo's Metro config, with the in-page view's development-only switch.",
      after: OWN_CONFIG
    };
  }
  if (isOwnMetroConfig(text)) {
    return text === OWN_CONFIG
      ? null
      : {
          file: METRO_CONFIG,
          action: 'edit',
          summary: 'Update the in-page view’s Metro config.',
          after: OWN_CONFIG
        };
  }
  const plain = undoMetroConfig(text) ?? text;
  const after = editMetroConfig(plain)!;
  if (after === text) return null;
  return {
    file: METRO_CONFIG,
    action: 'edit',
    summary:
      'Let the dev server show an iteration in its page and mark its sections, on the web target.',
    after
  };
}
