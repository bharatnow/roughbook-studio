import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  FACT_STACKS,
  factStackOf,
  factStackWhy,
  findLocal,
  readSectionFiles,
  spliceLocal,
  type FactContext,
  type FactEdit
} from './index.js';

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

const studioTypeScript = createRequire(import.meta.url).resolve('typescript');

function write(repo: string, relative: string, content: string | Buffer): void {
  const file = path.join(repo, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const PHOTO = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);

const HERO = `export default function Hero() {
  return (
    <section className="hero grid-cols-2">
      <h1>Physio in Fernside</h1>
      <p>Northside opens Friday 08:00 to 19:00, and Saturdays too.</p>
      <img src="./photo.png" alt="The Northside front desk" />
    </section>
  );
}
`;

// A .jsx section: read as TSX, its places named by its own file.
const HOURS = `const rows = [
  { day: 'Monday', time: 'Monday 08:00 to 20:00' },
  { day: 'Friday', time: 'Friday 08:00 to 19:00' }
];

export default function Hours() {
  return (
    <div>
      {rows.map(row => <p key={row.day}>{row.time}</p>)}
      <p>Late opening until 19:00.</p>
    </div>
  );
}
`;

/**
 * A client repo with the studio's own TypeScript in its node_modules (a package that re-exports
 * it, so no network), and two pages: home's hero states the fact in full; Northside's hours,
 * kept, state it in a data row and say a bare 19:00 elsewhere.
 */
function fixtureRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-facts-'));
  temps.push(repo);
  write(repo, 'package.json', '{"name":"client"}\n');
  write(repo, 'node_modules/typescript/package.json', '{"name":"typescript","main":"index.js"}\n');
  write(
    repo,
    'node_modules/typescript/index.js',
    `module.exports = require(${JSON.stringify(studioTypeScript)});\n`
  );
  write(repo, 'rough/home/hero/iteration-01/index.tsx', HERO);
  write(repo, 'rough/home/hero/iteration-01/photo.png', PHOTO);
  write(repo, 'rough/home/hero/iteration-01/content.json', '{"note": "Book online any time"}\n');
  // The kept base holds the app's originals: never read as the iteration's words.
  write(
    repo,
    'rough/home/hero/iteration-01/.base/src/Hero.tsx',
    'export const Old = () => <p>Friday 08:00 to 19:00</p>;\n'
  );
  write(repo, 'rough/northside/hours/iteration-03/index.jsx', HOURS);
  return repo;
}

const context: FactContext = {
  pages: [
    {
      slug: 'home',
      name: 'Home',
      kind: 'page',
      sections: [{ component: 'hero', name: 'Hero', iteration: 'iteration-01', kept: false }]
    },
    {
      slug: 'northside',
      name: 'Northside',
      kind: 'page',
      sections: [
        { component: 'hours', name: 'Hours', iteration: 'iteration-03', kept: true },
        // Picked on the web, never pulled here.
        { component: 'map', name: 'Map', iteration: 'iteration-02', kept: false }
      ]
    }
  ],
  siteMap: { nav: [{ label: 'Northside', page: 'northside' }], links: [] },
  plan: null,
  script: null
};

const edits: FactEdit[] = [
  {
    kind: 'set',
    subject: "Northside's Friday hours",
    old: 'Friday 08:00 to 19:00',
    new: 'Friday 08:00 to 18:00'
  }
];

describe('reading a section’s files', () => {
  it('reads code and data, not the kept base or assets', () => {
    const repo = fixtureRepo();
    const files = readSectionFiles(repo, 'home', 'hero', 'iteration-01');
    assert.deepEqual(
      files.map(file => file.path),
      ['content.json', 'index.tsx']
    );
    assert.equal(files[1]!.encoding, 'utf8');
    assert.equal(files[1]!.content, HERO);
    assert.deepEqual(readSectionFiles(repo, 'home', 'hero', 'iteration-09'), []);
    assert.deepEqual(readSectionFiles(repo, '../x', 'hero', 'iteration-01'), []);
  });
});

describe('finding places locally', () => {
  it('finds a sure place, an unsure one, and marks the kept section', async () => {
    const repo = fixtureRepo();
    const found = await findLocal(repo, context, edits);
    assert.ok(found.ok, !found.ok ? found.why : '');
    const lines = found.places.map(place => ({
      page: place.page,
      section: place.section,
      file: place.file,
      before: place.before,
      after: place.after,
      sure: place.sure,
      kept: place.kept
    }));
    assert.deepEqual(lines, [
      {
        page: 'home',
        section: 'hero',
        file: 'index.tsx',
        before: 'Northside opens Friday 08:00 to 19:00, and Saturdays too.',
        after: 'Northside opens Friday 08:00 to 18:00, and Saturdays too.',
        sure: true,
        kept: false
      },
      {
        page: 'northside',
        section: 'hours',
        file: 'index.jsx',
        before: 'Friday 08:00 to 19:00',
        after: 'Friday 08:00 to 18:00',
        sure: true,
        kept: true
      },
      {
        page: 'northside',
        section: 'hours',
        file: 'index.jsx',
        before: 'Late opening until 19:00.',
        after: 'Late opening until 18:00.',
        sure: false,
        kept: true
      }
    ]);
    // A .jsx place is named by its own file, ids included.
    for (const place of found.places.filter(item => item.page === 'northside')) {
      assert.match(place.placeId, /^northside\/hours\/index\.jsx:\d+$/);
      assert.equal(place.id, `${place.placeId}|0`);
    }
    assert.deepEqual(found.pages, [
      { slug: 'home', name: 'Home' },
      { slug: 'northside', name: 'Northside' }
    ]);
    assert.deepEqual(found.missing, ['northside/map/iteration-02']);
  });
});

describe('swapping places locally', () => {
  it('writes the change as a new iteration and leaves the old one as it was', async () => {
    const repo = fixtureRepo();
    const found = await findLocal(repo, context, edits);
    assert.ok(found.ok);
    const sure = found.places.filter(place => place.sure && place.section === 'hero');
    const gone = { ...sure[0]!, id: 'home/hero/index.tsx:0|9', old: 'Saturday 10:00', new: 'x' };
    const result = await spliceLocal(repo, 'home', 'hero', 'iteration-01', 'iteration-02', [
      ...sure,
      gone,
      // Another section's place is not this call's.
      ...found.places.filter(place => place.section === 'hours')
    ]);
    assert.deepEqual(result, {
      ok: true,
      files: ['rough/home/hero/iteration-02/index.tsx'],
      leftOver: ['home/hero/index.tsx:0|9']
    });
    const next = (file: string) => path.join(repo, 'rough', 'home', 'hero', 'iteration-02', file);
    assert.equal(fs.readFileSync(next('index.tsx'), 'utf8'), HERO.replace('19:00', '18:00'));
    // Copied as a fork copies: assets and the kept base too.
    assert.deepEqual(fs.readFileSync(next('photo.png')), PHOTO);
    assert.ok(fs.existsSync(next('.base/src/Hero.tsx')));
    assert.ok(fs.existsSync(next('content.json')));
    // The pick is untouched.
    const old = path.join(repo, 'rough', 'home', 'hero', 'iteration-01', 'index.tsx');
    assert.equal(fs.readFileSync(old, 'utf8'), HERO);
  });

  it('splices a .jsx section under its own name', async () => {
    const repo = fixtureRepo();
    const found = await findLocal(repo, context, edits);
    assert.ok(found.ok);
    const sure = found.places.filter(place => place.sure && place.section === 'hours');
    const result = await spliceLocal(
      repo,
      'northside',
      'hours',
      'iteration-03',
      'iteration-04',
      sure
    );
    assert.deepEqual(result, {
      ok: true,
      files: ['rough/northside/hours/iteration-04/index.jsx'],
      leftOver: []
    });
    const text = fs.readFileSync(
      path.join(repo, 'rough', 'northside', 'hours', 'iteration-04', 'index.jsx'),
      'utf8'
    );
    assert.match(text, /'Friday 08:00 to 18:00'/);
    assert.match(text, /Late opening until 19:00\./);
  });

  it('refuses when the new iteration is already there, and writes nothing', async () => {
    const repo = fixtureRepo();
    const found = await findLocal(repo, context, edits);
    assert.ok(found.ok);
    write(repo, 'rough/home/hero/iteration-02/index.tsx', 'export default () => null;\n');
    const sure = found.places.filter(place => place.sure && place.section === 'hero');
    const result = await spliceLocal(repo, 'home', 'hero', 'iteration-01', 'iteration-02', sure);
    assert.deepEqual(result, {
      ok: false,
      why: 'rough/home/hero/iteration-02 already exists. An existing iteration is never written over.',
      leftOver: sure.map(place => place.id)
    });
    assert.equal(
      fs.readFileSync(
        path.join(repo, 'rough', 'home', 'hero', 'iteration-02', 'index.tsx'),
        'utf8'
      ),
      'export default () => null;\n'
    );
  });

  it('writes nothing when no place can be spliced', async () => {
    const repo = fixtureRepo();
    const found = await findLocal(repo, context, edits);
    assert.ok(found.ok);
    const place = found.places.find(item => item.section === 'hero')!;
    const result = await spliceLocal(repo, 'home', 'hero', 'iteration-01', 'iteration-02', [
      { ...place, old: 'nowhere at all' }
    ]);
    assert.equal(result.ok, false);
    assert.deepEqual(result.ok ? [] : result.leftOver, [place.id]);
    assert.ok(!fs.existsSync(path.join(repo, 'rough', 'home', 'hero', 'iteration-02')));
  });

  it('refuses names that are not an iteration’s', async () => {
    const repo = fixtureRepo();
    const result = await spliceLocal(repo, 'home', 'hero', 'iteration-01', '../../outside', []);
    assert.equal(result.ok, false);
    assert.ok(!fs.existsSync(path.join(repo, 'outside')));
  });
});

describe('which stacks get fact changes', () => {
  it('names Next, Vite with React, Expo and standalone React', () => {
    assert.deepEqual([...FACT_STACKS], ['next', 'vite', 'expo', 'standalone']);
    for (const recipe of ['next', 'vite', 'expo']) {
      const environment = { recipe, mode: 'live', family: 'react-like' } as const;
      assert.equal(factStackOf(environment), recipe);
      assert.equal(factStackWhy(environment), null);
    }
    const standalone = { recipe: null, mode: 'standalone', family: 'react-like' } as const;
    assert.equal(factStackOf(standalone), 'standalone');
    assert.equal(factStackWhy(standalone), null);
  });

  it('says in a sentence when a stack has none yet', () => {
    assert.equal(
      factStackWhy({ recipe: 'nuxt', mode: 'live', family: 'markup-css' }),
      "Fact changes aren't there yet for Vue with Nuxt: they work in Next.js, Vite with React, Expo and standalone React sections. Change the words in the section, or draw it again."
    );
    assert.match(
      factStackWhy({ recipe: null, mode: 'standalone', family: 'markup-css' }) ?? '',
      /^Fact changes aren't there yet for standalone HTML sections:/
    );
    assert.match(
      factStackWhy({ recipe: null, mode: 'live', family: 'react-like' }) ?? '',
      /^Fact changes aren't there yet for this stack:/
    );
  });
});
