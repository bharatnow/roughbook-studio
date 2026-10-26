// Forks and refines of the app's own component (ROUGHBOOK-BROWNFIELD-PLAN.md, B3, decisions 9, 31
// and 32): the slot starts from a copy of the component's real files, laid out by the recipe's
// `fromApp`, never the baseline's pointer; the copy renders as the baseline does before anything
// changes, its relative imports pointing back at the app; the originals are kept in `.base/` with
// `.base/base.json`, which the checks, the snapshot, the watcher, the pictures and revert leave out;
// and the child components an agent copies in are recorded there for B4.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { StudioApi } from '../api/client.js';
import { outboxFor } from '../api/outbox.js';
import { writeMap } from '../map/file.js';
import type { MapComponent, RepoMap } from '../map/types.js';
import { layOut, rewriteImports } from '../recipes/fromApp.js';
import { recipeFor } from '../recipes/index.js';
import type { Recipe } from '../recipes/types.js';
import type { RepoLink } from '../repo/link.js';
import { BASE_FILE, isBasePath, planAppSlot, readBase, writeAppSlot } from '../runs/base.js';
import { applyChecks, checkIteration, readFolder } from '../runs/checks.js';
import { assessRun, finishRun, startRuns } from '../runs/lifecycle.js';
import { createSlot, isPlaceholder } from '../runs/slots.js';
import { forkFields } from '../runs/forkIntent.js';
import { runKind } from '../commands/run.js';
import { listRepoFiles, revertFile } from '../runs/snapshot.js';
import type { Check, StartRunRequest, StartedRun } from '../runs/types.js';
import { watchedPath } from '../runs/watch.js';
import { iterationHash } from '../screenshot/iteration.js';
import { fakeFetch, ok, refused, tempDir, type RecordedRequest } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const RUN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: null
};
const STUDIO = path.resolve(import.meta.dirname, '..', '..');

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');
const exists = (repo: string, file: string) => fs.existsSync(path.join(repo, ...file.split('/')));

function component(slug: string, files: string[], extra: Partial<MapComponent> = {}): MapComponent {
  return {
    slug,
    name: slug,
    kind: 'section',
    files,
    export: 'default',
    fixture: null,
    alone: 'yes',
    why: null,
    byAgent: false,
    ...extra
  };
}

function repoMap(components: MapComponent[], by = 'next'): RepoMap {
  return {
    version: 1,
    by: [by],
    pages: [
      {
        slug: 'pricing',
        name: 'Pricing',
        address: '/pricing',
        example: null,
        signIn: 'no',
        files: [],
        sections: components.map(item => item.slug),
        byAgent: false
      }
    ],
    components,
    missed: [],
    unplaced: []
  };
}

function git(repo: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}

/** The pricing section of a module app: a component that imports a sibling, data and an alias. */
function moduleApp(repo: string) {
  write(
    repo,
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { jsx: 'react-jsx', paths: { '@/*': ['./*'] } } })
  );
  write(
    repo,
    'components/pricing/pricing-section.tsx',
    `import { plans } from "@/lib/plans";
import { PlanCard } from "./plan-card";
import { Heading } from "../ui/heading";
import "./pricing.css";

export function PricingSection({ title }: { title: string }) {
  return (
    <section>
      <Heading text={title} />
      {plans.map((plan) => (
        <PlanCard key={plan.name} plan={plan} />
      ))}
    </section>
  );
}
`
  );
  write(
    repo,
    'components/pricing/plan-card.tsx',
    `export function PlanCard({ plan }: { plan: { name: string; price: string } }) {
  return <div className="card"><h3>{plan.name}</h3><p>{plan.price}</p></div>;
}
`
  );
  write(repo, 'components/pricing/pricing.css', '.card { color: red }\n');
  write(
    repo,
    'components/ui/heading.tsx',
    'export function Heading({ text }: { text: string }) { return <h2>{text}</h2>; }\n'
  );
  write(
    repo,
    'lib/plans.ts',
    'export const plans = [{ name: "Free", price: "$0" }, { name: "Pro", price: "$9" }];\n'
  );
  return component('pricing-section', ['components/pricing/pricing-section.tsx'], {
    name: 'PricingSection',
    export: 'PricingSection'
  });
}

/** Renders an iteration's entry in Node with React, through esbuild, as a bundler resolves it. */
async function render(repo: string, folder: string, props: Record<string, unknown>) {
  const result = await build({
    stdin: {
      contents: `import App from "./${folder}/index.tsx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
export default (props) => renderToStaticMarkup(createElement(App, props));
`,
      resolveDir: repo,
      loader: 'tsx'
    },
    absWorkingDir: repo,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    write: false,
    metafile: true,
    nodePaths: [path.join(STUDIO, 'node_modules')],
    tsconfig: path.join(repo, 'tsconfig.json'),
    loader: { '.css': 'empty' },
    logLevel: 'silent'
  });
  const out = path.join(repo, `.render-${folder.replace(/\W/g, '-')}.cjs`);
  fs.writeFileSync(out, result.outputFiles[0]!.text);
  const run = createRequire(import.meta.url)(out) as { default: (p: unknown) => string };
  fs.rmSync(out);
  return { html: run.default(props), inputs: Object.keys(result.metafile.inputs) };
}

async function plainRepo(prefix: string) {
  const repo = path.join(await tempDir(prefix), 'app');
  fs.mkdirSync(repo, { recursive: true });
  return repo;
}

/** Writes the baseline as adoption does, through the pointer, and the fork's slot from the app. */
function fork(repo: string, recipe: Recipe, item: MapComponent, fixture: string | null) {
  writeMap(repo, repoMap([item], recipe.id));
  const baseline = 'rough/pricing/' + item.slug + '/iteration-00';
  const pointer = recipe.pointer!(item, { iterationDir: baseline, fixture })!;
  for (const [file, text] of Object.entries(pointer)) write(repo, `${baseline}/${file}`, text);
  const environment = recipe.environment(LINK);
  const target = { page: 'pricing', component: item.slug, iteration: 'iteration-01' };
  const slot = planAppSlot(repo, recipe, environment, target);
  const folder = `rough/pricing/${item.slug}/iteration-01`;
  const base = writeAppSlot(repo, folder, slot, { parent: 'iteration-00', commit: null });
  return { baseline, folder, slot, base, environment };
}

describe('laying out and rewriting a copy', () => {
  it('names each copy by its own name, never the entry or the fixture, and apart when two share one', () => {
    assert.deepEqual(
      layOut(
        ['components/hero/index.tsx', 'components/hero/hero.css', 'lib/hero.css'],
        ['index.tsx', 'preview.json']
      ),
      {
        'components/hero/index.tsx': 'hero-index.tsx',
        'components/hero/hero.css': 'hero.css',
        'lib/hero.css': 'lib-hero.css'
      }
    );
  });

  it('points relative imports at the app, or at a copy, and leaves packages and aliases alone', () => {
    const copies = {
      'components/pricing/pricing-section.tsx': 'pricing-section.tsx',
      'components/pricing/pricing.module.css': 'pricing.module.css'
    };
    const text = `import { PlanCard } from "./plan-card";
import styles from './pricing.module.css';
import { Heading } from "../ui/heading.js";
import data from "../../data/plans.json";
import React from "react";
import { cn } from "@/lib/utils";
const lazy = () => import("./faq");
export * from "./types";
`;
    const rewritten = rewriteImports(
      text,
      'components/pricing/pricing-section.tsx',
      copies,
      'rough/pricing/pricing-section/iteration-01'
    );
    assert.equal(
      rewritten,
      `import { PlanCard } from "../../../../components/pricing/plan-card";
import styles from './pricing.module.css';
import { Heading } from "../../../../components/ui/heading.js";
import data from "../../../../data/plans.json";
import React from "react";
import { cn } from "@/lib/utils";
const lazy = () => import("../../../../components/pricing/faq");
export * from "../../../../components/pricing/types";
`
    );
  });
});

describe('a fork from the app renders as its baseline, per recipe', () => {
  for (const id of ['next', 'vite', 'expo']) {
    it(`${id}: copies the module, rewrites its imports, and renders the same`, async () => {
      const repo = await plainRepo(`roughbook-from-app-${id}-`);
      const recipe = recipeFor(id)!;
      const item = moduleApp(repo);
      const fixture = '{ "title": "Plans" }\n';
      const { baseline, folder, base, environment } = fork(repo, recipe, item, fixture);
      const entry = environment.entry;

      // The copy, not the pointer: the component's own file, its imports pointed back at the app.
      const copy = read(repo, `${folder}/pricing-section.tsx`);
      assert.match(copy, /from "\.\.\/\.\.\/\.\.\/\.\.\/components\/pricing\/plan-card"/);
      assert.match(copy, /from "\.\.\/\.\.\/\.\.\/\.\.\/components\/ui\/heading"/);
      assert.match(copy, /import "\.\.\/\.\.\/\.\.\/\.\.\/components\/pricing\/pricing\.css"/);
      assert.match(copy, /from "@\/lib\/plans"/);
      assert.equal(
        read(repo, `${folder}/${entry}`),
        '// PricingSection, copied from components/pricing/pricing-section.tsx: this iteration changes the copy, pricing-section.tsx.\nexport { PricingSection as default } from "./pricing-section";\n'
      );
      // The baseline's fixture, carried over.
      assert.equal(read(repo, `${folder}/preview.json`), fixture);

      // .base/: the original byte for byte, and base.json naming it, its hash and the copy.
      assert.equal(
        read(repo, `${folder}/.base/components/pricing/pricing-section.tsx`),
        read(repo, 'components/pricing/pricing-section.tsx')
      );
      assert.deepEqual(
        base.files.map(file => [file.path, file.copy]),
        [['components/pricing/pricing-section.tsx', 'pricing-section.tsx']]
      );
      assert.match(base.files[0]!.sha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(readBase(repo, folder), base);
      assert.deepEqual(
        Object.keys(base.written).sort(),
        [entry, 'preview.json', 'pricing-section.tsx'].sort()
      );

      // Rendered as a bundler resolves them, the copy and the pointer show the same.
      const props = JSON.parse(fixture) as Record<string, unknown>;
      const before = await render(repo, baseline, props);
      const after = await render(repo, folder, props);
      assert.equal(after.html, before.html);
      assert.match(after.html, /<h2>Plans<\/h2>.*Free.*Pro/);
      // The copy uses the app's own plan card, never a copy, and nothing of .base/.
      assert.ok(after.inputs.includes('components/pricing/plan-card.tsx'));
      assert.ok(!after.inputs.some(input => input.includes('.base/')));
      assert.ok(!after.inputs.includes('components/pricing/pricing-section.tsx'));
    });
  }

  it('next: a default export in a file named as the entry is the entry itself', async () => {
    const repo = await plainRepo('roughbook-from-app-index-');
    write(repo, 'tsconfig.json', '{}');
    write(
      repo,
      'components/faq/index.tsx',
      'import { Item } from "./item";\nexport default function Faq() { return <ul><Item /></ul>; }\n'
    );
    write(repo, 'components/faq/item.tsx', 'export function Item() { return <li>Q</li>; }\n');
    const item = component('faq', ['components/faq/index.tsx']);
    const { baseline, folder, base } = fork(repo, recipeFor('next')!, item, null);
    assert.deepEqual(
      base.files.map(file => file.copy),
      ['index.tsx']
    );
    assert.match(
      read(repo, `${folder}/index.tsx`),
      /from "\.\.\/\.\.\/\.\.\/\.\.\/components\/faq\/item"/
    );
    assert.ok(!exists(repo, `${folder}/preview.json`), 'no fixture where the baseline has none');
    assert.equal((await render(repo, folder, {})).html, (await render(repo, baseline, {})).html);
  });

  it('nuxt: copies the single-file component, points its script imports at the app, and imports the copy', async () => {
    const repo = await plainRepo('roughbook-from-app-nuxt-');
    const text = `<script setup lang="ts">
import PlanCard from "./PlanCard.vue";
import { usePlans } from "~/composables/plans";
const plans = usePlans();
</script>

<template><section><PlanCard v-for="plan in plans" :key="plan.name" :plan="plan" /></section></template>
`;
    write(repo, 'app/components/pricing/PricingSection.vue', text);
    const item = component('pricing-section', ['app/components/pricing/PricingSection.vue']);
    const recipe = recipeFor('nuxt')!;
    const { baseline, folder, base } = fork(repo, recipe, item, '{ "title": "Plans" }\n');
    const copy = read(repo, `${folder}/PricingSection.vue`);
    assert.equal(
      copy,
      text.replace('"./PlanCard.vue"', '"../../../../app/components/pricing/PlanCard.vue"')
    );
    const pointer = read(repo, `${baseline}/index.vue`);
    const entry = read(repo, `${folder}/index.vue`);
    // The same component around it: only the note and the import's path differ.
    const shape = (vue: string) =>
      vue.replace(/^\/\/.*$/m, '').replace(/import Target from .*;/, '');
    assert.equal(shape(entry), shape(pointer));
    assert.match(entry, /import Target from "\.\/PricingSection\.vue";/);
    assert.equal(read(repo, `${folder}/preview.json`), '{ "title": "Plans" }\n');
    assert.equal(read(repo, `${folder}/.base/app/components/pricing/PricingSection.vue`), text);
    assert.equal(base.files[0]!.copy, 'PricingSection.vue');
    // The rewritten import names the file the original's did.
    const target = path.posix.normalize(
      path.posix.join(folder, '../../../../app/components/pricing/PlanCard.vue')
    );
    assert.equal(target, 'app/components/pricing/PlanCard.vue');
  });

  it('laravel: an included view is the entry itself; an anonymous component is included as its tag renders it', async () => {
    const repo = await plainRepo('roughbook-from-app-laravel-');
    const recipe = recipeFor('laravel')!;
    const view = `<section class="pricing">
  @include('partials.plan', ['plan' => $plans[0]])
  <h2>{{ $title }}</h2>
</section>
`;
    write(repo, 'resources/views/sections/pricing.blade.php', view);
    const section = component('pricing', ['resources/views/sections/pricing.blade.php'], {
      export: 'view sections.pricing'
    });
    const one = fork(repo, recipe, section, '{ "title": "Plans", "plans": [] }\n');
    // Blade needs no import rewritten: the copy is the view, as the include renders it.
    assert.equal(read(repo, `${one.folder}/index.blade.php`), view);
    assert.equal(
      read(repo, `${one.baseline}/index.blade.php`).includes("@include('sections.pricing')"),
      true
    );
    assert.equal(read(repo, `${one.folder}/preview.json`), '{ "title": "Plans", "plans": [] }\n');
    assert.equal(
      read(repo, `${one.folder}/.base/resources/views/sections/pricing.blade.php`),
      view
    );

    const footer = `@props(['year' => 2026])
<footer {{ $attributes->merge(['class' => 'site']) }}>{{ $slot }} &copy; {{ $year }} {{ $companyName }}</footer>
`;
    write(repo, 'resources/views/components/site-footer.blade.php', footer);
    const tag = component('site-footer', ['resources/views/components/site-footer.blade.php'], {
      export: 'x-site-footer',
      kind: 'shared'
    });
    const two = fork(repo, recipe, tag, '{ "year": 2025, "companyName": "Acme" }\n');
    assert.equal(read(repo, `${two.folder}/site-footer.blade.php`), footer);
    // The same attributes the pointer's tag passes, by the same names, and the slot it leaves empty.
    assert.match(
      read(repo, `${two.baseline}/index.blade.php`),
      /<x-dynamic-component component="site-footer" :year="\$year" :company-name="\$companyName" \/>/
    );
    assert.equal(
      read(repo, `${two.folder}/index.blade.php`),
      `{{-- site-footer, copied from resources/views/components/site-footer.blade.php: this iteration changes the copy, site-footer.blade.php. --}}
@include('rough::pricing.site-footer.iteration-01.site-footer', ['attributes' => new \\Illuminate\\View\\ComponentAttributeBag(['year' => $year, 'company-name' => $companyName]), 'slot' => new \\Illuminate\\Support\\HtmlString('')])
`
    );

    // A class component is not copied: its class would be declared twice.
    write(repo, 'app/View/Components/Alert.php', '<?php class Alert {}\n');
    const klass = component('alert', ['app/View/Components/Alert.php'], { export: 'x-alert' });
    writeMap(repo, repoMap([klass], 'laravel'));
    write(
      repo,
      'rough/pricing/alert/iteration-00/index.blade.php',
      '<x-dynamic-component component="alert" />\n'
    );
    assert.throws(
      () =>
        planAppSlot(repo, recipe, recipe.environment(LINK), {
          page: 'pricing',
          component: 'alert',
          iteration: 'iteration-01'
        }),
      /cannot be copied into an iteration on this stack/
    );
  });

  it('wordpress: a pattern, a block part and a classic part, each rendered as its pointer renders the theme’s', async () => {
    const repo = await plainRepo('roughbook-from-app-wordpress-');
    const recipe = recipeFor('wordpress')!;
    const guard = "<?php defined( 'ABSPATH' ) || exit; ?>";
    const pattern = `<?php
/**
 * Title: Pricing
 * Slug: harbor/pricing
 */
?>
<!-- wp:heading --><h2>Plans</h2><!-- /wp:heading -->
`;
    write(repo, 'patterns/pricing.php', pattern);
    const one = fork(
      repo,
      recipe,
      component('pricing', ['patterns/pricing.php'], { export: 'pattern harbor/pricing' }),
      null
    );
    assert.equal(read(repo, `${one.folder}/pricing.php`), `${guard}\n${pattern}`);
    assert.equal(
      read(repo, `${one.folder}/index.php`),
      `${guard}\n<?php /* pricing, copied from patterns/pricing.php: this iteration changes the copy, pricing.php. */ ?>\n<?php include __DIR__ . '/pricing.php'; ?>\n`
    );
    assert.equal(read(repo, `${one.folder}/.base/patterns/pricing.php`), pattern);

    write(
      repo,
      'theme.json',
      JSON.stringify({ templateParts: [{ name: 'header', area: 'header' }] })
    );
    const part = '<!-- wp:site-title /-->\n';
    write(repo, 'parts/header.html', part);
    const two = fork(
      repo,
      recipe,
      component('header', ['parts/header.html'], { export: 'part header', kind: 'shared' }),
      null
    );
    assert.equal(read(repo, `${two.folder}/header.html`), part);
    assert.match(
      read(repo, `${two.folder}/index.php`),
      /<header class="wp-block-template-part"><\?php echo file_get_contents\( __DIR__ \. '\/header\.html' \); \?><\/header>/
    );

    const classic = '<nav><?php echo esc_html( $args["label"] ?? "" ); ?></nav>\n';
    write(repo, 'template-parts/nav.php', classic);
    const three = fork(
      repo,
      recipe,
      component('nav', ['template-parts/nav.php'], { export: 'part template-parts/nav' }),
      '{ "label": "Main" }\n'
    );
    assert.match(
      read(repo, `${three.baseline}/index.php`),
      /get_template_part\( 'template-parts\/nav', null, get_defined_vars\(\) \)/
    );
    assert.match(
      read(repo, `${three.folder}/index.php`),
      /load_template\( __DIR__ \. '\/nav\.php', false, get_defined_vars\(\) \)/
    );
    assert.equal(read(repo, `${three.folder}/nav.php`), `${guard}\n${classic}`);
    assert.equal(read(repo, `${three.folder}/preview.json`), '{ "label": "Main" }\n');
  });

  it('shopify has no pointer and no copy: a fork from the app is refused with the reason', async () => {
    const repo = await plainRepo('roughbook-from-app-shopify-');
    const recipe = recipeFor('shopify')!;
    assert.equal(recipe.fromApp, undefined);
    writeMap(repo, repoMap([component('hero', ['sections/hero.liquid'])], 'shopify'));
    assert.throws(
      () =>
        planAppSlot(repo, recipe, recipe.environment(LINK), {
          page: 'pricing',
          component: 'hero',
          iteration: 'iteration-01'
        }),
      /cannot copy the app's own component/
    );
  });
});

function started(iteration: string, runId: string, prompt: string, checks: Check[]): StartedRun {
  return {
    runId,
    iteration,
    parent: 'iteration-00',
    targetFolder: `rough/pricing/pricing-section/${iteration}`,
    prompt,
    checks
  };
}

const CHECKS: Check[] = [
  { kind: 'entry-file', file: 'index.tsx' },
  { kind: 'changed-from-parent', parent: 'iteration-00' }
];

const PROMPT = `<task>
Fork the app's own PricingSection. Its files:
{{roughbook:app-files}}
The originals, read-only, are in {{roughbook:base}}.
</task>
`;

/** A Next.js app in git with its pricing section adopted, and a fake backend handing out `runs`. */
async function adopted(runs: StartedRun[]) {
  const repo = await plainRepo('roughbook-from-app-run-');
  const item = moduleApp(repo);
  write(repo, 'package.json', '{}');
  write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
  writeMap(
    repo,
    repoMap([
      item,
      component('plan-card', ['components/pricing/plan-card.tsx'], {
        name: 'PlanCard',
        export: 'PlanCard',
        kind: 'atom'
      })
    ])
  );
  const baseline = 'rough/pricing/pricing-section/iteration-00';
  for (const [file, text] of Object.entries(
    recipeFor('next')!.pointer!(item, {
      iterationDir: baseline,
      fixture: '{ "title": "Plans" }\n'
    })!
  )) {
    write(repo, `${baseline}/${file}`, text);
  }
  write(repo, '.gitignore', '/rough/.roughbook/\n');
  git(repo, 'init', '--quiet');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'start');
  const fake = fakeFetch((request: RecordedRequest) => {
    if (request.url.endsWith('/runs')) return ok(runs, 201);
    if (request.url.endsWith('/finish')) {
      return ok({ status: (request.body as { outcome: string }).outcome });
    }
    return refused('NOT_FOUND', 404);
  });
  const api = new StudioApi({
    server: 'http://localhost:4000',
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: fake.fetch
  });
  return { repo, api, requests: fake.requests, outbox: outboxFor(repo) };
}

const FORK: StartRunRequest = {
  page: 'pricing',
  component: 'pricing-section',
  agent: 'claude-code',
  mode: 'interactive',
  kind: 'fork',
  parent: 'iteration-00'
};

describe('a run from the app', () => {
  it('starts from the copy, keeps the base at the commit, and fills the stand-ins', async () => {
    const { repo, api, requests } = await adopted([started('iteration-01', RUN_A, PROMPT, CHECKS)]);
    const [run] = await startRuns(repo, api, LINK, FORK);
    const folder = 'rough/pricing/pricing-section/iteration-01';
    assert.equal(run!.targetFolder, folder);
    assert.ok(!read(repo, `${folder}/index.tsx`).includes('never a copy'), 'never the pointer');
    assert.match(read(repo, `${folder}/pricing-section.tsx`), /components\/pricing\/plan-card"/);
    assert.equal(read(repo, `${folder}/preview.json`), '{ "title": "Plans" }\n');
    const base = readBase(repo, folder)!;
    assert.equal(base.commit, git(repo, 'rev-parse', 'HEAD'));
    assert.equal(base.parent, 'iteration-00');
    assert.equal(base.component, 'pricing-section');
    assert.deepEqual(base.children, []);

    const prompt = read(repo, run!.promptFile);
    assert.match(
      prompt,
      /Its files:\ncomponents\/pricing\/pricing-section\.tsx\nThe originals, read-only, are in rough\/pricing\/pricing-section\/iteration-01\/\.base\/\./
    );
    assert.ok(!prompt.includes('{{roughbook:'));
    // Nothing of the copy, the base or its paths reached the server.
    const sent = JSON.stringify(requests.map(request => request.body));
    assert.ok(!sent.includes('components/pricing'), sent);
    assert.ok(!sent.includes('.base'), sent);
  });

  it('takes the stand-ins the backend names, and a refine starts from the copy too', async () => {
    const named = started('iteration-02', RUN_B, 'Files: <<files>> Base: <<base>>\n', CHECKS);
    named.placeholders = { assetOrigin: '<<asset>>', appFiles: '<<files>>', base: '<<base>>' };
    const { repo, api } = await adopted([named]);
    const [run] = await startRuns(repo, api, LINK, {
      ...FORK,
      kind: 'refine',
      parent: 'iteration-00',
      preset: 'polish',
      intent: 'Tighter cards'
    });
    assert.match(
      read(repo, run!.promptFile),
      /^Files: components\/pricing\/pricing-section\.tsx Base: rough\/pricing\/pricing-section\/iteration-02\/\.base\//
    );
    assert.ok(exists(repo, `rough/pricing/pricing-section/iteration-02/${BASE_FILE}`));
  });

  it('is refused before anything is allocated when the map has no such component', async () => {
    const { repo, api, requests } = await adopted([started('iteration-01', RUN_A, PROMPT, CHECKS)]);
    writeMap(repo, repoMap([]));
    await assert.rejects(
      startRuns(repo, api, LINK, FORK),
      /map\.md has no component pricing-section/
    );
    assert.equal(requests.length, 0);
    assert.ok(!exists(repo, 'rough/pricing/pricing-section/iteration-01'));
  });

  it('never copies the pointer when no copy was made', async () => {
    const { repo } = await adopted([]);
    assert.throws(
      () =>
        createSlot(repo, {
          page: 'pricing',
          component: 'pricing-section',
          iteration: 'iteration-03',
          parent: 'iteration-00'
        }),
      /starts from a copy of the real files/
    );
  });

  it('measures changed-from-parent against the copy the base made, never the pointer', async () => {
    const { repo, api } = await adopted([started('iteration-01', RUN_A, PROMPT, CHECKS)]);
    const [run] = await startRuns(repo, api, LINK, FORK);
    const sources = recipeFor('next')!.environment(LINK).sources;
    const fresh = checkIteration(repo, run!, sources);
    assert.deepEqual(
      fresh.warnings.map(item => item.code),
      ['UNCHANGED_FROM_PARENT']
    );
    assert.match(fresh.warnings[0]!.message, /the copy of the app's own component/);
    // Against the pointer it would have read as changed: the base is what counts.
    const folder = 'rough/pricing/pricing-section/iteration-01';
    write(
      repo,
      `${folder}/pricing-section.tsx`,
      read(repo, `${folder}/pricing-section.tsx`).replace(
        '<section>',
        '<section className="tight">'
      )
    );
    assert.deepEqual(checkIteration(repo, run!, sources).warnings, []);
    // A change to .base/ alone is no change to the iteration.
    write(
      repo,
      `${folder}/pricing-section.tsx`,
      read(repo, `${folder}/.base/components/pricing/pricing-section.tsx`)
    );
    const copied = planAppSlot(repo, recipeFor('next')!, { fixture: 'preview.json' }, run!);
    write(repo, `${folder}/pricing-section.tsx`, copied.copy.files['pricing-section.tsx']!);
    write(repo, `${folder}/.base/components/pricing/pricing-section.tsx`, 'changed');
    assert.deepEqual(
      checkIteration(repo, run!, sources).warnings.map(item => item.code),
      ['UNCHANGED_FROM_PARENT']
    );
  });

  it('sets line endings aside: a copy with its line breaks turned over is unchanged (decision 39)', async () => {
    const { repo, api } = await adopted([started('iteration-01', RUN_A, PROMPT, CHECKS)]);
    const [run] = await startRuns(repo, api, LINK, FORK);
    const sources = recipeFor('next')!.environment(LINK).sources;
    const file = 'rough/pricing/pricing-section/iteration-01/pricing-section.tsx';
    write(repo, file, read(repo, file).replace(/\n/g, '\r\n'));
    assert.deepEqual(
      checkIteration(repo, run!, sources).warnings.map(item => item.code),
      ['UNCHANGED_FROM_PARENT']
    );
    // And for a studio iteration's parent, read as it is.
    const parent = new Map([['index.tsx', 'a\r\nb\r\n']]);
    const same = applyChecks([{ kind: 'changed-from-parent', parent: 'iteration-01' }], {
      iterationId: 'iteration-02',
      files: new Map([['index.tsx', 'a\nb\n']]),
      parentFiles: parent
    });
    assert.deepEqual(
      same.warnings.map(item => item.code),
      ['UNCHANGED_FROM_PARENT']
    );
  });
});

describe('.base/ is left out', () => {
  it('of the checks, the snapshot, the watcher, the pictures and revert', async () => {
    const { repo, api, outbox } = await adopted([started('iteration-01', RUN_A, PROMPT, CHECKS)]);
    const [run] = await startRuns(repo, api, LINK, FORK);
    const folder = 'rough/pricing/pricing-section/iteration-01';
    const kept = `${folder}/.base/components/pricing/pricing-section.tsx`;
    assert.ok(isBasePath(kept));
    assert.ok(!isBasePath('components/.base/x.tsx'), 'only under rough/');

    // The checks read the copy alone.
    const files = readFolder(path.join(repo, ...folder.split('/')), ['.tsx', '.json']);
    assert.deepEqual([...files!.keys()].sort(), [
      'index.tsx',
      'preview.json',
      'pricing-section.tsx'
    ]);
    const unchanged = applyChecks(CHECKS, {
      iterationId: 'iteration-01',
      files,
      parentHashes: new Map(Object.entries(readBase(repo, folder)!.written))
    });
    assert.deepEqual(
      unchanged.warnings.map(item => item.code),
      ['UNCHANGED_FROM_PARENT']
    );

    // The snapshot never records it, and so a change to it is no change outside the folder.
    const listed = (await listRepoFiles(repo)).files;
    assert.ok(listed.includes(`${folder}/pricing-section.tsx`));
    assert.ok(!listed.some(isBasePath), listed.join('\n'));
    // The watcher does not report it.
    assert.equal(watchedPath(kept), null);
    assert.equal(watchedPath(`${folder}/pricing-section.tsx`), `${folder}/pricing-section.tsx`);
    // The pictures' hash does not move with it.
    const target = { page: 'pricing', component: 'pricing-section', iteration: 'iteration-01' };
    const environment = recipeFor('next')!.environment(LINK);
    const before = iterationHash(repo, target, environment);
    write(repo, kept, 'changed');
    assert.equal(iterationHash(repo, target, environment), before);
    write(
      repo,
      `${folder}/pricing-section.tsx`,
      'export function PricingSection() { return null; }\n'
    );
    assert.notEqual(iterationHash(repo, target, environment), before);
    // Revert never touches it.
    assert.equal(await revertFile(repo, RUN_A, kept), 'cannot');
    assert.equal(read(repo, kept), 'changed');

    const assessment = await assessRun(repo, LINK, run!);
    assert.deepEqual(assessment.outOfScope, []);
    const finished = await finishRun(repo, api, outbox, LINK, RUN_A);
    assert.deepEqual(finished.outOfScope, []);
  });
});

describe('a child the agent copies in', () => {
  it('is recorded in base.json and kept in .base/, found or reported, and never sent', async () => {
    const { repo, api, outbox, requests } = await adopted([
      started('iteration-01', RUN_A, PROMPT, CHECKS)
    ]);
    await startRuns(repo, api, LINK, FORK);
    const folder = 'rough/pricing/pricing-section/iteration-01';
    // The agent copies the plan card in and rewrites all of it, as B3's live cards fork did, and
    // imports the copy: named as a file the original imports, it is a child (decision 39).
    write(
      repo,
      `${folder}/plan-card.tsx`,
      'export function PlanCard({ plan }: { plan: { name: string } }) {\n  return <article>{plan.name}</article>;\n}\n'
    );
    write(
      repo,
      `${folder}/pricing-section.tsx`,
      read(repo, `${folder}/pricing-section.tsx`).replace(
        '"../../../../components/pricing/plan-card"',
        '"./plan-card"'
      )
    );
    // And copies the heading, which it names in its report.
    write(repo, `${folder}/parts/heading.tsx`, 'export function Heading() { return null; }\n');
    // A file named as one the original imports is a child whatever it kept of it (decision 39).
    write(repo, `${folder}/pricing.css`, '.tight { gap: 4px }\n');
    // A new file named as nothing of the app's is the iteration's own.
    write(repo, `${folder}/toggle.tsx`, 'export function Toggle() { return null; }\n');
    // The app's plan card changes after the fork: the base keeps it as the fork's commit had it.
    const original = read(repo, 'components/pricing/plan-card.tsx');
    write(repo, 'components/pricing/plan-card.tsx', `${original}// later\n`);

    const finished = await finishRun(repo, api, outbox, LINK, RUN_A, {
      copied: ['components/ui/heading.tsx', 'rough/elsewhere.tsx', '../outside.tsx']
    });
    assert.deepEqual(finished.children, [
      'components/pricing/plan-card.tsx',
      'components/pricing/pricing.css',
      'components/ui/heading.tsx'
    ]);
    const base = readBase(repo, folder)!;
    assert.deepEqual(
      base.children.map(child => [child.path, child.copy]),
      [
        ['components/pricing/plan-card.tsx', 'plan-card.tsx'],
        ['components/pricing/pricing.css', 'pricing.css'],
        ['components/ui/heading.tsx', 'parts/heading.tsx']
      ]
    );
    // As the fork's commit has it, line endings as a checkout writes them.
    assert.equal(
      read(repo, `${folder}/.base/components/pricing/plan-card.tsx`).replace(/\r\n/g, '\n'),
      original
    );
    assert.ok(exists(repo, `${folder}/.base/components/ui/heading.tsx`));
    const sent = JSON.stringify(requests.map(request => request.body));
    assert.ok(!sent.includes('plan-card') && !sent.includes('heading'), sent);
    // The app's own file, changed while the run went, counts outside the folder as any file does;
    // the copies and the base are the run's own.
    assert.deepEqual(finished.outOfScope, ['components/pricing/plan-card.tsx']);
  });
});

describe('a fork’s intent and a clean start', () => {
  it('reads what changes, what is kept and a clean start, from the CLI and the local UI alike', () => {
    assert.deepEqual(
      runKind({ fork: 'iteration-02', intent: ' Bolder cards ', keep: 'the layout, prices,,' }),
      {
        kind: 'fork',
        parent: 'iteration-02',
        intent: { remain: ['the layout', 'prices'], change: 'Bolder cards' }
      }
    );
    assert.deepEqual(runKind({ fork: 'iteration-02', radical: true }), {
      kind: 'fork',
      parent: 'iteration-02',
      radical: true
    });
    // A plain fork is as it was: no fields the backend does not need.
    assert.deepEqual(runKind({ fork: 'iteration-02', radical: false }), {
      kind: 'fork',
      parent: 'iteration-02'
    });
    assert.throws(() => runKind({ fork: 'iteration-02', keep: 'the layout' }), /changes beside/);
    assert.throws(() => runKind({ direction: ['Quiet'], radical: true }), /are for a fork/);
    assert.throws(
      () => forkFields({ change: 'x', remain: Array.from({ length: 13 }, (_, i) => `k${i}`) }),
      /at most 12 things in one fork; this one lists 13/
    );
    assert.throws(() => forkFields({ change: 'x'.repeat(2001) }), /2000 characters/);
  });

  it('sends the intent with the fork, and a radical fork from the app starts empty with its base kept', async () => {
    const runs = [started('iteration-01', RUN_A, PROMPT, CHECKS)];
    const { repo, api, requests } = await adopted(runs);
    const [run] = await startRuns(repo, api, LINK, {
      ...FORK,
      intent: { remain: ['the data'], change: 'Start over' },
      radical: true
    });
    const body = requests.find(request => request.url.endsWith('/runs'))!.body as Record<
      string,
      unknown
    >;
    assert.deepEqual(body.intent, { remain: ['the data'], change: 'Start over' });
    assert.equal(body.radical, true);
    const folder = run!.targetFolder;
    // The placeholder, as a new direction starts; no copy of the app's files.
    assert.deepEqual(fs.readdirSync(path.join(repo, ...folder.split('/'))).sort(), [
      '.base',
      'index.tsx'
    ]);
    assert.ok(isPlaceholder(read(repo, `${folder}/index.tsx`)));
    // The base keeps what the app was at the fork, for B4.
    const base = readBase(repo, folder)!;
    assert.equal(base.radical, true);
    assert.deepEqual(
      base.files.map(file => [file.path, file.copy]),
      [['components/pricing/pricing-section.tsx', null]]
    );
    assert.equal(
      read(repo, `${folder}/.base/components/pricing/pricing-section.tsx`),
      read(repo, 'components/pricing/pricing-section.tsx')
    );
    assert.match(
      read(repo, run!.promptFile),
      /Its files:\ncomponents\/pricing\/pricing-section\.tsx\n/
    );
    // Left as the placeholder, it fails as any unwritten slot does.
    const sources = recipeFor('next')!.environment(LINK).sources;
    assert.equal(checkIteration(repo, run!, sources).failure?.code, 'PLACEHOLDER');
  });

  it('a radical fork of a studio iteration starts empty too, with no base', async () => {
    const runs = [{ ...started('iteration-02', RUN_B, PROMPT, CHECKS), parent: 'iteration-01' }];
    const { repo, api } = await adopted(runs);
    write(
      repo,
      'rough/pricing/pricing-section/iteration-01/index.tsx',
      'export default () => null;\n'
    );
    const [run] = await startRuns(repo, api, LINK, {
      ...FORK,
      parent: 'iteration-01',
      radical: true
    });
    assert.deepEqual(fs.readdirSync(path.join(repo, ...run!.targetFolder.split('/'))), [
      'index.tsx'
    ]);
    assert.ok(isPlaceholder(read(repo, `${run!.targetFolder}/index.tsx`)));
  });
});
