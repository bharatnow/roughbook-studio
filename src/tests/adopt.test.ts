// Adoption (ROUGHBOOK-BROWNFIELD-PLAN.md, B2): the map's pages and components become project
// records by name, slug and kind only (decisions 6 and 7); each adopted component's baseline,
// iteration 0, is written through its recipe's pointer with the map's fixture, never a copy of the
// code (decision 2); and "Adopt all" asks first past 50 components (decision 29).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { AdoptBody } from '../api/types.js';
import { main, type MainOptions } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import {
  ADOPT_BATCH,
  adoptBodies,
  BASELINE,
  baselineSources,
  chooseAdoption,
  countAdoption,
  parseChoice,
  writeBaselines
} from '../map/adopt.js';
import { writeMap } from '../map/file.js';
import type { MapComponent, MapPage, RepoMap } from '../map/types.js';
import { SCREENFUL, takeLeftForStart } from '../pictures/queue.js';
import { recipeFor } from '../recipes/index.js';
import { iterationHash } from '../screenshot/iteration.js';
import { fakeFetch, ok, recordingIo, refused, tempDir, type RecordedRequest } from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

function page(slug: string, sections: string[], extra: Partial<MapPage> = {}): MapPage {
  return {
    slug,
    name: slug === 'home' ? 'Home' : slug[0]!.toUpperCase() + slug.slice(1),
    address: slug === 'shared' ? null : slug === 'home' ? '/' : `/${slug}`,
    example: null,
    signIn: 'no',
    files: [],
    sections,
    byAgent: false,
    ...extra
  };
}

function component(slug: string, files: string[], extra: Partial<MapComponent> = {}): MapComponent {
  return {
    slug,
    name: slug
      .split('-')
      .map(word => word[0]!.toUpperCase() + word.slice(1))
      .join(' '),
    kind: 'section',
    files,
    export: 'default',
    fixture: null,
    alone: 'unknown',
    why: null,
    byAgent: false,
    ...extra
  };
}

function repoMap(pages: MapPage[], components: MapComponent[]): RepoMap {
  return { version: 1, by: ['next'], pages, components, missed: [], unplaced: [] };
}

const MAP = repoMap(
  [
    page('shared', ['site-header']),
    page('home', ['hero', 'pricing', 'hero']),
    page('blog-slug', ['post'], { address: '/blog/[slug]' })
  ],
  [
    component('site-header', ['components/site-header.tsx'], {
      kind: 'shared',
      export: 'SiteHeader'
    }),
    component('hero', ['components/hero.tsx'], { fixture: 'rough/map/fixtures/hero/preview.json' }),
    component('pricing', ['components/pricing.tsx'], { export: 'Pricing' }),
    component('post', ['components/post.tsx'], { export: 'Post' }),
    component('button', ['components/ui/button.tsx'], { kind: 'atom', export: 'Button' })
  ]
);

describe('choosing what to adopt', () => {
  it('reads a page, or a page and one component, and nothing else', () => {
    assert.deepEqual(parseChoice('home'), { page: 'home' });
    assert.deepEqual(parseChoice('home/hero'), { page: 'home', component: 'hero' });
    for (const text of ['', 'Home', 'home/hero/iteration-00', '../home', 'home/']) {
      assert.equal(parseChoice(text), null, text);
    }
  });

  it('brings a page’s sections once each, the shared parts on Shared, and atoms only when named', () => {
    const home = chooseAdoption(MAP, { page: 'home' });
    assert.deepEqual(
      home.map(item => [item.page.slug, item.components.map(c => c.slug)]),
      [['home', ['hero', 'pricing']]]
    );
    const all = chooseAdoption(MAP, { all: true });
    assert.deepEqual(
      all.map(item => [item.page.slug, item.components.map(c => c.slug)]),
      [
        ['shared', ['site-header']],
        ['home', ['hero', 'pricing']],
        ['blog-slug', ['post']]
      ]
    );
    assert.equal(countAdoption(all), 4, 'the atom is not a card (decision 5)');
    // By hand, an atom is adopted onto the page named.
    assert.deepEqual(
      chooseAdoption(MAP, { page: 'home', component: 'button' })[0]!.components.map(c => c.slug),
      ['button']
    );
    assert.throws(() => chooseAdoption(MAP, { page: 'about' }), /has no page about/);
    assert.throws(
      () => chooseAdoption(MAP, { page: 'home', component: 'footer' }),
      /no component footer/
    );
    assert.throws(
      () => chooseAdoption(MAP, { page: 'home', component: 'post' }),
      /post is not on home; it is on blog-slug/
    );
  });

  it('sends names, slugs and kinds only, at most 500 components a request', () => {
    assert.deepEqual(adoptBodies(chooseAdoption(MAP, { all: true })), [
      {
        pages: [
          {
            slug: 'shared',
            name: 'Shared',
            components: [{ slug: 'site-header', name: 'Site Header', kind: 'shared' }],
            sections: ['site-header']
          },
          {
            slug: 'home',
            name: 'Home',
            components: [
              { slug: 'hero', name: 'Hero', kind: 'section' },
              { slug: 'pricing', name: 'Pricing', kind: 'section' }
            ],
            sections: ['hero', 'pricing']
          },
          {
            slug: 'blog-slug',
            name: 'Blog-slug',
            components: [{ slug: 'post', name: 'Post', kind: 'section' }],
            sections: ['post']
          }
        ]
      }
    ]);
    // A large app goes in batches; a page larger than a batch is split across them.
    const many = Array.from({ length: 1200 }, (_, index) =>
      component(`part-${index}`, [`c/${index}.tsx`])
    );
    const big = repoMap(
      [
        page(
          'home',
          many.slice(0, 700).map(c => c.slug)
        ),
        page(
          'about',
          many.slice(700).map(c => c.slug)
        )
      ],
      many
    );
    const bodies = adoptBodies(chooseAdoption(big, { all: true }));
    const sizes = bodies.map(body => body.pages.map(item => [item.slug, item.components.length]));
    assert.deepEqual(sizes, [
      [['home', 500]],
      [
        ['home', 200],
        ['about', 300]
      ],
      [['about', 200]]
    ]);
    assert.ok(bodies.every(body => countIn(body) <= ADOPT_BATCH));
    // Each part of a split page carries the page's order, at most 500 of it (decision 55).
    const order = bodies.flatMap(body => body.pages.map(item => item.sections));
    assert.deepEqual(
      order.map(item => [item.length, item[0]]),
      [
        [500, 'part-0'],
        [500, 'part-0'],
        [500, 'part-700'],
        [500, 'part-700']
      ]
    );
  });

  it('sends the page’s order with one component, and alone with none (decision 55)', () => {
    // The order is the page's own sections, once each, with no atom, whatever is adopted.
    const atom = chooseAdoption(MAP, { page: 'home', component: 'button' });
    assert.deepEqual(adoptBodies(atom)[0]!.pages[0]!.sections, ['hero', 'pricing']);
    const hero = chooseAdoption(MAP, { page: 'home', component: 'hero' });
    assert.deepEqual(adoptBodies(hero)[0]!.pages[0]!.sections, ['hero', 'pricing']);
    // A page whose order alone changed: no components, only its order.
    const home = chooseAdoption(MAP, { page: 'home' })[0]!;
    assert.deepEqual(adoptBodies([{ ...home, components: [] }]), [
      { pages: [{ slug: 'home', name: 'Home', components: [], sections: ['hero', 'pricing'] }] }
    ]);
  });
});

function countIn(body: AdoptBody): number {
  return body.pages.reduce((sum, item) => sum + item.components.length, 0);
}

const adoptedAll = (pages: [string, string[]][]) => ({
  pages: pages.map(([slug, components]) => ({
    slug,
    created: true,
    components: components.map(item => ({ slug: item, created: true, baseline: BASELINE }))
  }))
});

describe('the baselines', () => {
  it('points at the real file per recipe: default and named exports, Blade variables, a theme part, a Vue component', async () => {
    const repo = await tempDir('roughbook-baseline-');
    write(repo, 'rough/map/fixtures/hero/preview.json', '{\n  "title": "Plan less"\n}\n');
    const next = recipeFor('next')!;
    const result = writeBaselines(repo, MAP, next, adoptedAll([['home', ['hero', 'pricing']]]));
    assert.deepEqual(result, {
      written: ['home/hero', 'home/pricing'],
      present: [],
      unpointed: []
    });
    assert.equal(
      read(repo, 'rough/home/hero/iteration-00/index.tsx'),
      '// Hero, as the app has it in components/hero.tsx: a pointer, never a copy.\nexport { default } from "../../../../components/hero";\n'
    );
    assert.equal(
      read(repo, 'rough/home/hero/iteration-00/preview.json'),
      '{\n  "title": "Plan less"\n}\n'
    );
    assert.match(
      read(repo, 'rough/home/pricing/iteration-00/index.tsx'),
      /export \{ Pricing as default \} from "\.\.\/\.\.\/\.\.\/\.\.\/components\/pricing";/
    );
    assert.ok(!fs.existsSync(path.join(repo, 'rough/home/pricing/iteration-00/preview.json')));

    // Blade: a component given the fixture's keys as its variables.
    const blade = repoMap(
      [page('home', ['site-hero'])],
      [
        component('site-hero', ['resources/views/components/site-hero.blade.php'], {
          export: 'x-site-hero',
          fixture: 'rough/map/fixtures/site-hero/preview.json'
        })
      ]
    );
    write(
      repo,
      'rough/map/fixtures/site-hero/preview.json',
      '{ "headline": "Hello", "ctaLabel": "Go" }\n'
    );
    writeBaselines(repo, blade, recipeFor('laravel'), adoptedAll([['home', ['site-hero']]]));
    assert.match(
      read(repo, 'rough/home/site-hero/iteration-00/index.blade.php'),
      /<x-dynamic-component component="site-hero" :headline="\$headline" :cta-label="\$ctaLabel" \/>/
    );

    // A block theme's part, and a Nuxt component.
    const theme = repoMap(
      [page('shared', ['header'])],
      [component('header', ['parts/header.html'], { kind: 'shared', export: 'part header' })]
    );
    writeBaselines(repo, theme, recipeFor('wordpress'), adoptedAll([['shared', ['header']]]));
    assert.match(
      read(repo, 'rough/shared/header/iteration-00/index.php'),
      /<!-- wp:template-part \{"slug":"header"\} \/-->/
    );
    const vue = repoMap(
      [page('home', ['the-hero'])],
      [component('the-hero', ['components/TheHero.vue'])]
    );
    writeBaselines(repo, vue, recipeFor('nuxt'), adoptedAll([['home', ['the-hero']]]));
    assert.match(
      read(repo, 'rough/home/the-hero/iteration-00/index.vue'),
      /import Target from "\.\.\/\.\.\/\.\.\/\.\.\/components\/TheHero\.vue";/
    );

    // Shopify has no pointer: adopted, with no baseline here, and why.
    const shopify = writeBaselines(
      repo,
      repoMap(
        [page('home', ['banner'])],
        [component('banner', ['sections/banner.liquid'], { export: 'section banner' })]
      ),
      recipeFor('shopify'),
      adoptedAll([['home', ['banner']]])
    );
    assert.equal(shopify.written.length, 0);
    assert.match(shopify.unpointed[0]!.why, /cannot point an iteration at an existing component/);
  });

  it('leaves a baseline already here alone, and still shows the original after it changes', async () => {
    const repo = await tempDir('roughbook-baseline-');
    write(repo, 'components/hero.tsx', 'export default function Hero() { return <h1>One</h1>; }\n');
    writeMap(repo, MAP);
    const next = recipeFor('next')!;
    writeBaselines(repo, MAP, next, adoptedAll([['home', ['hero']]]));
    const pointer = read(repo, 'rough/home/hero/iteration-00/index.tsx');
    const target = { page: 'home', component: 'hero', iteration: BASELINE };
    const environment = { viewports: [], variants: [], overlays: [] };
    const before = iterationHash(repo, target, environment);

    // The app's file changes: the pointer is the same, and still names it; its screenshots and
    // pictures are due again, since what they show changed.
    write(repo, 'components/hero.tsx', 'export default function Hero() { return <h1>Two</h1>; }\n');
    assert.deepEqual(writeBaselines(repo, MAP, next, adoptedAll([['home', ['hero']]])).present, [
      'home/hero'
    ]);
    assert.equal(read(repo, 'rough/home/hero/iteration-00/index.tsx'), pointer);
    assert.ok(!pointer.includes('<h1>'), 'a pointer, never a copy');
    assert.deepEqual(baselineSources(repo, target), ['components/hero.tsx']);
    assert.notEqual(iterationHash(repo, target, environment), before);
    assert.deepEqual(baselineSources(repo, { ...target, iteration: 'iteration-01' }), []);
  });
});

type Route = (request: RecordedRequest) => ReturnType<typeof ok> | 'offline';

/** A linked Next.js app with rough/map.md, in a git repo. */
async function linkedRepo(map: RepoMap = MAP): Promise<string> {
  const repo = path.join(await tempDir('roughbook-adopt-'), 'app');
  write(repo, 'package.json', '{ "dependencies": { "next": "16.0.0", "react": "19.0.0" } }\n');
  for (const item of map.components) {
    write(repo, item.files[0]!, `export default function X() { return <div />; }\n`);
  }
  write(repo, 'rough/map/fixtures/hero/preview.json', '{\n  "title": "Plan less"\n}\n');
  write(
    repo,
    'rough/roughbook.json',
    JSON.stringify({
      version: 1,
      orgId: ORG,
      project: 'site',
      roughCommitted: true,
      appDir: 'app',
      stack: ['next-16', 'react-19'],
      family: 'react-like'
    })
  );
  writeMap(repo, map);
  execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

/** The backend's adopt route: everything new, each component with its baseline. */
export function adoptRoute(request: RecordedRequest) {
  const body = request.body as AdoptBody;
  return ok({
    pages: body.pages.map(item => ({
      slug: item.slug,
      created: true,
      components: item.components.map(c => ({ slug: c.slug, created: true, baseline: BASELINE }))
    }))
  });
}

async function studio(
  repo: string,
  routes: Record<string, Route>,
  options: { answers?: (string | null)[]; overrides?: Partial<MainOptions> } = {}
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
    const route = routes[`${request.method} ${url.pathname.replace('/v1/api/studio', '')}`];
    return route ? route(request) : refused('NOT_FOUND', 404);
  });
  const io = recordingIo(options.answers ?? []);
  const home = await tempDir('roughbook-home-');
  const run = (argv: string[]) =>
    main(argv, {
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      io,
      fetch: fake.fetch,
      platform: 'win32',
      home,
      // The app is not running: no screenshots or pictures.
      askPreview: async () => null,
      ...options.overrides
    });
  return { io, requests: fake.requests, run };
}

const ADOPT = `POST /orgs/${ORG}/projects/site/adopt`;

describe('roughbook adopt', () => {
  it('adopts a page by name, writes its baselines, and says what it made', async () => {
    const repo = await linkedRepo();
    const { io, requests, run } = await studio(repo, { [ADOPT]: adoptRoute });
    assert.equal(await run(['adopt', 'home']), 0, io.errors.join('\n'));
    assert.deepEqual(
      requests.map(request => [request.method, new URL(request.url).pathname]),
      [['POST', `/v1/api/studio/orgs/${ORG}/projects/site/adopt`]]
    );
    // Names, slugs and kinds: nothing else of the map.
    assert.deepEqual(requests[0]!.body, {
      pages: [
        {
          slug: 'home',
          name: 'Home',
          components: [
            { slug: 'hero', name: 'Hero', kind: 'section' },
            { slug: 'pricing', name: 'Pricing', kind: 'section' }
          ],
          sections: ['hero', 'pricing']
        }
      ]
    });
    assert.ok(fs.existsSync(path.join(repo, 'rough/home/hero/iteration-00/index.tsx')));
    assert.ok(fs.existsSync(path.join(repo, 'rough/home/hero/iteration-00/preview.json')));
    assert.ok(fs.existsSync(path.join(repo, 'rough/home/pricing/iteration-00/index.tsx')));
    assert.ok(io.lines.includes('Adopted 1 page (1 new) and 2 components (2 new).'));
    assert.ok(
      io.lines.some(line => line.startsWith('Baselines written: rough/home/hero/iteration-00'))
    );
    assert.ok(io.lines.some(line => line.startsWith('Nothing answered at http://localhost:3000')));

    // One component of a page; and what the map does not have, refused before any request.
    assert.equal(await run(['adopt', 'shared/site-header']), 0, io.errors.join('\n'));
    assert.deepEqual((requests.at(-1)!.body as AdoptBody).pages[0]!.components, [
      { slug: 'site-header', name: 'Site Header', kind: 'shared' }
    ]);
    const asked = requests.length;
    assert.equal(await run(['adopt', 'about']), 1);
    assert.match(io.errors.at(-1)!, /rough\/map\.md has no page about/);
    assert.equal(await run(['adopt']), 1);
    assert.match(io.errors.at(-1)!, /Name a page/);
    assert.equal(requests.length, asked);
  });

  it('asks before adopting all past 50 components, with the count; --yes answers', async () => {
    const parts = Array.from({ length: 51 }, (_, index) =>
      component(`part-${index}`, [`components/part-${index}.tsx`])
    );
    const repo = await linkedRepo(
      repoMap(
        [
          page(
            'home',
            parts.slice(0, 30).map(c => c.slug)
          ),
          page(
            'about',
            parts.slice(30).map(c => c.slug)
          )
        ],
        parts
      )
    );
    const { io, requests, run } = await studio(
      repo,
      { [ADOPT]: adoptRoute },
      { answers: ['n', null] }
    );
    assert.equal(await run(['adopt', '--all']), 0);
    assert.deepEqual(io.questions, [
      'Adopt all 2 pages and 51 components? Each becomes a record on the project, with its name and pictures, for its team and client reviewers. [y/N] '
    ]);
    assert.ok(
      io.lines.includes('Nothing was adopted. Adopt a page at a time with roughbook adopt <page>.')
    );
    // Nobody to answer is never a yes.
    assert.equal(await run(['adopt', '--all']), 1);
    assert.equal(requests.length, 0);
    assert.equal(await run(['adopt', '--all', '--yes']), 0, io.errors.join('\n'));
    assert.equal(io.questions.length, 2);
    assert.equal(countIn(requests[0]!.body as AdoptBody), 51);
    assert.ok(io.lines.includes('Adopted 2 pages (2 new) and 51 components (51 new).'));

    // Up to 50, "Adopt all" asks nothing.
    const small = await linkedRepo();
    const quiet = await studio(small, { [ADOPT]: adoptRoute });
    assert.equal(await quiet.run(['adopt', '--all']), 0, quiet.io.errors.join('\n'));
    assert.deepEqual(quiet.io.questions, []);
  });

  it('pictures a screenful of baselines and leaves the rest for start (decision 65)', async () => {
    const parts = Array.from({ length: SCREENFUL + 3 }, (_, index) =>
      component(`part-${index}`, [`components/part-${index}.tsx`])
    );
    const repo = await linkedRepo(
      repoMap(
        [
          page(
            'home',
            parts.map(c => c.slug)
          )
        ],
        parts
      )
    );
    const shot: string[] = [];
    const { io, run } = await studio(
      repo,
      { [ADOPT]: adoptRoute },
      {
        overrides: {
          askPreview: async url => ({ status: 200, url }),
          screenshot: async (_repo, _url, target) => {
            shot.push(target.component);
            return { files: {}, warning: null };
          }
        }
      }
    );
    assert.equal(await run(['adopt', 'home']), 0, io.errors.join('\n'));
    assert.equal(shot.length, SCREENFUL);
    assert.deepEqual(await takeLeftForStart(repo), [
      `home/part-${SCREENFUL}/iteration-00`,
      `home/part-${SCREENFUL + 1}/iteration-00`,
      `home/part-${SCREENFUL + 2}/iteration-00`
    ]);
    assert.ok(
      io.lines.includes(
        '  The other 3 baselines are pictured by roughbook start, those on screen first, or with roughbook screenshot <page>/<component>/iteration-00.'
      )
    );
  });
});
