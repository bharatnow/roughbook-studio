// The in-page view's switch for Vite with React (B5b of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 41
// and 42), in development only. A Vite app renders in the browser, with no server of its own, so
// the switch is a Vite plugin that applies to the dev server alone (`apply: "serve"`; `vite build`
// never runs it) and wraps each adopted component's module: the module re-exports the file as it
// is (imported again with ?roughbook-original, which the plugin leaves alone) and puts the adopted
// export inside its marker. The wrapper reads the swap from the page's address in the browser, on
// this machine only, and renders the iteration in the component's place with the same props, the
// page's own data. Iterations are found with import.meta.glob and loaded only when a page asks for
// one, so one that does not compile fails that page alone.
//
//   rough/context-plugin.mjs     the plugin, run by Vite in Node      (gitignored)
//   rough/context-section.tsx    the wrapper and Pick, in the browser  (gitignored)
//   rough/context-modules.json   the adopted modules (generated, gitignored)
//   vite.config.*                an import, the plugin in `plugins`, and the function that loads it
import fs from 'node:fs';
import path from 'node:path';
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
import { ENTRY } from './preview.js';

export const CONTEXT_PLUGIN = `${ROUGH_DIR}/context-plugin.mjs`;
export const CONTEXT_SECTION = `${ROUGH_DIR}/context-section.tsx`;
export const CONTEXT_MODULES = `${ROUGH_DIR}/context-modules.json`;
const MARKER = 'Roughbook preview page';

export const VITE_CONFIGS = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs'
];

const PLUGIN_FILE = `// ${MARKER}: the in-page view's Vite plugin (${CONTEXT_SENTINEL}). Development only, not committed
// (see .gitignore): vite.config adds it when this file is there, and it applies to the dev server alone,
// never to \`vite build\`. An adopted component's module becomes a wrapper that re-exports the file as it is
// and puts the adopted export inside its marker (context-section.tsx); every other module is left as it is.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIST = path.join(ROOT, ${JSON.stringify(ROUGH_DIR)}, "context-modules.json");
const SECTION = path.join(ROOT, ${JSON.stringify(ROUGH_DIR)}, "context-section.tsx");
const NAME = /^[A-Za-z_$][\\w$]*$/;

/** The adopted modules, by their repo-relative files: the export each renders, and its sections. */
function adopted() {
  try {
    return JSON.parse(fs.readFileSync(LIST, "utf8"));
  } catch {
    return {};
  }
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

export default function roughbookContext() {
  let known = adopted();
  return {
    name: "roughbook-context",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      // The list changes as components are adopted: the wrappers follow without a restart.
      server.watcher.add(LIST);
      server.watcher.on("all", (_event, file) => {
        if (path.resolve(file) !== LIST) return;
        const before = Object.keys(known);
        known = adopted();
        for (const name of new Set([...before, ...Object.keys(known)])) {
          for (const mod of server.moduleGraph.getModulesByFile(path.join(ROOT, name)) ?? []) {
            server.moduleGraph.invalidateModule(mod);
          }
        }
        server.ws.send({ type: "full-reload" });
      });
    },
    transform(code, id) {
      // The file itself, with no query: ?roughbook-original, and Vite's own, are left as they are.
      if (id.includes("?") || id.startsWith("\\0")) return null;
      const entry = known[relative(id)];
      if (!entry || !NAME.test(entry.export)) return null;
      const own = JSON.stringify("./" + path.basename(id) + "?roughbook-original");
      let helper = path.relative(path.dirname(id), SECTION).split(path.sep).join("/");
      if (!helper.startsWith(".")) helper = "./" + helper;
      const wrapped =
        "roughbookWrap(RoughbookOriginal[" + JSON.stringify(entry.export) + "], " + JSON.stringify(entry.sections) + ")";
      const lines = [
        "import * as RoughbookOriginal from " + own + ";",
        "import { wrap as roughbookWrap } from " + JSON.stringify(helper) + ";",
        "export * from " + own + ";",
      ];
      if (entry.export === "default") lines.push("export default " + wrapped + ";");
      else {
        lines.push("export const " + entry.export + " = " + wrapped + ";");
        if (/\\bexport\\s+default\\b|\\bas\\s+default\\b/.test(code)) lines.push("export { default } from " + own + ";");
      }
      return { code: lines.join("\\n") + "\\n", map: null };
    },
  };
}
`;

const SECTION_FILE = `// ${MARKER}: the in-page view in the browser (${CONTEXT_SENTINEL}). Development only, not committed
// (see .gitignore), on this machine only: an adopted component renders inside its marker, and with
// ?${SWAP_PARAM}=<page>/<component>/<iteration> the iteration renders in its place, with the same props,
// the page's own data. With ?${PICK_PARAM}=1 a click names its section to the frame instead of following the page.
import {
  Component,
  Suspense,
  createContext,
  createElement,
  lazy,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";

type Props = Record<string, unknown>;
type Section = { key: string; address: string | null };

const SENTINEL = "${CONTEXT_SENTINEL}";
const LOOPBACK = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/;
const iterations = import.meta.glob("./*/*/iteration-*/${ENTRY}") as Record<
  string,
  () => Promise<{ default: ComponentType<Props> }>
>;
/** The section an iteration was swapped in for, around it: an iteration that renders the original shows it. */
const Swapped = createContext<string | null>(null);
const loaded = new Map<string, ComponentType<Props>>();

function matches(address: string | null, pathname: string): boolean {
  if (address === null) return false;
  const want = address.replace(/\\/+$/, "").split("/");
  const have = pathname.replace(/\\/+$/, "").split("/");
  return want.length === have.length && want.every((part, index) => /^\\[.*\\]$|^\\{.*\\}$|^:/.test(part) || part === have[index]);
}

/** The marker's key: the page the address is, among those the component is adopted on, else the first. */
function keyFor(sections: Section[], pathname: string): string {
  return (sections.find((item) => matches(item.address, pathname)) ?? sections[0]!).key;
}

function marker(key: string, body: ReactNode, extra: Props = {}): ReactNode {
  return createElement("${MARKER_ELEMENT}", { "${SECTION_ATTRIBUTE}": key, ...extra, style: { display: "contents" } }, body);
}

/** An iteration that fails shows why in its place, marked without the swap, so the page is not lost. */
class Failed extends Component<{ section: string; swap: string; markers: boolean; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const shown = createElement("pre", { style: { whiteSpace: "pre-wrap" } }, \`\${this.props.swap} failed: \${error}\`);
    return this.props.markers ? marker(this.props.section, shown, { "data-roughbook-error": this.props.swap }) : shown;
  }
}

const here = typeof window === "undefined" ? null : window.location;
const live = import.meta.env.DEV && here !== null && LOOPBACK.test(here.hostname);

// Pick: a click names the marked section it fell in to the frame, instead of following the page.
if (live && new URLSearchParams(here!.search).get("${PICK_PARAM}") === "1") {
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
}

function iteration(swap: string): ComponentType<Props> | null {
  const load = iterations[\`./\${swap}/${ENTRY}\`];
  if (!load) return null;
  if (!loaded.has(swap)) loaded.set(swap, lazy(load));
  return loaded.get(swap)!;
}

export function wrap<P extends Props>(Original: ComponentType<P>, sections: Section[]): ComponentType<P> {
  if (!live || !Original || !sections.length) return Original;
  function RoughbookSection(props: P): ReactNode {
    const around = useContext(Swapped);
    const search = new URLSearchParams(window.location.search);
    const key = keyFor(sections, window.location.pathname);
    const markers = search.get("${MARKERS_PARAM}") !== "0";
    const swap = search.get("${SWAP_PARAM}");
    const Shown = swap && around !== key && swap.startsWith(key + "/") ? iteration(swap) : null;
    if (!Shown || !swap) {
      const own = createElement(Original as ComponentType<Props>, props);
      return markers ? marker(key, own) : own;
    }
    const body = createElement(
      Swapped.Provider,
      { value: key },
      createElement(Suspense, { fallback: null }, createElement(Shown, props)),
    );
    return createElement(
      Failed,
      { section: key, swap, markers },
      markers ? marker(key, body, { "${SWAPPED_ATTRIBUTE}": swap }) : body,
    );
  }
  RoughbookSection.displayName = SENTINEL;
  return Object.assign(RoughbookSection, Original) as ComponentType<P>;
}
`;

/** The switch's files, as `init` writes them for a mapped repo. */
export function contextFiles(): { file: string; content: string }[] {
  return [
    { file: CONTEXT_PLUGIN, content: PLUGIN_FILE },
    { file: CONTEXT_SECTION, content: SECTION_FILE }
  ];
}

/** Whether a file is one of the switch's, so a file of the app's own is never overwritten. */
export function isOurContextFile(text: string | null): boolean {
  return Boolean(text?.includes(CONTEXT_SENTINEL));
}

/** rough/context-modules.json: each adopted module's file, the export it renders and its sections. */
export function renderModules(sections: ContextSection[]): string {
  const modules: Record<
    string,
    { export: string; sections: { key: string; address: string | null }[] }
  > = {};
  for (const section of sections) {
    const file = section.source.files[0];
    const name = section.source.export;
    if (!file || !/\.(tsx|jsx|ts|js)$/.test(file) || !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    const entry = (modules[file] ??= { export: name, sections: [] });
    entry.sections.push({ key: section.key, address: section.address });
  }
  return `${JSON.stringify(modules, null, 2)}\n`;
}

/** Rewrites rough/context-modules.json when the adopted components changed. Returns whether it wrote. */
export function writeContext(repo: string): boolean {
  const text = renderModules(contextSections(repo, ENTRY));
  const full = path.join(repo, ...CONTEXT_MODULES.split('/'));
  if (fs.existsSync(full) && fs.readFileSync(full, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return true;
}

// The edit in vite.config: an import after the imports, the plugin first in `plugins`, and the
// function that loads it at the end, each in words of its own.
const IMPORT_LINE = `import { existsSync as roughbookExists } from "node:fs";`;
const PLUGIN_CALL = 'roughbookContext(), ';
const BLOCK_START = '// Roughbook, development only: the in-page view';

/** The config file this app has, or null. */
export function viteConfigFile(repo: string): string | null {
  return VITE_CONFIGS.find(name => read(repo, name) !== null) ?? null;
}

function configBlock(eol: string): string {
  return [
    `${BLOCK_START}: shows an iteration in its real page and marks the page's`,
    `// sections (rough/CONTRACT.md). Its plugin applies to the dev server alone, and only once its file is`,
    `// there; roughbook uninstall takes this out.`,
    `function roughbookContext() {`,
    `  const file = new URL(${JSON.stringify(`./${CONTEXT_PLUGIN}`)}, import.meta.url);`,
    `  return roughbookExists(file) ? import(/* @vite-ignore */ file.href).then((plugin) => plugin.default()) : null;`,
    `}`
  ].join(eol);
}

/** The config with the switch's plugin; null when it has no `plugins: [` to put it in. */
export function editViteConfig(text: string): string | null {
  if (text.includes(BLOCK_START)) return null;
  const plugins = /\bplugins\s*:\s*\[/.exec(text);
  if (!plugins) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const at = plugins.index + plugins[0].length;
  const withPlugin = `${text.slice(0, at)}${PLUGIN_CALL}${text.slice(at)}`;
  const lines = withPlugin.split(/\r?\n/);
  let after = 0;
  lines.forEach((line, index) => {
    if (/^import\b.*from\s+['"][^'"]+['"];?\s*$/.test(line)) after = index + 1;
  });
  lines.splice(after, 0, IMPORT_LINE);
  const body = lines.join(eol).replace(/(?:\r?\n)*$/, '');
  return `${body}${eol}${eol}${configBlock(eol)}${eol}`;
}

/** The config as it was before the edit, or null when it does not have it. */
export function undoViteConfig(text: string): string | null {
  const start = text.indexOf(BLOCK_START);
  if (start === -1) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const close = text.indexOf(`${eol}}`, start);
  if (close === -1) return null;
  let before = text.slice(0, start).replace(/(?:\r?\n)+$/, '');
  const after = text.slice(close + eol.length + 1).replace(/^(?:\r?\n)+/, '');
  before = before.replace(`${IMPORT_LINE}${eol}`, '').replace(PLUGIN_CALL, '');
  return `${before}${eol}${after}`;
}

/** vite.config's edit as `init` plans it: null when it is there; a manual step when it cannot be made. */
export function planViteConfig(repo: string): PrepChange | { manual: string } | null {
  const file = viteConfigFile(repo);
  const text = file ? read(repo, file) : null;
  if (file && text?.includes(BLOCK_START)) {
    const plain = undoViteConfig(text);
    const now = plain === null ? null : editViteConfig(plain);
    if (now === null || now === text) return null;
    return { file, action: 'edit', summary: 'Update the in-page view’s plugin.', after: now };
  }
  const after = text !== null ? editViteConfig(text) : null;
  if (!file || after === null) {
    return {
      manual: `${file ?? 'vite.config.ts'}: the in-page view needs a development-only Vite plugin, which roughbook init adds to the config's plugins: [ ... ]. Add it by hand after rough/CONTRACT.md, or show iterations alone.`
    };
  }
  return {
    file,
    action: 'edit',
    summary: 'Let the dev server show an iteration in its page and mark its sections.',
    after
  };
}
