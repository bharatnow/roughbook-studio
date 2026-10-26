// `roughbook section` and the composition command (ROUGHBOOK-BROWNFIELD-PLAN.md, B6, decisions 46
// to 52): a new section made on the backend from its name, with its folder in rough/; a composition
// checked against the map's order, numbered by the backend, written with the page's files in
// `.base/`, and its composed preview's pictures sent through the outbox. No request carries a path
// or a line of the repo's code.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { ProjectTree } from '../api/types.js';
import { main, type MainOptions } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import { writeBaselines } from '../map/adopt.js';
import { mapRepo } from '../map/run.js';
import { readEnvironment } from '../environment/read.js';
import { readMap } from '../map/file.js';
import type { PictureShot } from '../pictures/share.js';
import { recipeFor } from '../recipes/index.js';
import type { RepoLink } from '../repo/link.js';
import {
  assertCarriesNoRepoContent,
  fakeFetch,
  ok,
  recordingIo,
  refused,
  tempDir,
  type RecordedRequest
} from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';
const LINK: RepoLink & Record<string, unknown> = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: 'app',
  stack: ['next-16', 'react-19'],
  family: 'react-like'
};
const PAGE = `/v1/api/studio/orgs/${ORG}/projects/site/pages/home`;

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

const HOME_SOURCE = `import { Hero } from "@/components/hero";
import { Features } from "@/components/features";
import { Testimonials } from "@/components/testimonials";

export default function Home() {
  return (
    <main className="home-page-layout">
      <Hero />
      <Features />
      <Testimonials />
    </main>
  );
}
`;

const TREE = {
  slug: 'site',
  name: 'Site',
  delivery: { componentsDir: 'components', publicDir: 'public', devUrl: '' },
  pictures: true,
  pages: [{ slug: 'home', name: 'Home', inApp: true, components: [] }]
} as unknown as ProjectTree;

/** A linked Next.js app, mapped, with Home's sections adopted and a new section's iteration. */
async function homeApp(): Promise<string> {
  const repo = path.join(await tempDir('roughbook-compose-'), 'app');
  write(repo, 'package.json', '{ "dependencies": { "next": "16.0.0", "react": "19.0.0" } }\n');
  write(repo, 'tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }\n');
  write(
    repo,
    'app/layout.tsx',
    'export default function Layout({ children }) { return children; }\n'
  );
  write(repo, 'app/page.tsx', HOME_SOURCE);
  for (const [slug, name] of [
    ['hero', 'Hero'],
    ['features', 'Features'],
    ['testimonials', 'Testimonials']
  ] as const) {
    write(
      repo,
      `components/${slug}.tsx`,
      `export function ${name}() {\n  return <section className="${slug}-section-block">${name} of the app</section>;\n}\n`
    );
  }
  write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
  execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'ignore' });
  const environment = await readEnvironment(repo, LINK);
  await mapRepo(repo, environment, LINK);
  const map = readMap(repo)!.map;
  writeBaselines(repo, map, recipeFor('next'), {
    pages: [
      {
        slug: 'home',
        created: true,
        components: map.pages
          .find(item => item.slug === 'home')!
          .sections.map(slug => ({ slug, created: true, baseline: 'iteration-00' }))
      }
    ]
  });
  write(
    repo,
    'rough/home/customer-logos/iteration-01/index.tsx',
    'export default function CustomerLogos() {\n  return <ul className="logo-wall">Logos we earned</ul>;\n}\n'
  );
  return repo;
}

type Route = (request: RecordedRequest) => ReturnType<typeof ok>;

async function studio(
  repo: string,
  routes: Record<string, Route>,
  overrides: Partial<MainOptions> = {}
) {
  const configDir = await tempDir('roughbook-config-');
  await saveCredentials(configDir, {
    server: SERVER,
    installId: 'install-1',
    token: 'rbi_token',
    signedInAs: 'dana@example.test',
    savedAt: new Date(0).toISOString()
  });
  const fake = fakeFetch(request => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/api/studio/')) return 'offline';
    const route = routes[`${request.method} ${url.pathname}`];
    return route ? route(request) : refused('NOT_FOUND', 404);
  });
  const io = recordingIo();
  const home = await tempDir('roughbook-home-');
  const run = (argv: string[]) =>
    main(argv, {
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      io,
      fetch: fake.fetch,
      platform: 'win32',
      home,
      askPreview: async () => null,
      ...overrides
    });
  return { io, requests: fake.requests, run };
}

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
        [`GET /v1/api/studio/orgs/${ORG}/projects/site`]: () => ok(TREE),
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
      '  2. customer-logos (iteration-01): added',
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
});
