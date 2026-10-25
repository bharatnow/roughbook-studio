// Shopify themes (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Recipes", 4th in the launch order): live, through
// `shopify theme dev`, which uploads the theme to a development theme on the designer's store and
// serves it at 127.0.0.1:9292. Every preview needs a store the designer signed in to; the runtime
// gate asks the store's live theme, whose address the designer names (production).
import fs from 'node:fs';
import path from 'node:path';
import type { EnvironmentOs, RepoEnvironment } from '../../environment/types.js';
import { currentOs, hostPlatform } from '../../launch/platform.js';
import type { RepoLink } from '../../repo/link.js';
import { read, type PrepChange } from '../../repo/plan.js';
import { PLACEHOLDER_LINE } from '../../runs/placeholder.js';
import { familyCraft } from '../craft.js';
import type { PreviewPlan, Recipe } from '../types.js';
import {
  DISPATCH,
  ENTRY,
  FIXTURE,
  ITERATION_PREFIX,
  PREVIEW_TEMPLATE,
  PREVIEW_WRAPPER,
  TEMPLATE,
  WRAPPER,
  WRAPPER_SNIPPET,
  isOurTemplate,
  syncShopifyPreview
} from './preview.js';
import { discoverShopify } from './discover.js';

const PORT = 9292;

function planPreview(repo: string, link: RepoLink): PreviewPlan {
  void link;
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  const current = read(repo, TEMPLATE);
  if (current !== PREVIEW_TEMPLATE) {
    if (current !== null && !isOurTemplate(current)) {
      manual.push(`${TEMPLATE} exists and was not written by Roughbook, so it was left alone.`);
    } else {
      changes.push({
        file: TEMPLATE,
        action: current === null ? 'create' : 'edit',
        summary:
          current === null
            ? 'Add the template that shows one iteration on a development theme.'
            : `Update ${TEMPLATE}.`,
        after: PREVIEW_TEMPLATE
      });
    }
  }
  if (read(repo, WRAPPER) === null) {
    changes.push({
      file: WRAPPER,
      action: 'create',
      summary: 'Add the wrapper around every iteration.',
      after: PREVIEW_WRAPPER
    });
  }
  return {
    changes,
    manual,
    ignoredFromBuild: [],
    gitWanted: [
      `/${TEMPLATE}`,
      `/${DISPATCH}`,
      `/${WRAPPER_SNIPPET}`,
      `/snippets/${ITERATION_PREFIX}*.liquid`
    ]
  };
}

const SETUP_NOTES = `This repo is a Shopify theme, which has a recipe: previews go through shopify theme dev (at
http://127.0.0.1:${PORT}, on a development theme of the designer's store, after they sign in to the Shopify
CLI themselves), and Liquid renders only from the theme's own flat folders, so the studio writes each
iteration's ${ENTRY} as snippets/${ITERATION_PREFIX}<page>--<component>--<iteration>.liquid, a dispatcher
${DISPATCH} that renders the one asked for with its ${FIXTURE} values as parameters, and ${WRAPPER_SNIPPET}
from ${WRAPPER}; roughbook init writes ${TEMPLATE}, which shows one at
/search?q=<page>/<component>/<iteration>&view=rough-preview (search.terms is the part of an address
Liquid reads) inside the theme's layout, posts ready, or the error Liquid wrote in its place, and
renders nothing unless theme.role is development. All of them are gitignored, so a theme deployed from
git never has them (gate: runtime: name the store's live address as production, where the preview shows
nothing). theme dev reloads the page when a file changes (reload: app). Start from that setup; keep an
iteration a section's markup with the theme's own snippets and settings, and keep recipe: shopify so the
studio keeps the snippets up to date. Never push a theme from a checkout with previews applied
(roughbook uninstall takes them out).`;

export const shopify: Recipe = {
  id: 'shopify',
  name: 'Shopify themes',
  version: 1,
  setupNotes: SETUP_NOTES,
  appDir: () => null,
  environment(link, os?: EnvironmentOs): RepoEnvironment {
    // The Shopify CLI installed by npm is a batch file on Windows, which only a shell starts.
    const windows = (os ?? currentOs(hostPlatform())) === 'windows';
    return {
      contract: 1,
      recipe: 'shopify',
      recipeVersion: 1,
      stack: link?.stack ?? [],
      family: 'markup-css',
      mode: 'live',
      entry: ENTRY,
      sources: ['.liquid', '.json', '.css', '.js', '.md', '.svg'],
      code: [],
      placement: { kind: 'rough' },
      wrapper: WRAPPER,
      runtime: { kind: 'local' },
      shell: windows ? 'cmd' : 'none',
      start: {
        command: `shopify theme dev --port ${PORT}`,
        url: `http://127.0.0.1:${PORT}`
      },
      preview: '/search?q={key}&view=rough-preview',
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
      ignore: ['node_modules', '.git', '.shopify'],
      overlays: [],
      fixture: FIXTURE,
      build: { command: null, output: [] },
      gate: 'runtime',
      // The store's live theme, which only the designer can name: production: https://<store>.myshopify.com
      production: null,
      checks: [],
      timeouts: { start: 180, preview: 60, build: 600 },
      promote: { dir: 'sections', extensions: ['.liquid'] },
      assets: { dir: 'assets', url: null, copy: false },
      copy: { kind: 'inline' },
      // A sketch is React, which Liquid does not render: it is ported.
      sketches: 'port',
      terms: { page: 'template', component: 'section' },
      workshop: null,
      setupFiles: [],
      devDependencies: []
    };
  },
  planPreview,
  discover: discoverShopify,
  // The template, and the snippets written for the iterations there are now, for uninstall.
  setupFiles: repo => [
    TEMPLATE,
    ...(fs.existsSync(path.join(repo, 'snippets'))
      ? fs
          .readdirSync(path.join(repo, 'snippets'))
          .filter(file => file.startsWith(ITERATION_PREFIX))
          .sort()
          .map(file => `snippets/${file}`)
      : [])
  ],
  agentRules:
    environment => `- \`${environment.entry}\` is a section's markup in Liquid, which the studio copies into the theme's
  snippets and renders on a development theme inside the theme's layout: the theme's own snippets
  (\`{% render %}\`), its CSS classes and settings, and \`{{ 'file' | asset_url }}\` for its assets.
  Its \`${FIXTURE}\` keys are its variables (strings, numbers and booleans); give each a default with
  \`| default:\`. It cannot render another snippet of the iteration: keep it one file.
`,
  roughTsconfig: () => null,
  placeholder:
    () => `<div style="display: flex; align-items: center; justify-content: center; min-height: 60vh; padding: 2rem; text-align: center; font-family: system-ui, sans-serif; color: #5b6274; background: #f6f8fa;">
  <p>${PLACEHOLDER_LINE}</p>
</div>
`,
  generatedFiles: [DISPATCH, WRAPPER_SNIPPET],
  importAllowed: () => [],
  syncPreview: syncShopifyPreview,
  pullTransform: (_file, text) => text,
  promoteDefault: (componentsDir, componentName) =>
    `${componentsDir}/${componentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.liquid`,
  promoteExtensions: ['.liquid'],
  promoteWords: {
    read: "config/settings_schema.json, layout/theme.liquid and the theme's\nsections/ and snippets/",
    rules: [
      '- A section ends with its {% schema %}: its name, settings for the copy and images a\n  merchant changes, and presets so it can be added in the theme editor.',
      "- Use an asset as {{ '<file>' | asset_url }}."
    ],
    usage: 'its name, as the theme editor adds it, and its settings'
  },
  craft: familyCraft('markup-css'),
  doctorSamples: ({ marker, fixtureNote }) => ({
    good: {
      [ENTRY]: `<section data-roughbook="doctor">
  <p>${marker}</p>
  <p>{{ note }}</p>
</section>
`,
      [FIXTURE]: `{ "note": "${fixtureNote}" }\n`
    },
    broken: {
      // A snippet that is not there: Liquid writes its error where the iteration would be.
      [ENTRY]: `{%- render 'roughbook-doctor-no-such-snippet' -%}\n`
    }
  }),
  scaffold: {
    tool: "the Shopify CLI's theme init",
    needs: ['npx', 'git'],
    steps: name => [
      {
        kind: 'run',
        summary: "Make a theme from Shopify's Skeleton theme with the Shopify CLI",
        line: `npx --yes @shopify/cli@4 theme init ${name}`,
        shell: 'none',
        in: 'parent'
      }
    ]
  }
};
