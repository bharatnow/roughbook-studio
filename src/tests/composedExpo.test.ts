// The composed preview on Expo (ROUGHBOOK-BROWNFIELD-PLAN.md, B6): the route answers a page's key with
// ?roughbook-compose=… on the web target, each section with its fixture, in order, inside one Preview,
// each in its marker, in one root as tall as they are, with the shared script and Pick, ready once.
// React Native reads the window from JavaScript too, so the page gives it the canvas's device height.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { composedAddress } from '../compositions/save.js';
import { readEnvironment } from '../environment/read.js';
import { writeMap } from '../map/file.js';
import { previewRoute } from '../recipes/expo/preview.js';
import { recipeFor } from '../recipes/index.js';
import { LIVE_FUNCTION } from '../recipes/live.js';
import type { RepoLink } from '../repo/link.js';
import { tempDir } from './helpers.js';

const LINK: RepoLink = {
  version: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  project: 'site',
  roughCommitted: true,
  appDir: 'app'
};

const ROUTE = 'app/rough-preview/[...key].tsx';

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

async function expoApp(mapped: boolean): Promise<string> {
  const repo = await tempDir('roughbook-composed-expo-');
  write(
    repo,
    'package.json',
    '{ "dependencies": { "expo": "58.0.0", "expo-router": "58.0.0" } }\n'
  );
  write(repo, 'app/_layout.tsx', 'export default function Layout() { return null; }\n');
  if (mapped) {
    writeMap(repo, {
      version: 1,
      by: ['expo'],
      pages: [],
      components: [],
      missed: [],
      unplaced: []
    });
  }
  return repo;
}

describe('the composed preview on Expo', () => {
  it('is in a mapped repo’s route: sections in order, in markers, with Pick and one ready', async () => {
    const expo = recipeFor('expo')!;
    assert.equal(expo.composes, true);
    assert.equal(expo.version, 6);
    const repo = await expoApp(true);
    const plan = expo.planPreview(repo, LINK);
    const route = plan.changes.find(change => change.file === ROUTE)?.after ?? '';
    assert.equal(route, previewRoute('app', { compose: true }).content);
    assert.ok(expo.setupFiles(repo, LINK).includes(ROUTE));

    assert.match(route, /const composed = one\("roughbook-compose"\);/);
    assert.match(route, /const id = composed === undefined \? key : `\$\{key\}\/composition`;/);
    assert.match(
      route,
      /"roughbook-section",\n {10}\{ key: section\.key, "data-roughbook-section": section\.marker, style: \{ display: "contents" \} \},/
    );
    // Each section's own fixture, in one Preview, in one measured root.
    assert.match(route, /registry\.fixtures\[section\.key\]\?\.\(\) \?\? \{\}/);
    assert.equal(route.match(/^ +data-roughbook-variant$/gm)?.length, 1);
    assert.match(
      route,
      /<Sections key=\{turn\} sections=\{sections\} \/>\n\s+<Ready id=\{id\} \/>/
    );
    // A missing section answers as a missing iteration does, under the composition's id.
    assert.match(route, /There is no iteration \$\{gone\.key\} in this repo\./);
    assert.match(route, /if \(why\) return <Missing id=\{id\} why=\{why\} \/>;/);
    // On loopback, on the client: the composition is after both.
    const branch = route.indexOf('if (composed !== undefined)');
    assert.ok(branch > route.indexOf('if (!mounted) return null;'));
    assert.ok(route.indexOf('if (!mounted) return null;') > route.indexOf('LOOPBACK.test('));
    // The shared script, once, and Pick.
    assert.ok(route.includes(`const live = ${LIVE_FUNCTION};`));
    assert.equal(route.match(/useLayoutEffect\(live, \[\]\)/g)?.length, 1);
    assert.match(route, /postMessage\(\{ roughbook: "section", key \}, "\*"\)/);
    // Nothing in the route's folder but the route: every file there would be a route of its own.
    assert.deepEqual(
      plan.changes.filter(change => change.file.startsWith('app/rough-preview/')).length,
      1
    );
  });

  it('gives the sections the device’s height, for Dimensions, useWindowDimensions and flex: 1', () => {
    const route = previewRoute('app', { compose: true }).content;
    assert.match(
      route,
      /Object\.defineProperty\(visual, "height", \{ configurable: true, get: \(\) => told \}\);\n\s+visual\.dispatchEvent\(new Event\("resize"\)\);/
    );
    assert.match(route, /display: "flex", flexDirection: "column", minHeight: height/);
    // Only where the height is new do the sections mount again.
    assert.match(route, /turn: now\.turn \+ \(changed \? 1 : 0\)/);
    assert.match(route, /Reflect\.deleteProperty\(visual, "height"\)/);
  });

  it('leaves a repo that maps nothing with the route it had', async () => {
    const expo = recipeFor('expo')!;
    const repo = await expoApp(false);
    const route = expo.planPreview(repo, LINK).changes.find(change => change.file === ROUTE);
    assert.equal(route?.after, previewRoute('app').content);
    assert.ok(!route?.after?.includes('roughbook-compose'));
    assert.ok(!route?.after?.includes('roughbook-variant'));
  });

  it('leaves a mapped repo with the route it had to setup --upgrade', async () => {
    const expo = recipeFor('expo')!;
    const repo = await expoApp(true);
    const plain = previewRoute('app');
    write(repo, plain.file, plain.content);
    assert.ok(expo.contextPreview!.missing(repo, LINK).includes(ROUTE));
    const composed = previewRoute('app', { compose: true });
    write(repo, composed.file, composed.content);
    assert.ok(!expo.contextPreview!.missing(repo, LINK).includes(ROUTE));
  });

  it('gives the composed address at the page’s key', async () => {
    const repo = await expoApp(true);
    const environment = await readEnvironment(repo, { ...LINK, recipe: 'expo' } as RepoLink);
    assert.equal(
      composedAddress(
        { ...environment, recipe: 'expo', mode: 'live', preview: '/rough-preview/{key}' },
        'home',
        [
          { component: 'hero', iteration: 'iteration-01' },
          { component: 'footer', iteration: 'iteration-01' }
        ]
      ),
      '/rough-preview/home?roughbook-compose=hero:iteration-01,footer:iteration-01'
    );
  });
});
