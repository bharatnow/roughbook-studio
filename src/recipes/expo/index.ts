// Expo with Expo Router (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes", 6th in the launch order): live
// through the app's web target, where the studio's frame shows a page as on every web stack, and
// snapshots for final review on a device, where the rendering is the native one.
import type { RepoEnvironment } from '../../environment/types.js';
import type { RepoLink } from '../../repo/link.js';
import { pascalCase } from '../../repo/names.js';
import { OURS, read, type PrepChange } from '../../repo/plan.js';
import { ROUGH_DIR, STATE_DIR } from '../../repo/root.js';
import { PLACEHOLDER_LINE } from '../../runs/placeholder.js';
import type { PreviewPlan, Recipe, RecipeEdit } from '../types.js';
import {
  ENTRY,
  FIXTURE,
  PREVIEW_ROUTE,
  PREVIEW_WRAPPER,
  REGISTRY_FILE,
  currentPreviewRegistry,
  detectRouterDir,
  isOurPreviewFile,
  dependsOn,
  previewRoute,
  previewRouteFile,
  writePreviewRegistry
} from './preview.js';
import { SNAPSHOT_SCRIPT, SNAPSHOT_SCRIPT_CONTENT, isOurSnapshotScript } from './snapshots.js';
import { moduleFromApp, modulePointer } from '../modules/pointer.js';
import { hasMapFile } from '../../map/file.js';
import { CONTEXT_SENTINEL, swapAddress } from '../context.js';
import {
  CONTEXT_DIR,
  CONTEXT_MODULES,
  METRO_CONFIG,
  contextFiles,
  isOwnMetroConfig,
  planMetroConfig,
  undoMetroConfig,
  wrapperFiles,
  writeContext
} from './context.js';
import { discoverExpo } from './discover.js';

/** Metro's port, on this machine only (`--localhost` binds it to loopback). */
const PORT = 8081;

const ROUGH_TSCONFIG = `// ${OURS}; it rewrites this file. The app's tsconfig.json excludes rough/,
// so iterations never fail its type check; this one lets editors check them with the app's settings.
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "tsBuildInfoFile": "${STATE_DIR}/tsconfig.tsbuildinfo" },
  "include": ["**/*.ts", "**/*.tsx", "../expo-env.d.ts", "../.expo/types/**/*.ts"],
  "exclude": ["**/.base/**"]
}
`;

/**
 * What a local prompt's rules ask of React Native's craft: its family is React-like, but it has no
 * DOM, so the web's elements and CSS properties mean nothing on a device.
 */
const CRAFT = `Use React Native's own components (Pressable, Text, TextInput, Switch) and the app's own,
never DOM elements, and give every control an accessibilityRole and a name a screen reader reads:
its text, or an accessibilityLabel. Mark headings with accessibilityRole="header", in order. Give
every control pressed, focused and disabled styles, and make every target at least 44 by 44,
with hitSlop where it looks smaller. Take colors from the app's theme, so the dark variant
follows, and let text scale with the system's font size.
Give every animation a reduced-motion path (AccessibilityInfo.isReduceMotionEnabled), and
animate only transform and opacity.
Give every image its size before it loads, and load only the font weights you use.`;

/** What a new slot shows until its agent has written it: a screen saying so, on web and native. */
const PLACEHOLDER = `import { StyleSheet, Text, View } from "react-native";

export default function NotYetGenerated() {
  return (
    <View style={styles.screen}>
      <Text style={styles.line}>${PLACEHOLDER_LINE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#f6f8fa" },
  line: { color: "#5b6274", textAlign: "center" },
});
`;

// What the root layout gains: the preview route shown alone, in development only. A navigator such
// as the template's tabs sends an address it has no tab for back to the first one, so the route
// would never show inside it. The layout's own function stays as it is, only no longer the default
// export; the new default export calls its one hook on every render, then renders the preview
// route alone or the layout as a component of its own, so every hook of both keeps its order
// whichever route is open (an early return before the layout's own hooks would break that).
const WRAPPER_NAME = 'RoughbookRootLayout';
const NAMESPACE = 'RoughbookRouter';

/** The layout's own default export, as the edit finds it and as uninstall puts it back. */
const DEFAULT_FUNCTION = /^export default function ([A-Za-z_$][\w$]*)\s*\(/;

/** The edit's import, in the file's own quotes. */
const layoutImport = (quote: string) =>
  `import * as ${NAMESPACE} from ${quote}expo-router${quote};`;
const LAYOUT_IMPORT_LINE = `import \\* as ${NAMESPACE} from ['"]expo-router['"];?[ \\t]*(?:\\r?\\n|$)`;

function layoutWrapper(name: string, quote: string, eol: string): string {
  return [
    "// Roughbook, development only: the preview route shows alone, not inside this layout's navigator,",
    `// which would send an address it does not know back home (rough/CONTRACT.md, point 2). ${name}`,
    '// renders as a component of its own, so its hooks keep their order on every route; roughbook',
    '// uninstall puts this file back as it was.',
    `export default function ${WRAPPER_NAME}() {`,
    `  const segment = (${NAMESPACE}.useSegments() as readonly string[])[0];`,
    `  if (__DEV__ && segment === ${quote}${PREVIEW_ROUTE}${quote}) return <${NAMESPACE}.Slot />;`,
    `  return <${name} />;`,
    '}'
  ].join(eol);
}

/** From the wrapper's first comment line to its closing brace, at the end of the file. */
const LAYOUT_WRAPPER = new RegExp(
  `(?:\\r?\\n)?// Roughbook, development only: the preview route shows alone[^\\n]*\\r?\\n(?://[^\\n]*\\r?\\n)*export default function ${WRAPPER_NAME}\\(\\)[\\s\\S]*?\\breturn <([A-Za-z_$][\\w$]*) ?/>;?\\s*\\r?\\n\\}[ \\t]*(?:\\r?\\n)?$`
);

// F6's edit, never released: an early return first in the layout, which made its hooks conditional.
const F6_IMPORT = `import { Slot as RoughbookSlot, useSegments as useRoughbookSegments } from "expo-router";`;
const F6_LINES = [
  "  // Roughbook, development only: the preview route shows alone, not inside this layout's navigator,",
  '  // which would send an address it does not know back home (rough/CONTRACT.md, point 2).',
  '  // eslint-disable-next-line react-hooks/rules-of-hooks',
  `  if (__DEV__ && useRoughbookSegments()[0] === "${PREVIEW_ROUTE}") return <RoughbookSlot />;`
];

/** The layout without F6's edit, or null when it does not have it. */
function withoutF6Edit(text: string): string | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = `${F6_LINES.join(eol)}${eol}`;
  if (!text.includes(`${F6_IMPORT}${eol}`) || !text.includes(lines)) return null;
  return text.replace(`${F6_IMPORT}${eol}`, '').replace(lines, '');
}

/** The quote the file's imports use most, which its formatter keeps. */
function quoteOf(text: string): string {
  const count = (quote: string) =>
    (
      text.match(new RegExp(`^import\\b[^\\n]*${quote}[^${quote}\\n]+${quote};?[ \\t]*$`, 'gm')) ??
      []
    ).length;
  return count("'") > count('"') ? "'" : '"';
}

/** The last line of an import statement: one on a single line, or the closing line of a long one. */
const IMPORT_END = /^(?:import\b[^\n]*|\}\s*from\s+)['"][^'"\n]+['"];?\s*$/;

/** The root layout with the preview route let through; null when its default export is not found. */
export function editLayout(text: string): string | null {
  // The file's own line endings, kept.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const opening = lines.findIndex(line => DEFAULT_FUNCTION.test(line));
  if (opening === -1) return null;
  const name = DEFAULT_FUNCTION.exec(lines[opening]!)![1]!;
  const quote = quoteOf(text);
  // The import after the file's last import, the wrapper after everything else.
  let lastImport = -1;
  lines.forEach((line, index) => {
    if (index < opening && IMPORT_END.test(line)) lastImport = index;
  });
  const edited = [
    ...lines.slice(0, lastImport + 1),
    layoutImport(quote),
    ...(lastImport === -1 ? [''] : []),
    ...lines.slice(lastImport + 1, opening),
    lines[opening]!.slice('export default '.length),
    ...lines.slice(opening + 1)
  ].join(eol);
  return `${edited}${eol}${layoutWrapper(name, quote, eol)}${eol}`;
}

/** The root layout as it was before the recipe's edit (or F6's), or null when it has neither. */
export function undoLayout(text: string): string | null {
  const f6 = withoutF6Edit(text);
  if (f6 !== null) return f6;
  const wrapper = LAYOUT_WRAPPER.exec(text);
  if (!wrapper) return null;
  const name = wrapper[1]!;
  let rest = text.slice(0, wrapper.index);
  // At the very top, the import came with a blank line after it.
  const top = new RegExp(`^${LAYOUT_IMPORT_LINE}(?:\\r?\\n)?`);
  rest = top.test(rest)
    ? rest.replace(top, '')
    : rest.replace(new RegExp(`^${LAYOUT_IMPORT_LINE}`, 'm'), '');
  const own = new RegExp(`^function ${name.replace(/\$/g, '\\$')}\\s*\\(`, 'm');
  if (!own.test(rest)) return null;
  return rest.replace(own, match => `export default ${match}`);
}

const isLayoutEdited = (text: string) =>
  new RegExp(`^export default function ${WRAPPER_NAME}\\(`, 'm').test(text);

/**
 * The root layout's edit as `init` plans it: null when it is there already; F6's early return
 * replaced by it; a manual step when the layout's default export cannot be found.
 */
export function planLayout(repo: string, appDir: string): PrepChange | { manual: string } | null {
  const file = `${appDir}/_layout.tsx`;
  const text = read(repo, file);
  if (text === null || isLayoutEdited(text)) return null;
  const after = editLayout(withoutF6Edit(text) ?? text);
  if (after === null) {
    return {
      manual: `${file}: let the preview route through in development, so it shows alone. Make the layout's own function a plain one, and export as the default a layout that calls useSegments() first, then returns <Slot /> when __DEV__ and its first segment is "${PREVIEW_ROUTE}", and the layout otherwise.`
    };
  }
  return {
    file,
    action: 'edit',
    summary: 'Let the preview route show alone in development, outside the layout’s navigator.',
    after
  };
}

/** The route, the wrapper, the registry and the snapshot script, as `init` plans them. */
function planPreview(repo: string, link: RepoLink): PreviewPlan {
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  const ignoredFromBuild: string[] = [];
  const gitWanted: string[] = [];
  if (link.roughCommitted) gitWanted.push(`/${ROUGH_DIR}/${REGISTRY_FILE}`);
  const appDir = link.appDir;
  if (!appDir) {
    manual.push(
      'No Expo Router folder (src/app/ or app/) was found, so previews cannot render through this app. They need Expo Router.'
    );
    return { changes, manual, ignoredFromBuild, gitWanted };
  }
  const layout = planLayout(repo, appDir);
  if (layout && 'manual' in layout) manual.push(layout.manual);
  else if (layout) changes.push(layout);
  const route = previewRoute(appDir, { splash: dependsOn(repo, 'expo-splash-screen') });
  const routeDir = `${appDir}/${PREVIEW_ROUTE}`;
  ignoredFromBuild.push(routeDir);
  gitWanted.push(`/${routeDir}/`);
  const current = read(repo, route.file);
  if (current !== route.content) {
    if (current !== null && !isOurPreviewFile(current)) {
      manual.push(`${route.file} exists and was not written by Roughbook, so it was left alone.`);
    } else {
      changes.push({
        file: route.file,
        action: current === null ? 'create' : 'edit',
        summary:
          current === null
            ? 'Add the development-only preview route.'
            : 'Update the preview route.',
        after: route.content
      });
    }
  }
  if (read(repo, `${ROUGH_DIR}/preview.tsx`) === null) {
    changes.push({
      file: `${ROUGH_DIR}/preview.tsx`,
      action: 'create',
      summary: "Add the wrapper for the app's providers.",
      after: PREVIEW_WRAPPER
    });
  }
  if (read(repo, `${ROUGH_DIR}/${REGISTRY_FILE}`) === null) {
    changes.push({
      file: `${ROUGH_DIR}/${REGISTRY_FILE}`,
      action: 'create',
      summary: 'Add the registry of iterations the route can render.',
      after: currentPreviewRegistry(repo)
    });
  }
  // The in-page view's switch (B5b), for a mapped app only: its files and metro.config's block.
  if (hasMapFile(repo)) {
    for (const item of contextFiles()) {
      const current = read(repo, item.file);
      if (current === item.content) continue;
      changes.push({
        file: item.file,
        action: current === null ? 'create' : 'edit',
        summary:
          current === null
            ? 'Add the in-page view’s switch for the web target, development only.'
            : 'Update the in-page view’s switch.',
        after: item.content
      });
    }
    const metro = planMetroConfig(repo);
    if (metro && 'manual' in metro) manual.push(metro.manual);
    else if (metro) changes.push(metro);
    gitWanted.push(`/${CONTEXT_DIR}/`);
  }
  const script = read(repo, `${ROUGH_DIR}/${SNAPSHOT_SCRIPT}`);
  if (script !== SNAPSHOT_SCRIPT_CONTENT && (script === null || isOurSnapshotScript(script))) {
    changes.push({
      file: `${ROUGH_DIR}/${SNAPSHOT_SCRIPT}`,
      action: script === null ? 'create' : 'edit',
      summary: 'Add the script that renders final-review snapshots on a device.',
      after: SNAPSHOT_SCRIPT_CONTENT
    });
  }
  return { changes, manual, ignoredFromBuild, gitWanted };
}

/** The switch's files on disk, and metro.config.js when the switch wrote it whole. */
function contextSetupFiles(repo: string): string[] {
  const files = hasMapFile(repo)
    ? contextFiles().map(item => item.file)
    : contextFiles()
        .map(item => item.file)
        .filter(file => read(repo, file) !== null);
  return isOwnMetroConfig(read(repo, METRO_CONFIG)) ? [...files, METRO_CONFIG] : files;
}

/** metro.config's block, in a config of the app's own. */
function metroEdits(repo: string): RecipeEdit[] {
  const text = read(repo, METRO_CONFIG);
  return text !== null && !isOwnMetroConfig(text)
    ? [{ file: METRO_CONFIG, undo: undoMetroConfig }]
    : [];
}

const SETUP_NOTES = `This repo is on Expo with Expo Router, which has a recipe: roughbook init writes the
development-only route <app>/${PREVIEW_ROUTE}/[...key].tsx, rough/preview.tsx for the app's providers,
the generated rough/${REGISTRY_FILE} that requires each iteration's index.tsx and preview.json, and
rough/${SNAPSHOT_SCRIPT}. The route loads the registry only under __DEV__, which Metro inlines as false and
drops from a production bundle (gate: build, proven by npx expo export --platform web into dist/),
answers the studio's frame on the web target (npx expo start --localhost, which binds Metro to this
machine), posts the ready and error messages there and logs them on a device, and applies the
variant asked for. Final review renders on a device: rough/${SNAPSHOT_SCRIPT} opens the route by its deep
link in Expo Go or a development build on an attached Android device or emulator (adb), or a booted iOS
simulator, and takes the screen per shot (snapshot), and opens one key there (device). Start from
that setup; change it only where this app's root layout, providers or theme need it (the wrapper is
the place for providers), and keep recipe: expo so the studio keeps maintaining the registry. On the
web target the app's own useColorScheme follows the browser, which the studio's screenshots emulate;
a theme the app keeps itself should read the roughbook-scheme parameter in the wrapper. For a mapped app, the in-page
view's switch lives in rough/_context/ (development only, gitignored) and metro.config.js hands Metro's config to it:
on the web target alone, the app's imports of an adopted component resolve to a wrapper that marks it and, for
?roughbook-swap=<page>/<component>/<iteration>, renders the iteration in its place with the same props. Native
screens show components alone.`;

export const expo: Recipe = {
  id: 'expo',
  name: 'Expo',
  // 2: the root layout's edit keeps every hook on every render, and uninstall reverses it.
  // 3: rough/tsconfig.json leaves out the kept bases of forks from the app (brownfield B4).
  // 4: the in-page view's switch on the web target, and metro.config's block (brownfield B5b).
  version: 4,
  setupNotes: SETUP_NOTES,
  appDir: detectRouterDir,
  environment(link): RepoEnvironment {
    return {
      contract: 1,
      recipe: 'expo',
      recipeVersion: 2,
      stack: link?.stack ?? [],
      family: 'react-like',
      mode: 'live',
      entry: ENTRY,
      sources: ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.svg'],
      code: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      placement: { kind: 'rough' },
      wrapper: `${ROUGH_DIR}/preview.tsx`,
      runtime: { kind: 'local' },
      shell: 'none',
      start: {
        command: `npx expo start --localhost --port ${PORT}`,
        url: `http://localhost:${PORT}`
      },
      preview: `/${PREVIEW_ROUTE}/{key}`,
      snapshot: `node ${ROUGH_DIR}/${SNAPSHOT_SCRIPT}`,
      device: `node ${ROUGH_DIR}/${SNAPSHOT_SCRIPT} --open {key}`,
      viewports: [
        { name: 'phone', width: 390, height: 844, mobile: true },
        { name: 'tablet', width: 820, height: 1180, mobile: true }
      ],
      variants: ['light', 'dark'],
      reload: 'app',
      stylesheets: [],
      public: null,
      ignore: ['node_modules', '.git', '.expo', 'dist', 'web-build', 'ios', 'android'],
      overlays: [],
      fixture: FIXTURE,
      build: { command: 'npx expo export --platform web', output: ['dist'] },
      gate: 'build',
      production: null,
      checks: [],
      // Metro's first bundle of a fresh app takes a while.
      timeouts: { start: 180, preview: 180, build: 600 },
      promote: { dir: null, extensions: ['.tsx', '.jsx'] },
      // Bundled by Metro: a component requires the file itself.
      assets: { dir: 'assets/images', url: null, copy: false },
      copy: { kind: 'inline' },
      // A sketch's markup is the web's, which React Native does not render: it is ported.
      sketches: 'port',
      terms: { page: 'screen', component: 'component' },
      workshop: null,
      setupFiles: [],
      devDependencies: []
    };
  },
  planPreview,
  discover: discoverExpo,
  pointer: modulePointer({ entry: ENTRY, fixture: FIXTURE }),
  fromApp: moduleFromApp({ entry: ENTRY, fixture: FIXTURE }),
  setupFiles: (repo, link) =>
    link.appDir
      ? [previewRouteFile(link.appDir), ...contextSetupFiles(repo), ...wrapperFiles(repo)]
      : [],
  // The root layout's edit, which uninstall reverses exactly, and metro.config's block.
  edits: (repo, link) =>
    link.appDir
      ? [{ file: `${link.appDir}/_layout.tsx`, undo: undoLayout }, ...metroEdits(repo)]
      : [],
  contextPreview: {
    files: repo => contextSetupFiles(repo),
    edits: repo => metroEdits(repo),
    generated: [CONTEXT_MODULES],
    missing: (repo, link) => {
      if (!link.appDir || !hasMapFile(repo)) return [];
      const absent = contextFiles()
        .map(item => item.file)
        .filter(file => read(repo, file) === null);
      const config = read(repo, METRO_CONFIG);
      return config === null || (!isOwnMetroConfig(config) && undoMetroConfig(config) === null)
        ? [...absent, METRO_CONFIG]
        : absent;
    },
    address: (address, swap, options) => swapAddress(address, { swap, ...options }),
    sentinel: CONTEXT_SENTINEL,
    note: 'In its page works on the web target (react-native-web); on a device or simulator, screens show components alone.'
  },
  agentRules:
    environment => `- \`${environment.entry}\` is a React Native component, shown through the app's Expo Router on
  its web target in the studio and on a device for final review, so it must run on both: View,
  Text, Pressable, Image and the app's own components, never DOM elements or browser APIs.
- Style with StyleSheet or the app's own styling, and take colours from the app's theme, so the
  dark variant follows.
`,
  roughTsconfig: repo => (read(repo, 'tsconfig.json') === null ? null : ROUGH_TSCONFIG),
  placeholder: () => PLACEHOLDER,
  generatedFiles: [`${ROUGH_DIR}/${REGISTRY_FILE}`, CONTEXT_MODULES],
  // metro.config hands Metro's config to the switch in rough/_context/, in development only.
  importAllowed: link => (link.appDir ? [`${link.appDir}/${PREVIEW_ROUTE}`, METRO_CONFIG] : []),
  syncPreview: repo => {
    writePreviewRegistry(repo);
    if (hasMapFile(repo)) writeContext(repo);
  },
  pullTransform: (_file, text) => text,
  promoteDefault: (componentsDir, componentName) =>
    `${componentsDir}/${pascalCase(componentName)}.tsx`,
  promoteExtensions: ['.tsx', '.jsx'],
  promoteWords: {
    read: 'package.json, how styling is done\n(StyleSheet, a theme or a styling library)',
    rules: [],
    usage: 'its import line and props'
  },
  craft: { floor: CRAFT, primitives: '' },
  doctorSamples: ({ marker, fixtureNote }) => ({
    good: {
      [ENTRY]: `import { Text, View } from "react-native";

export default function RoughbookDoctorSample({ note }: { note?: string }) {
  return (
    <View>
      <Text>${marker}</Text>
      <Text>{note}</Text>
    </View>
  );
}
`,
      [FIXTURE]: `{ "note": "${fixtureNote}" }\n`
    },
    broken: {
      [ENTRY]: `export default function RoughbookDoctorBroken(): never {
  throw new Error("roughbook doctor: this iteration fails on purpose");
}
`
    }
  }),
  scaffold: {
    tool: 'create-expo-app',
    needs: ['npx'],
    steps: name => [
      {
        kind: 'run',
        summary: 'Make an Expo app with Expo Router, from the SDK 58 template',
        // It installs the dependencies itself.
        line: `npx --yes create-expo-app@5 ${name} --template default@sdk-58 --yes`,
        shell: 'none',
        in: 'parent'
      }
    ]
  }
};
