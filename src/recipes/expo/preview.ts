// Expo with Expo Router: iterations live in the repo's rough/ and render through the app's own
// Metro dev server on its web target, inside the app's root layout, fonts and theme. Three pieces:
//
//   <app>/rough-preview/[...key].tsx   the route (development only, gitignored)
//   rough/preview-registry.ts           one loader per iteration, generated (gitignored)
//   rough/preview.tsx                   wraps iterations in the app's providers
//
// The route loads the registry only under __DEV__: Metro inlines it as false in a production
// bundle and drops the branch before it collects dependencies, so nothing in rough/ is ever bundled
// for production (the build gate, which `expo export` proves). The same route opens on a device
// through a deep link, for final review (rough/snapshots.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { listFixtures, listIterations } from '../../repo/iterations.js';
import { ROUGH_DIR } from '../../repo/root.js';
import { COMPOSE_PARAM, MARKER_ELEMENT, PICK_PARAM, SECTION_ATTRIBUTE } from '../context.js';
import { LIVE_FUNCTION } from '../live.js';

export const PREVIEW_ROUTE = 'rough-preview';
export const REGISTRY_FILE = 'preview-registry.ts';
const MARKER = 'Roughbook preview route';
/** The file every iteration has in this recipe, and the registry loads. */
export const ENTRY = 'index.tsx';
/** The file an iteration may hold with its inputs for the preview (the contract, point 2). */
export const FIXTURE = 'preview.json';

/** Where Expo Router's routes live in this repo, or null when it has none. */
export function detectRouterDir(repo: string): string | null {
  for (const candidate of ['src/app', 'app']) {
    if (fs.existsSync(path.join(repo, candidate))) return candidate;
  }
  return null;
}

export function previewRouteFile(appDir: string): string {
  return `${appDir}/${PREVIEW_ROUTE}/[...key].tsx`;
}

/** Whether the app's package.json depends on a package. */
export function dependsOn(repo: string, name: string): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]);
  } catch {
    return false;
  }
}

/**
 * A page's composition on the route (B6, decisions 46 and 54), on the web target of a mapped repo:
 * at the page's key with ?${COMPOSE_PARAM}=<component>:<iteration>,…, each section with its fixture,
 * in order, inside one Preview, each in the in-page view's marker, in a root as tall as they are. All
 * of it stays in the route's one file: every file in the folder would be a route of its own.
 *
 * The shared script fixes the window heights a page's styles name. A React Native section reads the
 * window from JavaScript or fills it with flex: 1, so the page answers those here. react-native-web
 * refuses Dimensions.set in a browser, and reads visualViewport on its resize event, so the device's
 * height goes in there, and Dimensions and useWindowDimensions report it; the root is at least that
 * tall, so a flex: 1 section has a screen to fill. A section can keep what Dimensions.get said (the
 * React Compiler memoizes it), so when the height is not the one it read, the sections mount again.
 */
const COMPOSITION_FUNCTIONS = `
type Section = { key: string; marker: string };

/** The sections an address asks for, in order; none for one that names no page. */
function sectionsOf(page: string, composed: string): Section[] {
  const sections = composed.split(",").filter(Boolean);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page) || sections.length > 30) return [];
  return sections.map((section) => {
    const [component = "", iteration = ""] = section.split(":");
    return { key: \`\${page}/\${component}/\${iteration}\`, marker: \`\${page}/\${component}\` };
  });
}

const live = ${LIVE_FUNCTION};

/** The height the canvas says the device has, which the page's own window reads from then on, and how often it changed. */
function useDeviceHeight() {
  const [device, setDevice] = useState<{ height?: number; turn: number }>({ turn: 0 });
  useLayoutEffect(() => {
    const visual = window.visualViewport;
    const hear = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.roughbook !== "viewport") return;
      const told = Number(event.data.height);
      if (!(told > 0)) return;
      const changed = Dimensions.get("window").height !== told;
      if (visual) {
        Object.defineProperty(visual, "height", { configurable: true, get: () => told });
        visual.dispatchEvent(new Event("resize"));
      }
      setDevice((now) => ({ height: told, turn: now.turn + (changed ? 1 : 0) }));
    };
    window.addEventListener("message", hear);
    return () => {
      window.removeEventListener("message", hear);
      if (visual) Reflect.deleteProperty(visual, "height");
    };
  }, []);
  return device;
}

/** With ?${PICK_PARAM}=1, a click posts { roughbook: "section", key } to the frame instead of following the page. */
function usePick() {
  useLayoutEffect(() => {
    if (new URLSearchParams(window.location.search).get("${PICK_PARAM}") !== "1") return;
    const pick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const section = event.target instanceof Element ? event.target.closest("[${SECTION_ATTRIBUTE}]") : null;
      const key = section?.getAttribute("${SECTION_ATTRIBUTE}");
      if (key) window.parent.postMessage({ roughbook: "section", key }, "*");
    };
    document.addEventListener("click", pick, true);
    return () => document.removeEventListener("click", pick, true);
  }, []);
}

/** The sections themselves, inside the boundary, so one that throws as it loads fails the page's preview. */
function Sections({ sections }: { sections: Section[] }) {
  const Preview = registry.Preview ?? Bare;
  return (
    <Preview>
      {sections.map((section) =>
        createElement(
          "${MARKER_ELEMENT}",
          { key: section.key, "${SECTION_ATTRIBUTE}": section.marker, style: { display: "contents" } },
          createElement(registry.loaders[section.key]!().default, registry.fixtures[section.key]?.() ?? {}),
        ),
      )}
    </Preview>
  );
}

/** A page's sections as one page, as tall as they are, not a screen the size of the window. */
function Composed({ id, sections, scheme, dir, lang }: { id: string; sections: Section[]; scheme: string; dir: "ltr" | "rtl"; lang?: string }) {
  const { height, turn } = useDeviceHeight();
  usePick();
  useLayoutEffect(live, []);
  // Expo's page holds the body to the window, and this page runs past it outside a canvas.
  useLayoutEffect(() => {
    const body = document.body.style;
    const before = body.overflow;
    body.overflow = "auto";
    return () => {
      body.overflow = before;
    };
  }, []);
  return (
    <div
      data-roughbook-variant
      dir={dir}
      lang={lang}
      className={scheme === "dark" ? "dark" : undefined}
      style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 1000, display: "flex", flexDirection: "column", minHeight: height, colorScheme: scheme }}
    >
      <Boundary id={id}>
        <Sections key={turn} sections={sections} />
        <Ready id={id} />
      </Boundary>
    </div>
  );
}
`;

/** Answers an address asking for a composition, on the web target; each failure as a missing iteration's. */
const COMPOSITION_BRANCH = `  if (composed !== undefined) {
    const sections = sectionsOf(key, composed);
    const gone = sections.find((section) => !registry.loaders[section.key]);
    const why = !sections.length
      ? "No iteration at this key."
      : gone
        ? \`There is no iteration \${gone.key} in this repo.\`
        : Platform.OS !== "web"
          ? "A page's composition shows on the web target."
          : null;
    if (why) return <Missing id={id} why={why} />;
    return (
      <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
        <Composed id={id} sections={sections} scheme={scheme} dir={dir} lang={lang} />
      </ThemeProvider>
    );
  }
`;

/**
 * The route, its imports climbing from <app>/rough-preview/ to the repo root. With `splash`, the
 * app has expo-splash-screen, whose screen its root layout keeps up until the layout's own content
 * hides it; the route shows without that content, so it hides the screen itself. With `compose`, a
 * mapped repo's, it renders a page's composition too; a repo that maps nothing keeps the route it had.
 */
export function previewRoute(
  appDir: string,
  options: { splash?: boolean; compose?: boolean } = {}
): { file: string; content: string } {
  const up = '../'.repeat(appDir.split('/').length + 1);
  const compose = options.compose === true;
  return {
    file: previewRouteFile(appDir),
    content: `// ${MARKER}. Development only, not committed (see .gitignore).
// Renders one iteration from ${ROUGH_DIR}/ inside this app's root layout, fonts and theme: on the web
// target in the Roughbook studio's frame, and on a device or simulator for final review.
import { DarkTheme, DefaultTheme, ThemeProvider, useLocalSearchParams } from "expo-router";
import { Component, ${compose ? 'createElement, ' : ''}useEffect, ${compose ? 'useLayoutEffect, useState, ' : ''}useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { Appearance, ${compose ? 'Dimensions, ' : ''}Platform, StyleSheet, Text, View } from "react-native";${
      options.splash ? '\nimport * as SplashScreen from "expo-splash-screen";' : ''
    }
// The registry holds the iterations only under __DEV__, which a production bundle folds to nothing,
// and ${ROUGH_DIR}/ with it (the build gate). It is imported as it is: Metro's server render loses track of
// a conditional import here once the iterations change, and the app's own pages would answer 500.
import * as registryModule from "${up}${ROUGH_DIR}/preview-registry";

type Registry = {
  Preview: ComponentType<{ children: ReactNode }> | null;
  loaders: Record<string, () => { default: ComponentType<Record<string, unknown>> }>;
  fixtures: Record<string, () => Record<string, unknown>>;
};

const registry = registryModule as unknown as Registry;

const LOOPBACK = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/;

/** Tells the studio's frame (web) or the snapshot script (a device's log) how the iteration went. */
function say(word: "ready" | "error", id: string, message?: string) {
  if (Platform.OS === "web") {
    window.parent.postMessage({ roughbook: word, id, ...(message ? { message } : {}) }, "*");
  } else {
    console.log(\`roughbook: \${word} \${id}\${message ? \`: \${message}\` : ""}\`);
  }
}

class Boundary extends Component<{ id: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    say("error", this.props.id, error.message || "The iteration failed to render.");
  }
  render() {
    return this.state.error ? <Text style={styles.message}>{this.state.error.message}</Text> : this.props.children;
  }
}

function Ready({ id }: { id: string }) {
  useEffect(() => say("ready", id), [id]);
  return null;
}

function Missing({ id, why }: { id: string; why: string }) {
  useEffect(() => say("error", id, why), [id, why]);
  return <Text style={styles.message}>{why}</Text>;
}

/** In place of rough/preview.tsx, when the registry has none. */
function Bare({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Where it renders never changes, so there is nothing to subscribe to. */
const noChanges = () => () => {};

/** The iteration itself, inside the boundary, so one that throws as it loads fails its own preview. */
function Shown({ registry, id }: { registry: Registry; id: string }) {
  const Iteration = registry.loaders[id]!().default;
  // An iteration's ${FIXTURE}, when it has one, holds its inputs (the preview contract, point 2).
  const fixture = registry.fixtures[id]?.() ?? {};
  const Preview = registry.Preview ?? Bare;
  return (
    <Preview>
      <Iteration {...fixture} />
    </Preview>
  );
}
${compose ? COMPOSITION_FUNCTIONS : ''}
export default function RoughPreview() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const one = (name: string) => {
    const value = params[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const key = ([] as string[]).concat(params.key ?? []).join("/");
  // The variant the studio asks for in the address (the preview contract, point 2).
  const scheme = one("roughbook-scheme") === "dark" ? "dark" : "light";
  const dir = one("roughbook-dir") === "rtl" ? "rtl" : "ltr";
  const lang = one("roughbook-lang")?.replace(/[^A-Za-z0-9-]/g, "") || undefined;${
    compose
      ? `
  const composed = one("${COMPOSE_PARAM}");
  const id = composed === undefined ? key : \`\${key}/composition\`;`
      : ''
  }
  useEffect(() => {
    if (Platform.OS === "web") {
      document.documentElement.style.colorScheme = scheme;
      document.documentElement.dir = dir;
      if (lang) document.documentElement.lang = lang;
    } else {
      Appearance.setColorScheme?.(scheme);
    }
  }, [scheme, dir, lang]);
  // The iteration runs on the client only (true there): the dev server's own render (false) never
  // runs its code.
  const mounted = useSyncExternalStore(noChanges, () => true, () => false);${
    options.splash
      ? `
  // The app's splash screen stays up until its root layout's content hides it, which a preview skips.
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);`
      : ''
  }
  // Answers this machine only, so a dev server reachable on the network shows nothing from ${ROUGH_DIR}/ (point 5).
  if (Platform.OS === "web" && typeof window !== "undefined" && !LOOPBACK.test(window.location.hostname)) {
    return <Missing id={${compose ? 'id' : 'key'}} why="The preview answers this machine only." />;
  }
  if (!mounted) return null;
${compose ? COMPOSITION_BRANCH : ''}  if (!registry.loaders[key]) return <Missing id={key} why={\`There is no iteration \${key} in this repo.\`} />;
  return (
    <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
      <View style={[styles.root, { direction: dir }]}>
        <Boundary id={key}>
          <Shown registry={registry} id={key} />
          <Ready id={key} />
        </Boundary>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  // Over the app's own tabs and headers: an iteration is a screen or a part of one.
  root: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  message: { padding: 32 },
});
`
  };
}

export const PREVIEW_WRAPPER = `// Wraps every iteration previewed through this app. Add the providers your
// screens need (theme, i18n, query client, safe areas), as your root layout does.
import type { ReactNode } from "react";

export default function Preview({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
`;

/**
 * The registry: Metro bundles every iteration in development (it has no lazy require for native),
 * and each module runs only when its key is shown, so a broken one fails its own preview alone.
 */
export function renderPreviewRegistry(keys: string[], fixtures: string[] = []): string {
  const lines = keys.map(
    key => `  ${JSON.stringify(key)}: () => require(${JSON.stringify(`./${key}/index`)}),`
  );
  const fixtureLines = fixtures.map(
    key => `  ${JSON.stringify(key)}: () => require(${JSON.stringify(`./${key}/${FIXTURE}`)}),`
  );
  return `// Generated by Roughbook from the iterations in this folder. Do not edit.
// Everything here is under __DEV__, which a production bundle folds to nothing: no iteration and no
// wrapper is bundled for production, only these empty names.
import type { ComponentType, ReactNode } from "react";

export const Preview: ComponentType<{ children: ReactNode }> | null = __DEV__
  ? require("./preview").default
  : null;

export const loaders: Record<string, () => { default: ComponentType<Record<string, unknown>> }> = __DEV__
  ? {
${lines.map(line => `    ${line}\n`).join('')}    }
  : {};

/** Each iteration's ${FIXTURE}, where it has one: its inputs for the preview. */
export const fixtures: Record<string, () => Record<string, unknown>> = __DEV__
  ? {
${fixtureLines.map(line => `    ${line}\n`).join('')}    }
  : {};
`;
}

export function currentPreviewRegistry(repo: string): string {
  const keys = listIterations(repo, ENTRY);
  return renderPreviewRegistry(keys, listFixtures(repo, keys, FIXTURE));
}

/** Rewrites rough/preview-registry.ts when the iterations changed. Returns whether it wrote. */
export function writePreviewRegistry(repo: string): boolean {
  const file = path.join(repo, ROUGH_DIR, REGISTRY_FILE);
  const next = currentPreviewRegistry(repo);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current === next) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return true;
}

export function isOurPreviewFile(text: string | null): boolean {
  return Boolean(text?.includes(MARKER));
}
