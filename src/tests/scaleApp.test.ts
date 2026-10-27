// The scale app's generator (decision 60 of ROUGHBOOK-BROWNFIELD-PLAN.md): the same seed gives the
// same app, of the size asked, which the Next.js discoverer maps as it is planned. Small here; the
// budgets on the full size are `npm run scale-budget`.
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEnvironment } from '../environment/read.js';
import { mapRepo } from '../map/run.js';
import { tempDir } from './helpers.js';
import { LINK, write } from './homeApp.js';

type Plan = {
  atoms: string[];
  pages: { slug: string; address: string; sections: { name: string; file: string }[] }[];
  sections: unknown[];
};
type Generator = {
  plan(options: object): Plan;
  files(options: object): Record<string, string>;
  writeApp(dir: string, options: object): Plan;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const generator = (await import(
  pathToFileURL(path.join(here, '..', '..', 'conformance', 'scale', 'generate.mjs')).href
)) as Generator;

describe('the scale app', () => {
  it('is the same app for the same seed, and another for another', () => {
    const options = { seed: 7, components: 120, pages: 12 };
    assert.deepEqual(generator.files(options), generator.files(options));
    assert.notDeepEqual(generator.files(options), generator.files({ ...options, seed: 8 }));
  });

  it('has the components and pages asked for, about ten sections a page', () => {
    const plan = generator.plan({});
    assert.equal(plan.atoms.length + 2 + plan.sections.length, 1000);
    assert.equal(plan.pages.length, 100);
    assert.equal(new Set(plan.pages.map(page => page.address)).size, 100);
    for (const page of plan.pages) {
      assert.ok(page.sections.length >= 6 && page.sections.length <= 15, page.slug);
    }
    const files = generator.files({});
    assert.equal(Object.keys(files).filter(file => file.startsWith('components/')).length, 1000);
  });

  it('is mapped as it was planned', async () => {
    const repo = path.join(await tempDir('roughbook-scale-'), 'app');
    const options = { seed: 3, components: 80, pages: 8 };
    const plan = generator.writeApp(repo, options);
    write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
    const environment = await readEnvironment(repo, LINK);
    const { map } = (await mapRepo(repo, environment, LINK))!;
    assert.equal(map.components.length, 80);
    assert.equal(map.components.filter(item => item.kind === 'shared').length, 2);
    assert.equal(map.components.filter(item => item.kind === 'atom').length, plan.atoms.length);
    // Every page, and Shared.
    assert.equal(map.pages.length, 9);
    const home = map.pages.find(page => page.address === '/')!;
    const planned = plan.pages.find(page => page.address === '/')!;
    assert.deepEqual(
      home.sections.map(slug => map.components.find(item => item.slug === slug)!.files[0]),
      planned.sections.map(section => section.file)
    );
  });
});
