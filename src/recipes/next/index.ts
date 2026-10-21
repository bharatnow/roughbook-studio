// Next.js with the App Router: the stack the studio knew before environments existed, now one
// recipe among those to come. Everything here was the studio's own code until F1 of
// ROUGHBOOK-FRAMEWORKS-PLAN.md moved it in, word for word.
import type { RepoEnvironment } from '../../environment/types.js';
import type { RepoLink } from '../../repo/link.js';
import { pascalCase } from '../../repo/names.js';
import { OURS, planTailwindSource, read, type PrepChange } from '../../repo/plan.js';
import { ROUGH_DIR, STATE_DIR } from '../../repo/root.js';
import type { PreviewPlan, Recipe } from '../types.js';
import { PLACEHOLDER_INDEX } from './placeholder.js';
import {
  PREVIEW_ROUTE,
  PREVIEW_WRAPPER,
  REGISTRY_FILE,
  detectAppDir,
  isOurPreviewFile,
  previewRouteDir,
  FIXTURE,
  currentPreviewRegistry,
  previewRouteFiles,
  writePreviewRegistry
} from './preview.js';
import { writeScratch } from './scratch.js';

const NEXT_CONFIGS = [
  'next.config.ts',
  'next.config.mts',
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs'
];

/**
 * Whether the app's Next.js config turns Cache Components on, as `create-next-app` does from
 * Next.js 16.4. Read as text, so a config that computes the flag reads as off; the preview route
 * then still renders, with an error logged on each request.
 */
export function usesCacheComponents(repo: string): boolean {
  for (const name of NEXT_CONFIGS) {
    const text = read(repo, name);
    if (text !== null) return /^\s*cacheComponents\s*:\s*true\b/m.test(text);
  }
  return false;
}

/**
 * The app's tsconfig excludes rough/, so an editor would check an iteration alone: without the
 * app's paths such as `@/`, and from TypeScript 6 without @types. This one extends the app's and
 * takes Next.js's types from next-env.d.ts; `tsc` and `next build` read only the app's own, so
 * the build still never sees rough/. An app's tsconfig is usually incremental, so a `tsc -p rough`
 * (an agent checking its work) would leave build info in rough/, which is committed; it goes to
 * the state folder, which is not.
 */
export const ROUGH_TSCONFIG = `// ${OURS}; it rewrites this file. The app's tsconfig.json excludes rough/,
// so iterations never fail its build; this one lets editors check them with the app's settings.
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "tsBuildInfoFile": "${STATE_DIR}/tsconfig.tsbuildinfo" },
  "include": ["../next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": []
}
`;

/** Comments and blank lines before a file's first statement, where a directive must stand. */
const LEADING_COMMENTS = /^(?:\s*(?:\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/))*\s*/;

/**
 * A web sketch runs in the browser: the sandbox renders it on the client. In the Next.js App
 * Router the preview route imports `index.tsx` as a server component unless the file says
 * otherwise, and a sketch with state, effects or motion would fail there. So the pulled entry
 * starts with `"use client";` when it does not already.
 */
export function withClientDirective(file: string, text: string): string {
  if (file !== 'index.tsx') return text;
  const first = text.replace(LEADING_COMMENTS, '');
  return /^(['"])use client\1/.test(first) ? text : `"use client";\n${text}`;
}

/**
 * Where a promoted component goes when --to does not say: the project's components folder. One
 * under `src/` in a repo laid out as create-next-app's default, with `app/` at its root and no
 * `src/`, moves to the root: `src/components` becomes `components`.
 */
export function defaultComponentFile(
  componentsDir: string,
  componentName: string,
  isFolder: (relative: string) => boolean
): string {
  const dir =
    componentsDir.startsWith('src/') && !isFolder('src') && isFolder('app')
      ? componentsDir.slice('src/'.length)
      : componentsDir;
  return `${dir}/${pascalCase(componentName)}.tsx`;
}

/** The preview route and what goes with it, as `init` plans them for one repo. */
function planPreview(repo: string, link: RepoLink): PreviewPlan {
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  const ignoredFromBuild: string[] = [];
  const gitWanted: string[] = [];
  if (link.roughCommitted) gitWanted.push(`/${ROUGH_DIR}/${REGISTRY_FILE}`);
  const appDir = link.appDir;
  if (!appDir) {
    manual.push(
      'No App Router folder (app/ or src/app/) was found, so previews cannot render through this app. They need the Next.js App Router.'
    );
    return { changes, manual, ignoredFromBuild, gitWanted };
  }
  const routeDir = previewRouteDir(appDir);
  ignoredFromBuild.push(routeDir);
  gitWanted.push(`/${routeDir}/`);
  for (const route of previewRouteFiles(appDir, { cacheComponents: usesCacheComponents(repo) })) {
    const current = read(repo, route.file);
    if (current === route.content) continue;
    if (current !== null && !isOurPreviewFile(current)) {
      manual.push(`${route.file} exists and was not written by Roughbook, so it was left alone.`);
      continue;
    }
    changes.push({
      file: route.file,
      action: current === null ? 'create' : 'edit',
      summary:
        current === null ? 'Add the development-only preview route.' : 'Update the preview route.',
      after: route.content
    });
  }
  if (read(repo, `${ROUGH_DIR}/preview.tsx`) === null) {
    changes.push({
      file: `${ROUGH_DIR}/preview.tsx`,
      action: 'create',
      summary: "Add the wrapper for the app's providers.",
      after: PREVIEW_WRAPPER
    });
  }
  const tailwind = planTailwindSource(repo, [appDir, 'src/styles', 'styles']);
  if (tailwind && 'manual' in tailwind) manual.push(tailwind.manual);
  else if (tailwind) changes.push(tailwind);
  if (read(repo, `${ROUGH_DIR}/${REGISTRY_FILE}`) === null) {
    changes.push({
      file: `${ROUGH_DIR}/${REGISTRY_FILE}`,
      action: 'create',
      summary: 'Add the registry of iterations the route can render.',
      after: currentPreviewRegistry(repo)
    });
  }
  return { changes, manual, ignoredFromBuild, gitWanted };
}

/** How the setup run is told to set a Next.js app up, when no route from this recipe fits as it is. */
const SETUP_NOTES = `This repo is on Next.js with the App Router, which has a recipe: roughbook init writes the
development-only route <app>/${PREVIEW_ROUTE}/[...slug]/ (page, ready, error and not-found files),
rough/preview.tsx for the app's providers, and the generated rough/${REGISTRY_FILE} that loads each
iteration's index.tsx and preview.json. The route renders only when NODE_ENV is "development", in a
branch the bundler drops from production builds (gate: build), answers notFound() to a host that is
not this machine, and posts the ready and error messages. With Cache Components on it exports
instant = false so a missing iteration still answers 404. Start from that setup; change it only
where this app's layout, providers or Tailwind configuration need it, and keep the environment's
recipe line as recipe: next so the studio keeps maintaining the registry.`;

export const next: Recipe = {
  id: 'next',
  name: 'Next.js',
  version: 1,
  setupNotes: SETUP_NOTES,
  appDir: detectAppDir,
  environment(link): RepoEnvironment {
    return {
      contract: 1,
      recipe: 'next',
      recipeVersion: 1,
      stack: link?.stack ?? [],
      family: 'react-like',
      mode: 'live',
      entry: 'index.tsx',
      sources: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', '.md', '.svg'],
      code: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      placement: { kind: 'rough' },
      wrapper: `${ROUGH_DIR}/preview.tsx`,
      runtime: { kind: 'local' },
      shell: 'none',
      start: { command: 'npm run dev', url: 'http://localhost:3000' },
      preview: `/${PREVIEW_ROUTE}/{key}`,
      viewports: [
        { name: 'desktop', width: 1440, height: 900, mobile: false },
        { name: 'mobile', width: 390, height: 844, mobile: true }
      ],
      variants: ['light'],
      ignore: ['node_modules', '.git', '.next', '.turbo', '.vercel', 'dist', 'out', 'build'],
      overlays: ['nextjs-portal'],
      fixture: FIXTURE,
      // The dev server writes under .next/dev; the production build under these.
      build: { command: 'npm run build', output: ['.next/server', '.next/static', 'out'] },
      gate: 'build',
      production: null,
      checks: [],
      timeouts: { start: 60, preview: 150, build: 600 },
      promote: { dir: null, extensions: ['.tsx', '.jsx'] },
      assets: { dir: null, copy: false },
      copy: { kind: 'inline' },
      terms: { page: 'page', component: 'component' },
      workshop: null,
      setupFiles: [],
      devDependencies: []
    };
  },
  planPreview,
  setupFiles: (repo, link) =>
    link.appDir
      ? previewRouteFiles(link.appDir, { cacheComponents: usesCacheComponents(repo) }).map(
          route => route.file
        )
      : [],
  agentRules:
    environment => `- \`${environment.entry}\` renders inside the app's own pages, as a server component in the
  Next.js App Router. If it uses state, effects, event handlers, browser APIs or
  animation hooks, its first line is \`"use client";\`.
`,
  roughTsconfig: repo => (read(repo, 'tsconfig.json') === null ? null : ROUGH_TSCONFIG),
  placeholder: () => PLACEHOLDER_INDEX,
  generatedFiles: [`${ROUGH_DIR}/${REGISTRY_FILE}`],
  importAllowed: link => (link.appDir ? [previewRouteDir(link.appDir)] : []),
  syncPreview: repo => {
    writePreviewRegistry(repo);
  },
  pullTransform: withClientDirective,
  promoteDefault: defaultComponentFile,
  promoteExtensions: ['.tsx', '.jsx'],
  doctorSamples: ({ marker, fixtureNote }) => ({
    good: {
      'index.tsx': `export default function RoughbookDoctorSample({ note }: { note?: string }) {
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
      'index.tsx': `export default function RoughbookDoctorBroken(): never {
  throw new Error("roughbook doctor: this iteration fails on purpose");
}
`
    }
  }),
  scaffold: {
    write: writeScratch,
    written: dir => `Created a Next.js app in ${dir}. Run npm install there before roughbook start.`
  }
};
