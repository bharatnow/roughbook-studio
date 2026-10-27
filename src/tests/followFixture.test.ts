// A baseline written with a fixture follows its component too (review finding 14): a Blade
// component's pointer passes the fixture's keys as attributes, so the pointer the studio wrote is
// the one made with the folder's own fixture, not without one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { GONE_LINE, followBaselines } from '../map/follow.js';
import type { MapComponent } from '../map/types.js';
import { recipeFor } from '../recipes/index.js';
import { bladePointer } from '../recipes/laravel/index.js';
import { tempDir } from './helpers.js';

const laravel = recipeFor('laravel')!;
const ENTRY = 'index.blade.php';
const FOLDER = 'rough/home/pricing/iteration-00';
const FIXTURE = '{ "plans": ["Free", "Pro"], "title": "Pricing" }\n';

const component = (exported: string, file: string): MapComponent => ({
  slug: 'pricing',
  name: 'Pricing',
  kind: 'section',
  files: [file],
  export: exported,
  fixture: null,
  alone: 'unknown',
  why: null,
  byAgent: false
});
const before = component('x-pricing', 'resources/views/components/pricing.blade.php');
const now = component('x-plans', 'resources/views/components/plans.blade.php');

async function repo(): Promise<string> {
  const root = await tempDir('roughbook-follow-fixture-');
  for (const [file, text] of Object.entries(bladePointer(before, { fixture: FIXTURE })!)) {
    fs.mkdirSync(path.join(root, ...FOLDER.split('/')), { recursive: true });
    fs.writeFileSync(path.join(root, ...`${FOLDER}/${file}`.split('/')), text);
  }
  return root;
}

const entryOf = (root: string) =>
  fs.readFileSync(path.join(root, ...`${FOLDER}/${ENTRY}`.split('/')), 'utf8');

describe('a baseline written with a fixture', () => {
  it('follows its Blade component’s rename, its fixture’s keys kept as attributes', async () => {
    const root = await repo();
    assert.match(entryOf(root), /component="pricing" :plans="\$plans" :title="\$title"/);
    const followed = followBaselines(root, laravel, ENTRY, {
      renamed: [{ before, now }],
      went: [],
      returned: []
    });
    assert.deepEqual(followed, { written: [`${FOLDER}/${ENTRY}`], left: [] });
    assert.equal(entryOf(root), bladePointer(now, { fixture: FIXTURE })![ENTRY]);
  });

  it('becomes the gone placeholder when its component leaves the app, and comes back', async () => {
    const root = await repo();
    const gone = followBaselines(root, laravel, ENTRY, {
      renamed: [],
      went: [before],
      returned: []
    });
    assert.deepEqual(gone.left, []);
    assert.ok(entryOf(root).includes(GONE_LINE));
    followBaselines(root, laravel, ENTRY, { renamed: [], went: [], returned: [before] });
    assert.equal(entryOf(root), bladePointer(before, { fixture: FIXTURE })![ENTRY]);
  });
});
