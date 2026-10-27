// `roughbook section` and the composition command (ROUGHBOOK-BROWNFIELD-PLAN.md, B6, decisions 46
// to 52): a new section made on the backend from its name, with its folder in rough/; a composition
// checked against the map's order, numbered by the backend, written with the page's files in
// `.base/`, and its composed preview's pictures sent through the outbox. No request carries a path
// or a line of the repo's code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { PictureShot } from '../pictures/share.js';
import { readMap, writeMap } from '../map/file.js';
import { assertCarriesNoRepoContent, ok } from './helpers.js';
import { HOME_SOURCE, ORG, PAGE, TREE, homeApp, read, studio } from './homeApp.js';

describe('roughbook section', () => {
  it('makes the section on the backend from its name, and its folder', async () => {
    const repo = await homeApp();
    const { io, requests, run } = await studio(repo, {
      [`POST ${PAGE}/components`]: () => ok({ slug: 'press-quotes', name: 'Press quotes' }, 201)
    });
    assert.equal(await run(['section', 'home', '--name', 'Press quotes']), 0, io.errors.join('\n'));
    assert.deepEqual(
      requests.map(request => request.body),
      [{ name: 'Press quotes' }]
    );
    assert.ok(fs.statSync(path.join(repo, 'rough/home/press-quotes')).isDirectory());
    assert.deepEqual(io.lines, [
      'Made Press quotes (home/press-quotes), a new section of the page, not in the app yet.',
      '  Its folder: rough/home/press-quotes/',
      '  Its first iteration is a run: roughbook run home/press-quotes',
      '  Then place it: roughbook compose home --sections …,press-quotes:iteration-01,…'
    ]);

    // Refused before any request: no name, a page the map lacks, the compositions' own folder.
    const asked = requests.length;
    assert.equal(await run(['section', 'home']), 1);
    assert.match(io.errors.at(-1)!, /Name the new section/);
    assert.equal(await run(['section', 'about', '--name', 'Logos']), 1);
    assert.match(io.errors.at(-1)!, /rough\/map\.md has no page about/);
    assert.equal(await run(['section', 'home', '--name', 'Compositions']), 1);
    assert.match(io.errors.at(-1)!, /holds the page's compositions/);
    assert.equal(requests.length, asked);
  });
});

describe('saving a composition', () => {
  it('numbers it on the backend, writes it with the page’s base, and sends its pictures', async () => {
    const repo = await homeApp();
    const pictured: string[] = [];
    const takePicture: PictureShot = async ({ url, size, full }) => {
      pictured.push(`${new URL(url).pathname}${new URL(url).search} ${size.width} ${full}`);
      return Buffer.from(`RIFF\0\0\0\0WEBPVP8 ${size.width}`);
    };
    const { io, requests, run } = await studio(
      repo,
      {
        [`POST ${PAGE}/compositions`]: () => ok({ id: 'composition-03', number: 3 }, 201),
        // The new section, by the name it was made with (decision 61).
        [`GET /v1/api/studio/orgs/${ORG}/projects/site`]: () =>
          ok({
            ...TREE,
            pages: [
              {
                ...TREE.pages[0],
                components: [
                  {
                    slug: 'customer-logos',
                    name: 'Customer logos',
                    selectedIteration: null,
                    iterations: []
                  }
                ]
              }
            ]
          }),
        [`PUT ${PAGE}/compositions/composition-03/pictures/thumbnail`]: () =>
          ok({ kind: 'thumbnail', width: 640, height: 400, updatedAt: '' }),
        [`PUT ${PAGE}/compositions/composition-03/pictures/desktop`]: () =>
          ok({ kind: 'desktop', width: 1440, height: 900, updatedAt: '' }),
        [`PUT ${PAGE}/compositions/composition-03/pictures/phone`]: () =>
          ok({ kind: 'phone', width: 390, height: 844, updatedAt: '' })
      },
      { askPreview: async url => ({ status: 200, url }), takePicture }
    );
    assert.equal(
      await run([
        'compose',
        'home',
        '--sections',
        'hero,customer-logos:iteration-01,testimonials,features',
        '--name',
        'Proof first'
      ]),
      0,
      io.errors.join('\n')
    );
    const create = requests.find(request => request.url.endsWith('/compositions'))!;
    assert.deepEqual(create.body, {
      sections: [
        { component: 'hero', iteration: 'iteration-00' },
        { component: 'customer-logos', iteration: 'iteration-01' },
        { component: 'testimonials', iteration: 'iteration-00' },
        { component: 'features', iteration: 'iteration-00' }
      ],
      name: 'Proof first'
    });
    const folder = 'rough/home/compositions/composition-03';
    assert.deepEqual(JSON.parse(read(repo, `${folder}/composition.json`)), {
      name: 'Proof first',
      parent: null,
      sections: create.body && (create.body as { sections: unknown }).sections
    });
    assert.equal(read(repo, `${folder}/.base/app/page.tsx`), HOME_SOURCE);
    assert.deepEqual(
      (
        JSON.parse(read(repo, `${folder}/.base/base.json`)) as { files: { path: string }[] }
      ).files.map(file => file.path),
      ['app/page.tsx']
    );
    assert.deepEqual(io.lines.slice(0, 5), [
      'Saved composition-03 of home, “Proof first”: rough/home/compositions/composition-03/',
      '  1. Hero (the app’s own): kept',
      '  2. Customer logos (iteration-01): added',
      '  3. Testimonials (the app’s own): moved',
      '  4. Features (the app’s own): kept'
    ]);
    // The composed preview, at the 1280 viewport one screen tall, then full length.
    const address =
      '/rough-preview/home?roughbook-compose=hero:iteration-00,customer-logos:iteration-01,testimonials:iteration-00,features:iteration-00';
    assert.deepEqual(pictured, [
      `${address} 1280 false`,
      `${address} 1440 true`,
      `${address} 390 true`
    ]);
    assert.deepEqual(
      requests
        .filter(request => request.method === 'PUT')
        .map(request => new URL(request.url).pathname),
      ['thumbnail', 'desktop', 'phone'].map(
        kind => `${PAGE}/compositions/composition-03/pictures/${kind}`
      )
    );
    assert.ok(io.lines.includes('composition-03: pictures 3 uploaded.'), io.lines.join('\n'));
    assert.equal(
      io.lines.at(-1),
      'Promote it with roughbook promote home --composition composition-03.'
    );
    assertCarriesNoRepoContent(requests, { repo, root: path.dirname(repo), minimumLines: 10 });
  });

  it('refuses what the page cannot be, before asking for a number', async () => {
    const repo = await homeApp();
    const { io, requests, run } = await studio(repo, {});
    assert.equal(await run(['compose', 'home', '--sections', 'hero,hero:iteration-02']), 1);
    assert.match(io.errors.at(-1)!, /hero is in it twice/);
    assert.equal(await run(['compose', 'home', '--sections', 'hero,customer-logos']), 1);
    assert.match(io.errors.at(-1)!, /customer-logos is a new section, not in the app/);
    assert.equal(await run(['compose', 'home', '--sections', 'hero:iteration-04']), 1);
    assert.match(io.errors.at(-1)!, /rough\/home\/hero\/iteration-04 is not in this repo/);
    assert.equal(
      await run(['compose', 'home', '--sections', 'hero', '--parent', 'composition-01']),
      1
    );
    assert.match(
      io.errors.at(-1)!,
      /composition-01 is not one of home's compositions in this repo/
    );
    assert.equal(await run(['compose', 'home']), 1);
    assert.match(io.errors.at(-1)!, /Name the sections in order/);
    assert.equal(requests.length, 0);
  });

  it('refuses a page whose file is gone before asking for a number, leaving nothing numbered', async () => {
    const repo = await homeApp();
    // The map still lists a file of the page that is no longer there.
    const map = readMap(repo)!.map;
    writeMap(repo, {
      ...map,
      pages: map.pages.map(page =>
        page.slug === 'home' ? { ...page, files: [...page.files, 'app/home-extra.tsx'] } : page
      )
    });
    const { io, requests, run } = await studio(repo, {});
    assert.equal(await run(['compose', 'home', '--sections', 'hero,features,testimonials']), 1);
    assert.match(io.errors.at(-1)!, /app\/home-extra\.tsx is not in the repo/);
    assert.ok(!requests.some(request => request.url.endsWith('/compositions')));
  });
});
