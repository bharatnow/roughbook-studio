// The in-page view's switch for Nuxt (B5b of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 41 and 42), in
// development only. A second local module in modules/, which Nuxt registers on its own, does nothing
// unless `nuxt dev` runs; there it adds a Vite plugin, on the server and in the browser alike, that
// sends every import of an adopted component's .vue file to a wrapper of its own: the component
// inside its marker, or, for ?roughbook-swap=<page>/<component>/<iteration> on this machine, the
// iteration in its place with the same props and slots, the page's own data. The wrapper reads the
// address with Nuxt's useRequestURL: the request on the server, the page's address in the browser,
// so the page hydrates as it was rendered. Iterations load from a generated registry, only when a
// page asks for one, and one that fails shows why in its place, the page kept. No file of the app's
// is edited.
//
//   modules/rough-context.ts     the module and its Vite plugin  (development only, gitignored)
//   rough/context-section.ts     the wrapper and Pick            (gitignored)
//   rough/context-modules.json   the adopted components          (generated, gitignored)
//   rough/context-registry.ts    the iterations a swap can load  (generated, gitignored)
import fs from 'node:fs';
import path from 'node:path';
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

export const CONTEXT_MODULE = 'modules/rough-context.ts';
export const CONTEXT_SECTION = `${ROUGH_DIR}/context-section.ts`;
export const CONTEXT_MODULES = `${ROUGH_DIR}/context-modules.json`;
export const CONTEXT_REGISTRY = `${ROUGH_DIR}/context-registry.ts`;
const MARKER = 'Roughbook preview';

const MODULE_FILE = `// ${MARKER}: the in-page view's module (${CONTEXT_SENTINEL}). Development only, not committed (see
// .gitignore). Nuxt registers every module in modules/ on its own; this one does nothing unless nuxt dev
// runs, so nuxt build holds nothing of it. In development its Vite plugin sends every import of an
// adopted component (${CONTEXT_MODULES}) to a wrapper that renders it inside its marker, or an iteration
// in its place (${CONTEXT_SECTION}). Written by roughbook init from the Nuxt recipe (setup --upgrade).
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { addVitePlugin, defineNuxtModule } from "nuxt/kit";

type Adopted = Record<string, { export: string; sections: { key: string; address: string | null }[] }>;

const PREFIX = "\\0roughbook-section:";
const slashes = (file: string) => file.split(sep).join("/");

export default defineNuxtModule({
  meta: { name: "roughbook-context" },
  setup(_options, nuxt) {
    if (!nuxt.options.dev) return;
    const root = nuxt.options.rootDir;
    const list = resolve(root, ${JSON.stringify(CONTEXT_MODULES)});
    const section = slashes(resolve(root, ${JSON.stringify(CONTEXT_SECTION)}));
    let known: Adopted = {};
    let names = new Set<string>();
    let stamp = -1;
    // The list changes as components are adopted; it is read again when it does.
    const adopted = (): Adopted => {
      const now = existsSync(list) ? statSync(list).mtimeMs : 0;
      if (now !== stamp) {
        stamp = now;
        try {
          known = JSON.parse(readFileSync(list, "utf8")) as Adopted;
        } catch {
          known = {};
        }
        names = new Set(Object.keys(known).map((file) => basename(file)));
      }
      return known;
    };
    addVitePlugin({
      name: "roughbook-context",
      enforce: "pre",
      // A component adopted, or no longer, while nuxt dev runs: Vite keeps each importer's
      // resolutions, so the importers of the files that changed are transformed again, and the
      // wrapper loaded again, with no restart.
      configureServer(server) {
        // What this server last acted on: a request may have read the new list first.
        let seen = { ...adopted() };
        server.watcher.add(list);
        server.watcher.on("all", (_event: string, file: string) => {
          if (resolve(file) !== list) return;
          const before = seen;
          const after = { ...adopted() };
          seen = after;
          const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
            (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]),
          );
          if (!changed.length) return;
          const graph = server.moduleGraph;
          for (const name of changed) {
            const mods = [
              ...(graph.getModulesByFile(slashes(resolve(root, name))) ?? []),
              graph.getModuleById(\`\${PREFIX}\${name}.js\`),
            ];
            for (const mod of mods) {
              if (!mod) continue;
              graph.invalidateModule(mod);
              for (const importer of mod.importers) graph.invalidateModule(importer);
            }
          }
          server.ws.send({ type: "full-reload" });
        });
      },
      async resolveId(source, importer, options) {
        // The wrapper's own import of the component is the component itself.
        if (!importer || importer.startsWith(PREFIX) || source.startsWith("\\0") || source.includes("?")) return null;
        adopted();
        const name = basename(source);
        if (!names.has(name) && !names.has(\`\${name}.vue\`)) return null;
        const found = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (!found || found.external || found.id.includes("?")) return null;
        const file = slashes(relative(root, found.id));
        // Not ending in .vue, so Vue's own plugin leaves the wrapper alone.
        return known[file] ? \`\${PREFIX}\${file}.js\` : null;
      },
      load(id) {
        if (!id.startsWith(PREFIX)) return null;
        const file = id.slice(PREFIX.length, -".js".length);
        const own = JSON.stringify(slashes(resolve(root, file)));
        return [
          \`import RoughbookOriginal from \${own};\`,
          \`import { wrap as roughbookWrap } from \${JSON.stringify(section)};\`,
          \`export * from \${own};\`,
          \`export default roughbookWrap(RoughbookOriginal, \${JSON.stringify(adopted()[file]?.sections ?? [])});\`,
        ].join("\\n");
      },
    });
  },
});
`;

const SECTION_FILE = `// ${MARKER}: the in-page view's wrapper (${CONTEXT_SENTINEL}). Development only, not committed (see
// .gitignore), on this machine only: an adopted component renders inside its marker, and with
// ?${SWAP_PARAM}=<page>/<component>/<iteration> the iteration renders in its place, with the same props and
// slots, the page's own data. The address is the request's on the server and the page's in the browser.
// With ?${PICK_PARAM}=1 a click names its section to the frame instead of following the page.
import { defineComponent, h, inject, onMounted, provide, type Component, type InjectionKey, type VNode } from "vue";
import { useRequestURL } from "#imports";
import { loaders } from "./context-registry";

type Section = { key: string; address: string | null };

const SENTINEL = "${CONTEXT_SENTINEL}";
const LOOPBACK = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/;
/** The section an iteration was swapped in for, around it: an iteration that renders the original shows it. */
const SWAPPED: InjectionKey<string> = Symbol(SENTINEL);
let picking = false;

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

/** Pick: a click names the marked section it fell in to the frame, instead of following the page. */
function pick() {
  if (picking || new URLSearchParams(window.location.search).get("${PICK_PARAM}") !== "1") return;
  picking = true;
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

export function wrap(Original: Component, sections: Section[]): Component {
  if (!import.meta.dev || !Original || !sections.length) return Original;
  return defineComponent({
    name: "RoughbookSection",
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      const url = useRequestURL();
      if (!LOOPBACK.test(url.hostname)) return () => h(Original, attrs, slots);
      const around = inject(SWAPPED, null);
      const key = keyFor(sections, url.pathname);
      const markers = url.searchParams.get("${MARKERS_PARAM}") !== "0";
      const swap = url.searchParams.get("${SWAP_PARAM}");
      onMounted(pick);
      const shown = (body: () => VNode, extra: Record<string, string> = {}) => () =>
        markers ? h("${MARKER_ELEMENT}", { "${SECTION_ATTRIBUTE}": key, ...extra, style: { display: "contents" } }, [body()]) : body();
      const load = swap && around !== key && swap.startsWith(key + "/") ? loaders[swap] : undefined;
      if (!swap || !load) return shown(() => h(Original, attrs, slots));
      provide(SWAPPED, key);
      // Loaded before the section renders, on the server and as the page hydrates alike.
      return load().then(
        (module) => {
          const Iteration = (module as { default: Component }).default;
          return shown(() => h(Iteration, attrs, slots), { "${SWAPPED_ATTRIBUTE}": swap });
        },
        (error: unknown) =>
          shown(
            () => h("pre", { style: { whiteSpace: "pre-wrap" } }, \`\${swap} failed: \${error instanceof Error ? error.message : String(error)}\`),
            { "data-roughbook-error": swap },
          ),
      );
    },
  });
}
`;

/** The switch's files, as `init` writes them for a mapped repo. */
export function contextFiles(): { file: string; content: string }[] {
  return [
    { file: CONTEXT_MODULE, content: MODULE_FILE },
    { file: CONTEXT_SECTION, content: SECTION_FILE }
  ];
}

/** Whether a file is one of the switch's, so a file of the app's own is never overwritten. */
export function isOurContextFile(text: string | null): boolean {
  return Boolean(text?.includes(CONTEXT_SENTINEL));
}

/**
 * rough/context-modules.json (each adopted .vue file, its sections) and rough/context-registry.ts
 * (each iteration a swap can load), as the adopted components are now.
 */
export function renderContext(sections: ContextSection[]): { modules: string; registry: string } {
  const modules: Record<
    string,
    { export: string; sections: { key: string; address: string | null }[] }
  > = {};
  const loaders: string[] = [];
  for (const section of sections) {
    const file = section.source.files[0];
    if (!file?.endsWith('.vue')) continue;
    const entry = (modules[file] ??= { export: 'default', sections: [] });
    entry.sections.push({ key: section.key, address: section.address });
    for (const iteration of section.iterations) {
      loaders.push(
        `  ${JSON.stringify(iteration.key)}: () => import(${JSON.stringify(`./${iteration.key}/${ENTRY}`)}),\n`
      );
    }
  }
  const registry = `// Generated by Roughbook from the adopted components in this folder, for the in-page view. Do not edit.
/** The iterations a page can show in a component's place, loaded only when a page asks for one. */
export const loaders: Record<string, () => Promise<unknown>> = {
${loaders.join('')}};
`;
  return { modules: `${JSON.stringify(modules, null, 2)}\n`, registry };
}

/** Rewrites the switch's generated files when the adopted components changed. Returns whether it wrote. */
export function writeContext(repo: string): boolean {
  const { modules, registry } = renderContext(contextSections(repo, ENTRY));
  let wrote = false;
  for (const [file, text] of [
    [CONTEXT_MODULES, modules],
    [CONTEXT_REGISTRY, registry]
  ] as const) {
    const full = path.join(repo, ...file.split('/'));
    if (fs.existsSync(full) && fs.readFileSync(full, 'utf8') === text) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    wrote = true;
  }
  return wrote;
}
