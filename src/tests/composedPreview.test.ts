// The composed preview (ROUGHBOOK-BROWNFIELD-PLAN.md, B6, decisions 46 and 54): on Next.js the
// preview route also answers a page's key with ?roughbook-compose=…, rendering each section with
// its fixture, in order, inside one Preview, each in the in-page view's marker, with Pick, ready
// once all have rendered. Only a mapped repo's route has it; a repo that maps nothing keeps the
// route it had, and a recipe that does not compose gives no address.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { composedAddress } from '../compositions/save.js';
import { readEnvironment } from '../environment/read.js';
import { writeMap } from '../map/file.js';
import { recipeFor } from '../recipes/index.js';
import { previewRouteFiles } from '../recipes/next/preview.js';
import type { RepoLink } from '../repo/link.js';
import { tempDir } from './helpers.js';

const LINK: RepoLink = {
  version: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  project: 'site',
  roughCommitted: true,
  appDir: 'app'
};

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

async function nextApp(mapped: boolean): Promise<string> {
  const repo = await tempDir('roughbook-composed-');
  write(repo, 'package.json', '{ "dependencies": { "next": "16.0.0" } }\n');
  write(repo, 'app/page.tsx', 'export default function Home() { return null; }\n');
  write(repo, 'next.config.ts', 'const nextConfig = {};\nexport default nextConfig;\n');
  if (mapped) {
    writeMap(repo, {
      version: 1,
      by: ['next'],
      pages: [],
      components: [],
      missed: [],
      unplaced: []
    });
  }
  return repo;
}

describe('the composed preview on Next.js', () => {
  it('is in a mapped repo’s route: sections in order, in markers, with Pick and one ready', async () => {
    const next = recipeFor('next')!;
    assert.equal(next.composes, true);
    assert.equal(next.version, 8);
    const repo = await nextApp(true);
    const routes = next.planPreview(repo, LINK).changes.map(change => change.file);
    assert.ok(routes.includes('app/rough-preview/[...slug]/pick.tsx'), routes.join(', '));
    assert.ok(next.setupFiles(repo, LINK).includes('app/rough-preview/[...slug]/pick.tsx'));

    const [page, , error, notFound, pick] = previewRouteFiles('app', { compose: true });
    const route = page!.content;
    assert.match(route, /const composed = search\["roughbook-compose"\];/);
    assert.match(route, /<Preview>\n {10}\{sections\.map\(\(section\) =>/);
    assert.match(
      route,
      /createElement\(\n {14}"roughbook-section",\n {14}\{ key: section\.key, "data-roughbook-section": section\.marker, style: \{ display: "contents" \} \},\n {14}createElement\(section\.Section, section\.fixture\),/
    );
    // Each section's own fixture, and a section the registry lacks is a 404, as an iteration is.
    assert.match(
      route,
      /fixture: registry\.fixtures\[key\] \? \(await registry\.fixtures\[key\]\(\)\)\.default : \{\}/
    );
    assert.match(route, /if \(!load\) notFound\(\);\n {6}return \{/);
    // On loopback and in development only, as the route always was: the composition is after both.
    assert.ok(route.indexOf('roughbook-compose') > route.indexOf('if (!registry) notFound();'));
    assert.ok(
      route.indexOf('if (!registry) notFound();') > route.indexOf('.test(host)) notFound();')
    );
    // Ready once, after every section, under the composition's own id.
    assert.match(
      route,
      /<\/Preview>\n {8}<Pick \/>\n {8}<Ready id=\{`\$\{page\}\/composition`\} \/>/
    );
    assert.match(error!.content, /\.has\("roughbook-compose"\) \? "\/composition" : ""/);
    assert.match(notFound!.content, /\.has\("roughbook-compose"\) \? "\/composition" : ""/);
    assert.equal(pick!.file, 'app/rough-preview/[...slug]/pick.tsx');
    assert.match(pick!.content, /^"use client";\n\/\/ Roughbook preview route\./);
    assert.match(pick!.content, /postMessage\(\{ roughbook: "section", key \}, "\*"\)/);
  });

  it('leaves a mapped repo with the route it had to setup --upgrade, as the switch is', async () => {
    const next = recipeFor('next')!;
    const repo = await nextApp(true);
    for (const route of previewRouteFiles('app')) write(repo, route.file, route.content);
    const route = (file: string) => `app/rough-preview/[...slug]/${file}`;
    const pending = next.contextPreview!.missing(repo, LINK);
    for (const file of ['page.tsx', 'error.tsx', 'not-found.tsx', 'pick.tsx']) {
      assert.ok(pending.includes(route(file)), `${file}: ${pending.join(', ')}`);
    }
    assert.ok(!pending.includes(route('ready.tsx')));
    for (const item of previewRouteFiles('app', { compose: true })) {
      write(repo, item.file, item.content);
    }
    assert.ok(!next.contextPreview!.missing(repo, LINK).some(file => file.includes('[...slug]')));
  });

  it('leaves a repo that maps nothing with the route it had', async () => {
    const next = recipeFor('next')!;
    const repo = await nextApp(false);
    const files = next.planPreview(repo, LINK).changes.map(change => change.file);
    assert.ok(!files.some(file => file.endsWith('pick.tsx')));
    const [page, , error] = previewRouteFiles('app');
    assert.ok(!page!.content.includes('roughbook-compose'));
    assert.ok(!error!.content.includes('roughbook-compose'));
    assert.equal(previewRouteFiles('app').length, 4);
  });

  it('gives the composed address only where the recipe composes, in live mode', async () => {
    const sections = [
      { component: 'hero', iteration: 'iteration-00' },
      { component: 'logos', iteration: 'iteration-01' }
    ];
    const repo = await nextApp(true);
    const environment = await readEnvironment(repo, LINK);
    assert.equal(
      composedAddress(environment, 'home', sections),
      '/rough-preview/home?roughbook-compose=hero:iteration-00,logos:iteration-01'
    );
    assert.equal(composedAddress({ ...environment, recipe: 'vite' }, 'home', sections), null);
    assert.equal(composedAddress({ ...environment, mode: 'snapshot' }, 'home', sections), null);
    assert.equal(composedAddress({ ...environment, recipe: null }, 'home', sections), null);
  });
});
