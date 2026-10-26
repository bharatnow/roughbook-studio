// Vite with React (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes", 2nd in the launch order): live, through
// an extra HTML entry Vite serves in development and leaves out of its build. F3 proved the setup
// on a fresh create-vite app built by the setup run; this recipe writes the same without an agent.
import type { RepoEnvironment } from '../../environment/types.js';
import type { RepoLink } from '../../repo/link.js';
import { pascalCase } from '../../repo/names.js';
import { OURS, planTailwindSource, read, type PrepChange } from '../../repo/plan.js';
import { ROUGH_DIR, STATE_DIR } from '../../repo/root.js';
import { PLACEHOLDER_INDEX } from '../next/placeholder.js';
import { REACT_WEB_CRAFT } from '../craft.js';
import type { PreviewPlan, Recipe } from '../types.js';
import {
  ENTRY,
  ENTRY_SCRIPT,
  FIXTURE,
  PAGE,
  PREVIEW_PAGE,
  PREVIEW_SCRIPT,
  isOurPreviewFile,
  previewWrapper
} from './preview.js';
import { moduleFromApp, modulePointer } from '../modules/pointer.js';
import { discoverVite } from './discover.js';

const PORT = 5173;

/**
 * rough/tsconfig.json: the app's own settings (create-vite keeps them in tsconfig.app.json, which
 * includes only src/), so an editor checks an iteration as it checks the app; the app's build
 * (tsc -b, vite build) never reads it.
 */
function roughTsconfig(repo: string): string | null {
  const base = read(repo, 'tsconfig.app.json') !== null ? 'tsconfig.app.json' : 'tsconfig.json';
  if (read(repo, base) === null) return null;
  return `// ${OURS}; it rewrites this file. The app's tsconfig leaves rough/ out, so iterations
// never fail its build; this one lets editors check them with the app's settings.
{
  "extends": "../${base}",
  "compilerOptions": { "tsBuildInfoFile": "${STATE_DIR}/tsconfig.tsbuildinfo", "types": ["vite/client"] },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["**/.base/**"]
}
`;
}

/** The recipe's own files, each written whole and rewritten by setup --upgrade. */
function ownFiles(): { file: string; content: string; summary: string }[] {
  return [
    {
      file: PAGE,
      content: PREVIEW_PAGE,
      summary: 'Add the development-only preview page Vite serves and never builds.'
    },
    {
      file: `${ROUGH_DIR}/${ENTRY_SCRIPT}`,
      content: PREVIEW_SCRIPT,
      summary: "Add the preview page's script, which shows one iteration by its key."
    }
  ];
}

function planPreview(repo: string, link: RepoLink): PreviewPlan {
  void link;
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  for (const own of ownFiles()) {
    const current = read(repo, own.file);
    if (current === own.content) continue;
    if (current !== null && !isOurPreviewFile(current)) {
      manual.push(`${own.file} exists and was not written by Roughbook, so it was left alone.`);
      continue;
    }
    changes.push({
      file: own.file,
      action: current === null ? 'create' : 'edit',
      summary: current === null ? own.summary : `Update ${own.file}.`,
      after: own.content
    });
  }
  if (read(repo, `${ROUGH_DIR}/preview.tsx`) === null) {
    changes.push({
      file: `${ROUGH_DIR}/preview.tsx`,
      action: 'create',
      summary: "Add the wrapper for the app's providers and global styles.",
      after: previewWrapper(repo)
    });
  }
  const tailwind = planTailwindSource(repo, ['src', 'src/styles', 'styles']);
  if (tailwind && 'manual' in tailwind) manual.push(tailwind.manual);
  else if (tailwind) changes.push(tailwind);
  return {
    changes,
    manual,
    ignoredFromBuild: [],
    gitWanted: [`/${PAGE}`, `/${ROUGH_DIR}/${ENTRY_SCRIPT}`]
  };
}

const SETUP_NOTES = `This repo is on Vite with React, which has a recipe: roughbook init writes ${PAGE} at the
repo's root, an extra HTML entry Vite serves in development and never builds (vite build bundles
index.html alone, so nothing from rough/ reaches dist/: gate: build), its script
rough/${ENTRY_SCRIPT}, which loads the iteration named by ?key=<page>/<component>/<iteration> through
import.meta.glob with its ${FIXTURE} as props, inside rough/preview.tsx (the app's providers and global
stylesheet), posts the ready and error messages, applies the variant asked for and answers this
machine only, and an @source line for rough/ where the app uses Tailwind 4. Vite's hot reload shows a
changed iteration (reload: app). Start from that setup; change it only where this app needs it: a
multi-page app whose vite.config lists every HTML file as a build input must leave ${PAGE} out, an app
whose Vite root is not the repo's root needs the page there, and rough/preview.tsx is the place for the
providers main.tsx puts around the app. Keep recipe: vite so the studio keeps the setup up to date.`;

export const vite: Recipe = {
  id: 'vite',
  name: 'Vite with React',
  // 2: rough/tsconfig.json leaves out the kept bases of forks from the app (brownfield B4).
  version: 2,
  setupNotes: SETUP_NOTES,
  appDir: () => null,
  environment(link): RepoEnvironment {
    return {
      contract: 1,
      recipe: 'vite',
      recipeVersion: 1,
      stack: link?.stack ?? [],
      family: 'react-like',
      mode: 'live',
      entry: ENTRY,
      sources: ['.ts', '.tsx', '.js', '.jsx', '.css', '.json', '.md', '.svg'],
      code: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      placement: { kind: 'rough' },
      wrapper: `${ROUGH_DIR}/preview.tsx`,
      runtime: { kind: 'local' },
      shell: 'none',
      start: {
        command: `npm run dev -- --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`
      },
      preview: `/${PAGE}?key={key}`,
      snapshot: null,
      device: null,
      viewports: [
        { name: 'desktop', width: 1440, height: 900, mobile: false },
        { name: 'mobile', width: 390, height: 844, mobile: true }
      ],
      variants: ['light'],
      reload: 'app',
      stylesheets: [],
      public: null,
      ignore: ['node_modules', '.git', 'dist'],
      overlays: ['vite-error-overlay'],
      fixture: FIXTURE,
      build: { command: 'npm run build', output: ['dist'] },
      gate: 'build',
      production: null,
      checks: [],
      timeouts: { start: 60, preview: 60, build: 300 },
      promote: { dir: 'src/components', extensions: ['.tsx', '.jsx'] },
      assets: { dir: 'public', url: '/', copy: false },
      copy: { kind: 'inline' },
      // A sketch is React with Tailwind, which renders here as it is where the app has Tailwind and
      // the packages it imports; pull checks that and ports otherwise.
      sketches: 'copy',
      terms: { page: 'page', component: 'component' },
      workshop: null,
      setupFiles: [],
      devDependencies: []
    };
  },
  planPreview,
  discover: discoverVite,
  pointer: modulePointer({ entry: ENTRY, fixture: FIXTURE }),
  fromApp: moduleFromApp({ entry: ENTRY, fixture: FIXTURE }),
  setupFiles: () => [PAGE],
  agentRules:
    environment => `- \`${environment.entry}\` renders in the browser through the app's own Vite dev server, so
  state, effects and browser APIs are fine. Style it as the app does: its global classes, a
  stylesheet of the iteration's own imported from \`${environment.entry}\`, or Tailwind where the app has it.
`,
  roughTsconfig,
  placeholder: () => PLACEHOLDER_INDEX,
  generatedFiles: [],
  importAllowed: () => [PAGE],
  syncPreview: () => {},
  pullTransform: (_file, text) => text,
  promoteDefault: (componentsDir, componentName) =>
    `${componentsDir}/${pascalCase(componentName)}.tsx`,
  promoteExtensions: ['.tsx', '.jsx'],
  promoteWords: {
    read: 'package.json, how styling is done\n(CSS files, CSS modules or Tailwind)',
    rules: [],
    usage: 'its import line and props'
  },
  craft: REACT_WEB_CRAFT,
  doctorSamples: ({ marker, fixtureNote }) => ({
    good: {
      [ENTRY]: `export default function RoughbookDoctorSample({ note }: { note?: string }) {
  return (
    <main data-roughbook="doctor">
      <p>${marker}</p>
      <p>{note}</p>
    </main>
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
    tool: 'create-vite',
    needs: ['npx', 'npm'],
    steps: name => [
      {
        kind: 'run',
        summary: 'Make a Vite app with React and TypeScript with create-vite',
        line: `npx --yes create-vite@9 ${name} --template react-ts --no-interactive`,
        shell: 'none',
        in: 'parent'
      },
      {
        kind: 'run',
        summary: 'Install its dependencies',
        line: 'npm install',
        shell: 'none',
        in: 'app'
      }
    ]
  }
};
