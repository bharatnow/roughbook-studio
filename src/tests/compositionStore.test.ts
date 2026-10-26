// A page's compositions in rough/ (ROUGHBOOK-BROWNFIELD-PLAN.md, B6, decision 51): composition.json
// and `.base/` with the page's files in decision 31's format, never changed once saved; `.base/`
// left out of the run snapshot, the watcher and the pictures, as an iteration's is.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  compositionDir,
  listCompositions,
  missingSections,
  readComposition,
  readPageBase,
  writeComposition
} from '../compositions/store.js';
import type { MapPage } from '../map/types.js';
import { listIterations } from '../repo/iterations.js';
import { sha256 } from '../runs/base.js';
import { listRepoFiles } from '../runs/snapshot.js';
import { watchedPath } from '../runs/watch.js';
import { tempDir } from './helpers.js';

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

const PAGE_SOURCE =
  'import Hero from "@/components/hero";\r\nexport default function Home() {\r\n  return <Hero />;\r\n}\r\n';

const HOME: MapPage = {
  slug: 'home',
  name: 'Home',
  address: '/',
  example: '/',
  signIn: 'no',
  files: ['app/page.tsx'],
  sections: ['hero', 'pricing'],
  byAgent: false
};

describe("a page's compositions in rough/", () => {
  it('keeps composition.json and the page’s files in .base/, byte for byte', async () => {
    const repo = await tempDir();
    write(repo, 'app/page.tsx', PAGE_SOURCE);
    const composition = {
      name: 'Testimonials first',
      parent: null,
      sections: [
        { component: 'pricing', iteration: 'iteration-02' },
        { component: 'hero', iteration: 'iteration-00' }
      ]
    };
    const base = await writeComposition(repo, HOME, 'composition-01', composition, 'abc1234');
    const dir = compositionDir('home', 'composition-01');
    assert.equal(dir, 'rough/home/compositions/composition-01');
    assert.deepEqual(JSON.parse(read(repo, `${dir}/composition.json`)), composition);
    assert.ok(read(repo, `${dir}/composition.json`).endsWith('}\n'));
    assert.equal(read(repo, `${dir}/.base/app/page.tsx`), PAGE_SOURCE);
    assert.deepEqual(base, {
      version: 1,
      page: 'home',
      commit: 'abc1234',
      files: [{ path: 'app/page.tsx', sha256: sha256(PAGE_SOURCE), copy: null }]
    });
    assert.deepEqual(readPageBase(repo, 'home', 'composition-01'), base);
    assert.deepEqual(readComposition(repo, 'home', 'composition-01'), {
      page: 'home',
      id: 'composition-01',
      number: 1,
      composition
    });

    // Never changed once saved.
    await assert.rejects(
      writeComposition(repo, HOME, 'composition-01', composition, null),
      /already in this repo, and a composition never changes once saved/
    );
    await writeComposition(
      repo,
      HOME,
      'composition-02',
      { ...composition, parent: 'composition-01' },
      null
    );
    assert.deepEqual(
      listCompositions(repo).map(item => [item.page, item.id, item.composition.parent]),
      [
        ['home', 'composition-01', null],
        ['home', 'composition-02', 'composition-01']
      ]
    );
    assert.deepEqual(listCompositions(repo, 'about'), []);
    // Not an iteration of a component named compositions.
    assert.deepEqual(listIterations(repo, 'index.tsx'), []);
  });

  it('refuses a page whose file is gone, writing nothing', async () => {
    const repo = await tempDir();
    await assert.rejects(
      writeComposition(
        repo,
        HOME,
        'composition-01',
        { name: '', parent: null, sections: [] },
        null
      ),
      /app\/page\.tsx is not in the repo, so the Home page cannot be kept with its composition/
    );
    assert.equal(fs.existsSync(path.join(repo, 'rough')), false);
  });

  it('reads nothing that is not a composition', async () => {
    const repo = await tempDir();
    write(repo, 'rough/home/compositions/composition-01/composition.json', '{"name": 1}');
    write(repo, 'rough/home/compositions/notes/composition.json', '{}');
    write(
      repo,
      'rough/home/compositions/composition-03/composition.json',
      JSON.stringify({
        name: 'x',
        parent: null,
        sections: [{ component: '../x', iteration: 'iteration-01' }]
      })
    );
    assert.deepEqual(listCompositions(repo, 'home'), []);
    assert.equal(readComposition(repo, '../home', 'composition-01'), null);
  });

  it('says which sections this repo cannot show', async () => {
    const repo = await tempDir();
    write(repo, 'rough/home/hero/iteration-00/index.tsx', 'export {};');
    write(repo, 'rough/home/banner/iteration-01/index.tsx', 'export {};');
    write(repo, 'rough/home/banner/iteration-02/notes.md', 'no entry yet');
    write(repo, 'rough/home/compositions/composition-01/composition.json', '{}');
    assert.deepEqual(
      missingSections(repo, 'index.tsx', 'home', [
        { component: 'hero', iteration: 'iteration-00' },
        { component: 'pricing', iteration: 'iteration-00' },
        { component: 'banner', iteration: 'iteration-02' }
      ]),
      [
        'rough/home/pricing/iteration-00 is not in this repo, so pricing cannot show on its baseline: adopt it first (roughbook adopt home/pricing).',
        'rough/home/banner/iteration-02 is not in this repo, or has no index.tsx.'
      ]
    );
  });

  it('leaves .base/ out of the run snapshot and the watcher', async () => {
    const repo = await tempDir();
    write(repo, 'app/page.tsx', PAGE_SOURCE);
    await writeComposition(
      repo,
      HOME,
      'composition-01',
      { name: 'One', parent: null, sections: [{ component: 'hero', iteration: 'iteration-00' }] },
      null
    );
    const { files } = await listRepoFiles(repo, []);
    assert.ok(files.includes('rough/home/compositions/composition-01/composition.json'));
    assert.ok(!files.some(file => file.includes('/.base/')), files.join(', '));
    assert.equal(
      watchedPath('rough/home/compositions/composition-01/.base/app/page.tsx', []),
      null
    );
  });
});
