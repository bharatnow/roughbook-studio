// Expo with Expo Router (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes", 6th in the launch order): live
// through the app's web target, where the studio's frame shows a page as on every web stack, and
// snapshots for final review on a device, where the rendering is the native one.
import type { RepoEnvironment } from '../../environment/types.js';
import type { RepoLink } from '../../repo/link.js';
import { pascalCase } from '../../repo/names.js';
import { OURS, read, type PrepChange } from '../../repo/plan.js';
import { ROUGH_DIR, STATE_DIR } from '../../repo/root.js';
import { PLACEHOLDER_LINE } from '../../runs/placeholder.js';
import type { PreviewPlan, Recipe } from '../types.js';
import {
  ENTRY,
  FIXTURE,
  PREVIEW_ROUTE,
  PREVIEW_WRAPPER,
  REGISTRY_FILE,
  currentPreviewRegistry,
  detectRouterDir,
  isOurPreviewFile,
  previewRoute,
  previewRouteFile,
  writePreviewRegistry
} from './preview.js';
import { SNAPSHOT_SCRIPT, SNAPSHOT_SCRIPT_CONTENT, isOurSnapshotScript } from './snapshots.js';

/** Metro's port, on this machine only (`--localhost` binds it to loopback). */
const PORT = 8081;

const ROUGH_TSCONFIG = `// ${OURS}; it rewrites this file. The app's tsconfig.json excludes rough/,
// so iterations never fail its type check; this one lets editors check them with the app's settings.
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "tsBuildInfoFile": "${STATE_DIR}/tsconfig.tsbuildinfo" },
  "include": ["**/*.ts", "**/*.tsx", "../expo-env.d.ts", "../.expo/types/**/*.ts"],
  "exclude": []
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

/** What the root layout gains: the preview route shown alone, in development only. */
const LAYOUT_IMPORT = `import { Slot as RoughbookSlot, useSegments as useRoughbookSegments } from "expo-router";`;
const LAYOUT_LINES = `  // Roughbook, development only: the preview route shows alone, not inside this layout's navigator,
  // which would send an address it does not know back home (rough/CONTRACT.md, point 2).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  if (__DEV__ && useRoughbookSegments()[0] === "${PREVIEW_ROUTE}") return <RoughbookSlot />;
`;

/**
 * The root layout with the preview route let through: a navigator such as the template's tabs
 * sends an address it has no tab for back to the first one, so the route would never show. The
 * line is inside __DEV__, which a production bundle drops. Null when it is there already; a manual
 * step when the layout's default export cannot be found.
 */
export function planLayout(repo: string, appDir: string): PrepChange | { manual: string } | null {
  const file = `${appDir}/_layout.tsx`;
  const text = read(repo, file);
  if (text === null) return null;
  if (text.includes('useRoughbookSegments')) return null;
  // The file's own line endings, kept.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const opening = lines.findIndex(line => /^export\s+default\s+function\b[^{]*\{\s*$/.test(line));
  if (opening === -1) {
    return {
      manual: `${file}: let the preview route through in development, so it shows alone: return <Slot /> from the root layout when useSegments()[0] is "${PREVIEW_ROUTE}", inside if (__DEV__).`
    };
  }
  // The import after the file's last import line, the lines first in the layout's body.
  let lastImport = -1;
  lines.forEach((line, index) => {
    if (index < opening && /^import\b.*;\s*$/.test(line)) lastImport = index;
  });
  const after = [
    ...lines.slice(0, lastImport + 1),
    LAYOUT_IMPORT,
    ...(lastImport === -1 ? [''] : []),
    ...lines.slice(lastImport + 1, opening + 1),
    ...LAYOUT_LINES.trimEnd().split('\n'),
    ...lines.slice(opening + 1)
  ].join(eol);
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
  const route = previewRoute(appDir);
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
a theme the app keeps itself should read the roughbook-scheme parameter in the wrapper.`;

export const expo: Recipe = {
  id: 'expo',
  name: 'Expo',
  version: 1,
  setupNotes: SETUP_NOTES,
  appDir: detectRouterDir,
  environment(link): RepoEnvironment {
    return {
      contract: 1,
      recipe: 'expo',
      recipeVersion: 1,
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
  setupFiles: (_repo, link) => (link.appDir ? [previewRouteFile(link.appDir)] : []),
  agentRules:
    environment => `- \`${environment.entry}\` is a React Native component, shown through the app's Expo Router on
  its web target in the studio and on a device for final review, so it must run on both: View,
  Text, Pressable, Image and the app's own components, never DOM elements or browser APIs.
- Style with StyleSheet or the app's own styling, and take colours from the app's theme, so the
  dark variant follows.
`,
  roughTsconfig: repo => (read(repo, 'tsconfig.json') === null ? null : ROUGH_TSCONFIG),
  placeholder: () => PLACEHOLDER,
  generatedFiles: [`${ROUGH_DIR}/${REGISTRY_FILE}`],
  importAllowed: link => (link.appDir ? [`${link.appDir}/${PREVIEW_ROUTE}`] : []),
  syncPreview: repo => {
    writePreviewRegistry(repo);
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
  scaffold: null
};
