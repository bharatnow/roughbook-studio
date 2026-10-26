// B5's gaps, fixed first in B5b (ROUGHBOOK-BROWNFIELD-PLAN.md, decision 45): applying a recipe's
// setup writes the switch's generated files, so the switch works without another command; an
// iteration that does not compile stays out of the page's graph, so only the swap that asks for it
// fails; map-context checks a switch the setup run built, by its sentinel roughbook-swap; and the
// conformance runner runs every fixture it is given.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { contextCheck } from '../doctor/context.js';
import type { DoctorTools } from '../doctor/types.js';
import { defaultEnvironment } from '../environment/read.js';
import { writeMap } from '../map/file.js';
import type { MapComponent, MapPage } from '../map/types.js';
import { SWAP_PARAM, contextSwitch } from '../recipes/context.js';
import { recipeFor } from '../recipes/index.js';
import { CONTEXT_LIST } from '../recipes/laravel/context.js';
import { CONTEXT_MODULES, CONTEXT_REGISTRY, writeContext } from '../recipes/next/context.js';
import { applyPrep, planPrep } from '../repo/prep.js';
import { tempDir } from './helpers.js';

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const next = recipeFor('next')!;
const laravel = recipeFor('laravel')!;
const LINK = { version: 1 as const, orgId: 'org-1', project: 'site', roughCommitted: true };

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

const page = (slug: string, address: string | null, sections: string[]): MapPage => ({
  slug,
  name: slug,
  address,
  example: null,
  signIn: 'no',
  files: [],
  sections,
  byAgent: false
});
const component = (slug: string, file: string, exported: string): MapComponent => ({
  slug,
  name: slug,
  kind: 'section',
  files: [file],
  export: exported,
  fixture: null,
  alone: 'unknown',
  why: null,
  byAgent: false
});

const PRICING = `export function PricingSection({ plans }: { plans: string[] }) {
  return <section>{plans.join(", ")}</section>;
}
`;

/** A mapped Next.js repo with the pricing section adopted and one iteration of it. */
async function nextRepo(): Promise<string> {
  const repo = await tempDir('roughbook-context-gaps-');
  writeMap(repo, {
    version: 1,
    by: ['next'],
    pages: [page('pricing', '/pricing', ['pricing-section'])],
    components: [
      component('pricing-section', 'components/pricing/pricing-section.tsx', 'PricingSection')
    ],
    missed: [],
    unplaced: []
  });
  write(repo, 'app/layout.tsx', 'export default function Layout() { return null; }\n');
  write(repo, 'tsconfig.json', '{}\n');
  write(
    repo,
    'next.config.ts',
    'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n'
  );
  write(repo, 'components/pricing/pricing-section.tsx', PRICING);
  write(
    repo,
    'rough/pricing/pricing-section/iteration-00/index.tsx',
    'export { PricingSection as default } from "../../../../components/pricing/pricing-section";\n'
  );
  write(
    repo,
    'rough/pricing/pricing-section/iteration-01/index.tsx',
    'import { PricingSection } from "../../../../components/pricing/pricing-section";\n\nexport default function Fork(props: { plans: string[] }) {\n  return <div className="fork"><PricingSection {...props} /></div>;\n}\n'
  );
  return repo;
}

describe('applying a recipe’s setup writes the switch’s generated files', () => {
  it('init and setup --upgrade leave the Next.js switch working without roughbook start', async () => {
    const repo = await nextRepo();
    const plan = planPrep(repo, { link: LINK, recipe: next });
    assert.ok(!plan.changes.some(change => change.file === CONTEXT_REGISTRY));
    applyPrep(plan);
    assert.deepEqual(JSON.parse(read(repo, CONTEXT_MODULES)), {
      'components/pricing/pricing-section.tsx': 'PricingSection'
    });
    assert.match(
      read(repo, CONTEXT_REGISTRY),
      /"pricing\/pricing-section\/iteration-01": \(\) => import\("\.\/pricing\/pricing-section\/iteration-01\/index"\)/
    );
  });

  it('does the same for Laravel’s list of adopted views', async () => {
    const repo = await tempDir('roughbook-context-gaps-');
    writeMap(repo, {
      version: 1,
      by: ['laravel'],
      pages: [page('pricing', '/pricing', ['pricing'])],
      components: [
        component('pricing', 'resources/views/sections/pricing.blade.php', 'view sections.pricing')
      ],
      missed: [],
      unplaced: []
    });
    write(repo, 'routes/web.php', '<?php\n');
    for (const key of ['iteration-00', 'iteration-01']) {
      write(repo, `rough/pricing/pricing/${key}/index.blade.php`, '<p>x</p>\n');
    }
    applyPrep(planPrep(repo, { link: LINK, recipe: laravel }));
    assert.ok(read(repo, CONTEXT_LIST).includes('pricing/pricing/iteration-01'));
  });
});

describe('an iteration that does not compile', () => {
  it('is left out of the page’s graph: its swap fails with the reason, the rest are imported', async () => {
    const repo = await nextRepo();
    write(
      repo,
      'rough/pricing/pricing-section/iteration-02/index.tsx',
      'export default function Broken() {\n  return <section>broken <<<</section\n}\n'
    );
    write(
      repo,
      'rough/pricing/pricing-section/iteration-03/index.tsx',
      'import { Missing } from "./missing";\n\nexport default function Lost() {\n  return <Missing />;\n}\n'
    );
    writeContext(repo);
    const registry = read(repo, CONTEXT_REGISTRY);
    assert.match(
      registry,
      /"pricing\/pricing-section\/iteration-01": \(\) => import\("\.\/pricing\/pricing-section\/iteration-01\/index"\)/
    );
    assert.ok(!registry.includes('import("./pricing/pricing-section/iteration-02'), registry);
    assert.ok(!registry.includes('import("./pricing/pricing-section/iteration-03'), registry);
    assert.match(
      registry,
      /"pricing\/pricing-section\/iteration-02": \(\) => Promise\.reject\(new Error\("pricing\/pricing-section\/iteration-02 does not compile: index\.tsx:2:\d+ Expected identifier but found \\"<\\""\)\)/
    );
    assert.match(
      registry,
      /"pricing\/pricing-section\/iteration-03": \(\) => Promise\.reject\(new Error\("pricing\/pricing-section\/iteration-03 does not compile: index\.tsx:1:\d+ Could not resolve \\"\.\/missing\\""\)\)/
    );

    // Fixed, it is imported again on the next sync, as roughbook start syncs every few seconds.
    write(
      repo,
      'rough/pricing/pricing-section/iteration-02/index.tsx',
      'export default function Fixed() {\n  return <section>fixed, and a little longer than before</section>;\n}\n'
    );
    writeContext(repo);
    assert.match(
      read(repo, CONTEXT_REGISTRY),
      /"pricing\/pricing-section\/iteration-02": \(\) => import\("\.\/pricing\/pricing-section\/iteration-02\/index"\)/
    );
  });
});

describe('map-context on a setup the setup run built', () => {
  it('checks the agent’s switch by the shared words, with roughbook-swap as its sentinel', async () => {
    const hook = contextSwitch(null)!;
    assert.equal(hook.sentinel, SWAP_PARAM);
    assert.equal(hook.sentinel, 'roughbook-swap');
    assert.equal(
      hook.address('/pricing?plan=team', 'pricing/pricing-section/iteration-01', { pick: true }),
      '/pricing?plan=team&roughbook-swap=pricing/pricing-section/iteration-01&roughbook-pick=1'
    );
    assert.equal(contextSwitch(recipeFor('next')), recipeFor('next')!.contextPreview);
    // A recipe with no switch of its own still shows components alone.
    assert.equal(contextSwitch(recipeFor('shopify')), null);

    const repo = await nextRepo();
    const asked: string[] = [];
    const fake = {
      browser: null,
      now: (() => {
        let clock = 0;
        return () => (clock += 60_000);
      })(),
      sleep: async () => {},
      fetch: (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        asked.push(`${url.pathname}${url.search}`);
        const swap = url.searchParams.get('roughbook-swap');
        return new Response(
          `<main><roughbook-section data-roughbook-section="pricing/pricing-section"${swap ? ` data-roughbook-swap="${swap}"` : ''} style="display:contents"></roughbook-section></main>`
        );
      }) as typeof fetch
    } as Partial<DoctorTools> as DoctorTools;
    const found = await contextCheck({
      repoRoot: repo,
      environment: { ...defaultEnvironment(), recipe: null, entry: 'index.tsx' },
      recipe: null,
      tools: fake,
      base: 'http://localhost:3000',
      shotsDir: repo,
      gate: { leaked: ['dist/app.js'], where: 'the production build' },
      link: null
    });
    assert.equal(found.status, 'fail');
    assert.match(found.detail, /the production build holds the switch: dist\/app\.js/);
    assert.match(found.detail, /1 of 1 iteration of 1 adopted section shown in its page/);
    assert.ok(asked.includes('/pricing?roughbook-swap=pricing/pricing-section/iteration-01'));
  });
});

describe('the conformance runner', () => {
  it('runs every fixture it is given, one after the other', () => {
    const ran = spawnSync(
      process.execPath,
      [path.join(studioRoot, 'conformance', 'run.mjs'), 'no-such-a', 'no-such-b', '--skip-build'],
      { cwd: studioRoot, encoding: 'utf8' }
    );
    assert.equal(ran.status, 2);
    assert.match(ran.stderr, /No fixture named no-such-a/);
    assert.match(ran.stderr, /No fixture named no-such-b/);
    assert.match(ran.stdout, /no-such-a: unverified \(exit 2, \d+ s\)/);
    assert.match(ran.stdout, /no-such-b: unverified \(exit 2, \d+ s\)/);
  });
});
