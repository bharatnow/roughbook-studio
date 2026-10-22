// Nuxt: a local module in modules/ (Nuxt registers every module there on its own) that does
// nothing unless `nuxt dev` runs, so `nuxt build` holds nothing from rough/ (the build gate). In
// development it shows one iteration at /rough-preview/<page>/<component>/<iteration>, in place of
// app.vue for that address, and adds the address to the app's router where it has pages, so the
// router does not answer it with its 404. Four pieces:
//
//   modules/rough-preview.ts     the module (development only, gitignored)
//   rough/preview-page.vue       the page: one iteration by the key in its address (gitignored)
//   rough/preview-registry.ts    one loader per iteration, generated (gitignored)
//   rough/preview.vue            wraps iterations in what the app's pages need (committed)
//
// The registry is a file the studio rewrites when iterations come and go, as the Next.js recipe's
// is: Nuxt's server render keeps the list a glob import gave it when a file is added, while a
// change to a file it imports reaches it. Vite's hot reload shows a changed iteration on its own.
import fs from 'node:fs';
import path from 'node:path';
import { listFixtures, listIterations } from '../../repo/iterations.js';
import { ROUGH_DIR } from '../../repo/root.js';

export const MODULE_FILE = 'modules/rough-preview.ts';
export const PAGE_FILE = `${ROUGH_DIR}/preview-page.vue`;
export const WRAPPER = `${ROUGH_DIR}/preview.vue`;
export const REGISTRY_FILE = `${ROUGH_DIR}/preview-registry.ts`;
export const ENTRY = 'index.vue';
export const FIXTURE = 'preview.json';
const MARKER = 'Roughbook preview';

export const PREVIEW_MODULE = `// ${MARKER} module: development only, not committed (see .gitignore). Nuxt registers every
// module in modules/ on its own; this one does nothing unless nuxt dev runs, so nuxt build holds
// nothing from ${ROUGH_DIR}/ (the build gate). In development it shows one iteration at
// /rough-preview/<page>/<component>/<iteration>, in place of app.vue for that address, and adds the
// address to the router of an app with pages, whose router would otherwise answer it with its 404.
// Written by roughbook init from the Nuxt recipe, which rewrites it (roughbook setup --upgrade).
import { resolve } from "node:path";
import { addTemplate, addVitePlugin, defineNuxtModule } from "nuxt/kit";

export default defineNuxtModule({
  meta: { name: "roughbook-preview" },
  setup(_options, nuxt) {
    if (!nuxt.options.dev) return;
    const page = resolve(nuxt.options.rootDir, "${PAGE_FILE}");
    let original = "";
    const main = addTemplate({
      filename: "rough-preview-main.vue",
      write: true,
      getContents: () => \`<script setup lang="ts">
import { useRequestURL } from "#imports";
import App from \${JSON.stringify(original)};
import Preview from \${JSON.stringify(page)};

const shown = useRequestURL().pathname.startsWith("/rough-preview/");
</script>

<template>
  <Preview v-if="shown" />
  <App v-else />
</template>
\`
    });
    // ${ROUGH_DIR}/ is outside the app's source folder, which is all Vite watches here: watched too, an
    // iteration added while the server runs is in the page's list of iterations at once.
    addVitePlugin({
      name: "roughbook-preview-watch",
      configureServer(server) {
        server.watcher.add(resolve(nuxt.options.rootDir, "${ROUGH_DIR}"));
      }
    });
    nuxt.hook("app:resolve", app => {
      if (app.mainComponent && app.mainComponent !== main.dst) original = app.mainComponent;
      if (original) app.mainComponent = main.dst;
    });
    // Only where the app has pages: Nuxt asks this hook whether it has any, and a route of ours
    // alone would turn its router on and send the app's own addresses to its 404.
    const own = nuxt.options.pages as boolean | { enabled?: boolean } | undefined;
    const pagesOn = own === true || (typeof own === "object" && own.enabled === true);
    nuxt.hook("pages:extend", pages => {
      if (!pages.length && !pagesOn) return;
      pages.push({ name: "rough-preview", path: "/rough-preview/:key(.*)*", file: page });
    });
  }
});
`;

export const PREVIEW_PAGE = `<script setup lang="ts">
// ${MARKER} page: development only, not committed (see .gitignore). It shows one iteration from
// this folder, by the key in its address, with its ${FIXTURE} as props, inside preview.vue, and tells
// the Roughbook studio how it went (rough/CONTRACT.md, point 3).
import { onErrorCaptured, onMounted, ref, shallowRef, type Component } from "vue";
import { setResponseStatus, useHead, useRequestEvent, useRequestURL } from "#imports";
import Preview from "./preview.vue";
import { fixtures, iterations } from "./preview-registry";

type Fixture = Record<string, unknown>;
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*\\/[a-z0-9]+(?:-[a-z0-9]+)*\\/iteration-\\d{2,}$/;
const LOOPBACK = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/;

const url = useRequestURL();
const key = decodeURIComponent(url.pathname.replace(/^\\/rough-preview\\/?/, "").replace(/\\/+$/, ""));
const params = url.searchParams;

// The variant the studio asks for in the address (rough/CONTRACT.md, point 2).
const scheme = params.get("roughbook-scheme") === "dark" ? "dark" : "light";
const lang = params.get("roughbook-lang")?.replace(/[^A-Za-z0-9-]/g, "") || undefined;
useHead({
  htmlAttrs: {
    lang,
    dir: params.get("roughbook-dir") === "rtl" ? "rtl" : "ltr",
    class: scheme === "dark" ? "dark" : undefined,
    style: \`color-scheme: \${scheme};\${params.get("roughbook-text") === "large" ? " font-size: 125%;" : ""}\`
  }
});

const failure = ref<string | null>(null);
let status = 200;
const Iteration = shallowRef<Component | null>(null);
const fixture = shallowRef<Fixture>({});
// Answers this machine only, so a dev server reachable on the network shows nothing from ${ROUGH_DIR}/ (point 5).
if (!LOOPBACK.test(url.hostname)) {
  failure.value = "The preview answers this machine only.";
  status = 404;
} else if (!KEY.test(key) || !iterations[key]) {
  failure.value = \`There is no iteration \${key} in this repo.\`;
  status = 404;
} else {
  try {
    const loaded = (await iterations[key]!()) as { default: Component };
    Iteration.value = loaded.default;
    const loadFixture = fixtures[key];
    fixture.value = loadFixture ? ((await loadFixture()) as { default: Fixture }).default : {};
  } catch (error) {
    failure.value = error instanceof Error ? error.message : "The iteration failed to load.";
    status = 500;
  }
}
const event = import.meta.server ? useRequestEvent() : undefined;
if (event && status !== 200) setResponseStatus(event, status);

// An iteration that fails as it renders fails its own preview: 500 on the server, the message here.
onErrorCaptured(error => {
  failure.value = error.message || "The iteration failed to render.";
  if (event) setResponseStatus(event, 500);
  return false;
});

function post(message: Record<string, unknown>) {
  window.parent.postMessage({ ...message, id: key }, "*");
}

onMounted(() => {
  post(failure.value ? { roughbook: "error", message: failure.value } : { roughbook: "ready" });
});
</script>

<template>
  <pre v-if="failure" style="padding: 2rem; white-space: pre-wrap">{{ failure }}</pre>
  <Preview v-else>
    <component :is="Iteration" v-bind="fixture" />
  </Preview>
</template>
`;

export const PREVIEW_WRAPPER = `<!-- Wraps every iteration previewed through this app. Add what your pages need around them: the
     app's layout or providers, and stylesheets not already in nuxt.config's css. -->
<template>
  <slot />
</template>
`;

/** The registry: each iteration's component and fixture, loaded only when its key is shown. */
export function renderRegistry(keys: string[], fixtures: string[] = []): string {
  const line = (key: string, file: string) =>
    `  ${JSON.stringify(key)}: () => import(${JSON.stringify(`./${key}/${file}`)}),\n`;
  return `// Generated by Roughbook from the iterations in this folder. Do not edit; it is never committed.
export const iterations: Record<string, () => Promise<unknown>> = {
${keys.map(key => line(key, ENTRY)).join('')}};

/** Each iteration's ${FIXTURE}, where it has one: its inputs for the preview. */
export const fixtures: Record<string, () => Promise<unknown>> = {
${fixtures.map(key => line(key, FIXTURE)).join('')}};
`;
}

export function currentRegistry(repo: string): string {
  const keys = listIterations(repo, ENTRY);
  return renderRegistry(keys, listFixtures(repo, keys, FIXTURE));
}

/** Rewrites rough/preview-registry.ts when the iterations changed, in a repo the recipe prepared. */
export function writeRegistry(repo: string): void {
  if (!fs.existsSync(path.join(repo, ...PAGE_FILE.split('/')))) return;
  const file = path.join(repo, ...REGISTRY_FILE.split('/'));
  const next = currentRegistry(repo);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) return;
  fs.writeFileSync(file, next);
}

export function isOurFile(text: string | null): boolean {
  return Boolean(text?.includes(MARKER));
}
