// Nuxt (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes", 8th in the launch order): live, on the app's own
// `nuxt dev`, through a local module that shows previews in development only, so `nuxt build`
// holds nothing from rough/ (the build gate). Iterations are Vue single-file components.
import path from 'node:path';
import type { RepoEnvironment } from '../../environment/types.js';
import type { RepoLink } from '../../repo/link.js';
import { pascalCase } from '../../repo/names.js';
import { planTailwindSource, read, type PrepChange } from '../../repo/plan.js';
import { PLACEHOLDER_LINE } from '../../runs/placeholder.js';
import { familyCraft } from '../craft.js';
import type { PreviewPlan, Recipe } from '../types.js';
import {
  ENTRY,
  FIXTURE,
  MODULE_FILE,
  PAGE_FILE,
  PREVIEW_MODULE,
  PREVIEW_PAGE,
  PREVIEW_WRAPPER,
  REGISTRY_FILE,
  WRAPPER,
  currentRegistry,
  isOurFile,
  writeRegistry
} from './preview.js';
import type { MapComponent } from '../../map/types.js';
import { discoverNuxt } from './discover.js';

const PORT = 3000;

function ownFiles(): { file: string; content: string; summary: string }[] {
  return [
    {
      file: MODULE_FILE,
      content: PREVIEW_MODULE,
      summary: 'Add the local module that shows previews in development only.'
    },
    {
      file: PAGE_FILE,
      content: PREVIEW_PAGE,
      summary: 'Add the preview page, which shows one iteration by its key.'
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
    if (current !== null && !isOurFile(current)) {
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
  if (read(repo, REGISTRY_FILE) === null) {
    changes.push({
      file: REGISTRY_FILE,
      action: 'create',
      summary: 'Add the registry of iterations the page can show.',
      after: currentRegistry(repo)
    });
  }
  if (read(repo, WRAPPER) === null) {
    changes.push({
      file: WRAPPER,
      action: 'create',
      summary: 'Add the wrapper for what the app’s pages need around them.',
      after: PREVIEW_WRAPPER
    });
  }
  const tailwind = planTailwindSource(repo, [
    'app/assets/css',
    'assets/css',
    'app/assets',
    'assets'
  ]);
  if (tailwind && 'manual' in tailwind) manual.push(tailwind.manual);
  else if (tailwind) changes.push(tailwind);
  return {
    changes,
    manual,
    ignoredFromBuild: [],
    gitWanted: [`/${MODULE_FILE}`, `/${PAGE_FILE}`, `/${REGISTRY_FILE}`]
  };
}

const SETUP_NOTES = `This repo is on Nuxt, which has a recipe: roughbook init writes ${MODULE_FILE}, a local module (Nuxt
registers every module in modules/ itself) that does nothing unless nuxt dev runs, so nuxt build holds
nothing from rough/ (gate: build, searched in .output); in development it shows ${PAGE_FILE} at
/rough-preview/<page>/<component>/<iteration> in place of app.vue for that address, and adds the
address to the router of an app with pages. The page loads the iteration's ${ENTRY} through the
generated ${REGISTRY_FILE}, which the studio rewrites when iterations come and go, with its ${FIXTURE}
as props, inside ${WRAPPER}, renders it on the server and the client,
answers 404 for a key with no iteration and 500 for one that fails, posts the ready and error messages,
applies the variant asked for (a dark class and color-scheme on the html element) and answers this
machine only. Vite's hot reload shows a changed iteration (reload: app). Where the app uses Tailwind 4,
its stylesheet gains an @source line for rough/. Start from that setup; change it only where this app
needs it: ${WRAPPER} is the place for the layout, providers and stylesheets an iteration needs around it
(an app's global css from nuxt.config already applies), and a global route middleware that redirects
must let /rough-preview through in development. Keep recipe: nuxt so the studio keeps the module up to
date.`;

/**
 * An iteration that renders one of the app's components as it is (decision 2 of the brownfield
 * plan): a component that imports the real one and hands it the fixture the preview passes in.
 */
export function vuePointer(
  component: MapComponent,
  input: { iterationDir: string; fixture: string | null }
): Record<string, string> | null {
  const source = component.files[0];
  if (!source?.endsWith('.vue')) return null;
  const relative = path.posix.relative(input.iterationDir, source);
  const spec = relative.startsWith('.') ? relative : `./${relative}`;
  return {
    [ENTRY]: `<script setup lang="ts">
// ${component.name}, as the app has it in ${source}: a pointer, never a copy.
import Target from ${JSON.stringify(spec)};
</script>

<template>
  <Target v-bind="$attrs" />
</template>
`,
    ...(input.fixture !== null ? { [FIXTURE]: input.fixture } : {})
  };
}

export const nuxt: Recipe = {
  id: 'nuxt',
  name: 'Vue with Nuxt',
  version: 1,
  setupNotes: SETUP_NOTES,
  appDir: () => null,
  environment(link): RepoEnvironment {
    return {
      contract: 1,
      recipe: 'nuxt',
      recipeVersion: 1,
      stack: link?.stack ?? [],
      family: 'markup-css',
      mode: 'live',
      entry: ENTRY,
      sources: ['.vue', '.ts', '.js', '.css', '.json', '.md', '.svg'],
      code: ['.vue', '.ts', '.js', '.mjs'],
      placement: { kind: 'rough' },
      wrapper: WRAPPER,
      runtime: { kind: 'local' },
      shell: 'none',
      start: {
        command: `npm run dev -- --port ${PORT} --host 127.0.0.1`,
        url: `http://127.0.0.1:${PORT}`
      },
      preview: '/rough-preview/{key}',
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
      ignore: ['node_modules', '.git', '.nuxt', '.output', '.data', 'dist'],
      overlays: ['#nuxt-devtools-container', 'nuxt-devtools-frame', '#nuxt-devtools-anchor'],
      fixture: FIXTURE,
      build: { command: 'npm run build', output: ['.output'] },
      gate: 'build',
      production: null,
      checks: [],
      timeouts: { start: 120, preview: 120, build: 600 },
      promote: { dir: 'app/components', extensions: ['.vue'] },
      assets: { dir: 'public', url: '/', copy: false },
      copy: { kind: 'inline' },
      // A sketch is React, which Vue does not render: it is ported.
      sketches: 'port',
      terms: { page: 'page', component: 'component' },
      workshop: null,
      setupFiles: [],
      devDependencies: []
    };
  },
  planPreview,
  discover: discoverNuxt,
  pointer: vuePointer,
  setupFiles: () => [MODULE_FILE],
  agentRules:
    environment => `- \`${environment.entry}\` is a Vue single-file component, rendered by the app's own Nuxt on the
  server and in the browser: \`<script setup lang="ts">\`, a template, and scoped styles or the app's
  classes. Its \`${FIXTURE}\` keys are its props (\`defineProps\`); give each a default.
- Use the app's components and composables as its pages do; import another file of the iteration by
  its relative path.
`,
  roughTsconfig: () => null,
  placeholder: () => `<template>
  <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 2rem; text-align: center; font-family: system-ui, sans-serif; color: #5b6274; background: #f6f8fa">
    <p>${PLACEHOLDER_LINE}</p>
  </div>
</template>
`,
  generatedFiles: [REGISTRY_FILE],
  importAllowed: () => [MODULE_FILE],
  syncPreview: writeRegistry,
  pullTransform: (_file, text) => text,
  promoteDefault: (componentsDir, componentName) =>
    `${componentsDir}/${pascalCase(componentName)}.vue`,
  promoteExtensions: ['.vue'],
  promoteWords: {
    read: 'package.json, nuxt.config and how styling is done\n(its css, Tailwind or a UI module)',
    rules: ['- Write a single-file component with <script setup lang="ts">.'],
    usage: 'its tag, which Nuxt imports by its file name, and its props'
  },
  craft: familyCraft('markup-css'),
  doctorSamples: ({ marker, fixtureNote }) => ({
    good: {
      [ENTRY]: `<script setup lang="ts">
defineProps<{ note?: string }>();
</script>

<template>
  <main data-roughbook="doctor">
    <p>${marker}</p>
    <p>{{ note }}</p>
  </main>
</template>
`,
      [FIXTURE]: `{ "note": "${fixtureNote}" }\n`
    },
    broken: {
      [ENTRY]: `<script setup lang="ts">
throw new Error("roughbook doctor: this iteration fails on purpose");
</script>

<template>
  <p>never</p>
</template>
`
    }
  }),
  scaffold: {
    tool: 'create-nuxt',
    needs: ['npx'],
    steps: name => [
      {
        kind: 'run',
        summary: 'Make a Nuxt app with create-nuxt, from its minimal template, and install it',
        line: `npx --yes create-nuxt@4 ${name} --template minimal --packageManager npm --no-gitInit --install`,
        shell: 'none',
        in: 'parent'
      }
    ]
  }
};
