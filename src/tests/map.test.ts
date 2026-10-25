// The map of what an app has (ROUGHBOOK-BROWNFIELD-PLAN.md, B1): rough/map.md written and read
// back, what a map that reads can still get wrong, and the map built from the discoverers' results,
// merged, with slugs that stay put when a file moves and judgments a later run keeps.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMap, componentSlug, humanName, pageSlug } from '../map/build.js';
import {
  DEFAULT_PROSE,
  MapFormatError,
  mapProblems,
  mapProse,
  parseMap,
  readMap,
  renderMap,
  writeMap
} from '../map/file.js';
import type { Discovered, FoundComponent, RepoMap } from '../map/types.js';
import { tempDir } from './helpers.js';

const SAMPLE: RepoMap = {
  version: 1,
  by: ['next', 'agent'],
  pages: [
    {
      slug: 'shared',
      name: 'Shared',
      address: null,
      example: null,
      signIn: 'unknown',
      files: ['app/layout.tsx'],
      sections: ['site-header', 'site-footer'],
      byAgent: false
    },
    {
      slug: 'home',
      name: 'Home',
      address: '/',
      example: null,
      signIn: 'no',
      files: ['app/page.tsx'],
      sections: ['hero', 'pricing'],
      byAgent: false
    },
    {
      slug: 'blog-slug',
      name: 'Blog post',
      address: '/blog/[slug]',
      example: '/blog/hello-world',
      signIn: 'unknown',
      files: ['app/blog/[slug]/page.tsx', 'components/blog/post-view.tsx'],
      sections: [],
      byAgent: false
    }
  ],
  components: [
    {
      slug: 'site-header',
      name: 'Site header',
      kind: 'shared',
      files: ['components/site-header.tsx'],
      export: 'SiteHeader',
      fixture: null,
      alone: 'yes',
      why: null,
      byAgent: false
    },
    {
      slug: 'site-footer',
      name: 'Site footer',
      kind: 'shared',
      files: ['components/site-footer.tsx'],
      export: 'default',
      fixture: null,
      alone: 'unknown',
      why: null,
      byAgent: false
    },
    {
      slug: 'hero',
      name: 'Hero, the first screen',
      kind: 'section',
      files: ['components/hero.tsx'],
      export: 'default',
      fixture: 'rough/map/fixtures/hero/preview.json',
      alone: 'yes',
      why: null,
      byAgent: false
    },
    {
      slug: 'pricing',
      name: 'Pricing',
      kind: 'section',
      files: ['components/pricing.tsx', 'lib/plans.ts'],
      export: 'Pricing',
      fixture: null,
      alone: 'no',
      why: 'It fetches the plans on the server.',
      byAgent: true
    },
    {
      slug: 'button',
      name: 'Button',
      kind: 'atom',
      files: ['components/ui/button.tsx'],
      export: 'Button',
      fixture: null,
      alone: 'unknown',
      why: null,
      byAgent: false
    }
  ],
  missed: [{ what: 'app/@modal/(.)photo/page.tsx', why: 'an intercepting route' }],
  unplaced: ['components/old-banner.tsx']
};

describe('rough/map.md', () => {
  it('is written with every field and read back as it was', () => {
    const text = renderMap(SAMPLE);
    assert.ok(text.startsWith('---\nmap: 1\nby: next, agent\npages:\n  - slug: shared\n'));
    // Shared has no address; a dynamic page says its example even when there is none.
    assert.doesNotMatch(text, /slug: shared\n {4}name: Shared\n {4}address/);
    assert.match(text, /address: \/blog\/\[slug\]\n {4}example: \/blog\/hello-world/);
    assert.match(text, /fixture: none\n {4}alone: unknown/);
    assert.match(text, /why: It fetches the plans on the server\.\n {4}found: agent/);
    assert.match(text, /missed:\n {2}- app\/@modal\/\(\.\)photo\/page\.tsx: an intercepting route/);
    assert.match(text, /unplaced:\n {2}- components\/old-banner\.tsx\n---\n/);
    assert.ok(text.endsWith(DEFAULT_PROSE));
    assert.deepEqual(parseMap(text), SAMPLE);
    assert.equal(mapProse(text), DEFAULT_PROSE);
    // Windows line endings read the same.
    assert.deepEqual(parseMap(text.replace(/\n/g, '\r\n')), SAMPLE);
  });

  it('reads what an agent writes by hand: quotes, true and false, unknown fields, comments', () => {
    const map = parseMap(`---
map: 1
# written by hand
pages:
  - slug: home
    name: "Home"
    address: /
    signIn: false
    sections: hero
    owner: marketing
components:
  - slug: hero
    kind: section
    files: components/hero.tsx
    alone: true
---
Notes.
`);
    assert.equal(map.pages[0]!.name, 'Home');
    assert.equal(map.pages[0]!.signIn, 'no');
    assert.equal(map.components[0]!.name, 'hero');
    assert.equal(map.components[0]!.export, 'default');
    assert.equal(map.components[0]!.alone, 'yes');
    assert.equal(map.components[0]!.fixture, null);
  });

  it("reads a fixture written from rough/, as an agent may, as the repo's path", () => {
    const map = parseMap(`---
map: 1
components:
  - slug: hero
    files: components/hero.tsx
    fixture: map/fixtures/hero/preview.json
  - slug: pricing
    files: components/pricing.tsx
    fixture: rough/map/fixtures/pricing/preview.json
---
`);
    assert.deepEqual(
      map.components.map(item => item.fixture),
      ['rough/map/fixtures/hero/preview.json', 'rough/map/fixtures/pricing/preview.json']
    );
    assert.deepEqual(mapProblems(map), []);
  });

  it('refuses what it cannot read, with the line', () => {
    assert.throws(() => parseMap('no header'), MapFormatError);
    assert.throws(() => parseMap('---\nmap: 2\n---\n'), /map 2 is not a version this studio knows/);
    assert.throws(
      () => parseMap('---\ncomponents:\n  - slug: hero\n    kind: organism\n---\n'),
      /line 3: kind is section, shared, atom; not "organism"/
    );
    assert.throws(
      () => parseMap('---\npages:\n  - name: Home\n---\n'),
      /line 3: a page needs its slug/
    );
    assert.throws(() => parseMap('---\npages:\nnot a field\n---\n'), /line 3: cannot read/);
    assert.throws(
      () => parseMap('---\ncomponents:\n  - slug: hero\n    alone: perhaps\n---\n'),
      /alone is yes, no or unknown/
    );
  });

  it('names what is wrong in a map that reads', () => {
    const broken: RepoMap = {
      ...SAMPLE,
      pages: [
        { ...SAMPLE.pages[1]!, sections: ['hero', 'gone'] },
        { ...SAMPLE.pages[1]!, address: 'pricing', files: ['../elsewhere/page.tsx'] }
      ],
      components: [
        SAMPLE.components[2]!,
        { ...SAMPLE.components[3]!, slug: 'Pricing Table', fixture: 'fixtures/pricing.json' }
      ]
    };
    assert.deepEqual(mapProblems(broken), [
      'Two pages are called home.',
      'The component slug "Pricing Table" is not a slug.',
      'The page home names gone, which is not a component in the map.',
      'The page home names pricing, which is not a component in the map.',
      'The page home names ../elsewhere/page.tsx, outside the repo.',
      "The page home's address pricing does not start with /.",
      "The component Pricing Table's fixture fixtures/pricing.json is not a file inside rough/."
    ]);
    assert.deepEqual(mapProblems(SAMPLE), []);
  });

  it('is written into rough/, keeping the prose an agent wrote', async () => {
    const repo = await tempDir();
    assert.equal(readMap(repo), null);
    assert.equal(writeMap(repo, SAMPLE), true);
    assert.equal(writeMap(repo, SAMPLE), false);
    const { map, prose } = readMap(repo)!;
    assert.deepEqual(map, SAMPLE);
    assert.equal(prose, DEFAULT_PROSE);
    writeMap(repo, SAMPLE, '# The map\n\nThe pricing section reads lib/plans.ts.\n');
    assert.equal(writeMap(repo, { ...SAMPLE, unplaced: [] }), true);
    assert.equal(readMap(repo)!.prose, '# The map\n\nThe pricing section reads lib/plans.ts.\n');
    assert.deepEqual(readMap(repo)!.map.unplaced, []);
  });
});

function component(
  key: string,
  name: string,
  kind: FoundComponent['kind'] = 'section',
  fixture: Record<string, unknown> | null = null
): FoundComponent {
  const [file, exported] = key.split('#') as [string, string];
  return {
    key,
    name,
    kind,
    files: [file],
    export: exported,
    fixture,
    fixtureFrom: fixture ? `${file.replace(/\.tsx$/, '.stories.tsx')} Default` : null
  };
}

function found(overrides: Partial<Discovered> = {}): Discovered {
  return {
    by: 'next',
    pages: [
      {
        address: null,
        name: null,
        files: ['app/layout.tsx'],
        sections: ['components/site-header.tsx#SiteHeader'],
        signIn: 'unknown',
        example: null
      },
      {
        address: '/',
        name: null,
        files: ['app/page.tsx'],
        sections: ['components/hero.tsx#default', 'components/pricing.tsx#Pricing'],
        signIn: 'unknown',
        example: null
      },
      {
        address: '/blog/[slug]',
        name: null,
        files: ['app/blog/[slug]/page.tsx'],
        sections: ['components/blog/header.tsx#default'],
        signIn: 'unknown',
        example: null
      }
    ],
    components: [
      component('components/site-header.tsx#SiteHeader', 'SiteHeader', 'shared'),
      component('components/hero.tsx#default', 'Hero', 'section', { title: 'Plan less' }),
      component('components/pricing.tsx#Pricing', 'Pricing'),
      component('components/blog/header.tsx#default', 'Header'),
      component('components/ui/button.tsx#Button', 'Button', 'atom')
    ],
    missed: [],
    unplaced: ['components/old-banner.tsx'],
    ...overrides
  };
}

describe('building the map', () => {
  it('names pages by their address and components by their code', () => {
    assert.equal(pageSlug('/'), 'home');
    assert.equal(pageSlug('/blog/[slug]'), 'blog-slug');
    assert.equal(pageSlug('/docs/[...path]'), 'docs-path');
    assert.equal(pageSlug('/posts/{post}/edit'), 'posts-post-edit');
    assert.equal(pageSlug('/?pagename=about'), 'pagename-about');
    assert.equal(componentSlug('PricingTable'), 'pricing-table');
    assert.equal(componentSlug('HTMLBlock'), 'html-block');
    assert.equal(componentSlug('site_footer'), 'site-footer');
    assert.equal(componentSlug('3DViewer'), '3d-viewer');
    assert.equal(componentSlug('---'), 'component');
    assert.ok(componentSlug('A'.repeat(200)).length <= 60);
    assert.equal(humanName('PricingTable'), 'Pricing table');
    assert.equal(humanName('site-footer'), 'Site footer');
    assert.equal(humanName('FAQ'), 'FAQ');
  });

  it('turns what a discoverer found into pages, Shared and components, in page order', () => {
    const { map, fixtures } = buildMap([found()], null, { fixture: 'preview.json' });
    assert.deepEqual(map.by, ['next']);
    assert.deepEqual(
      map.pages.map(page => [page.slug, page.name, page.address, page.sections]),
      [
        ['shared', 'Shared', null, ['site-header']],
        ['home', 'Home', '/', ['hero', 'pricing']],
        ['blog-slug', 'Blog / [slug]', '/blog/[slug]', ['header']]
      ]
    );
    assert.deepEqual(
      map.components.map(item => [item.slug, item.name, item.kind, item.export]),
      [
        ['site-header', 'Site header', 'shared', 'SiteHeader'],
        ['hero', 'Hero', 'section', 'default'],
        ['pricing', 'Pricing', 'section', 'Pricing'],
        ['header', 'Header', 'section', 'default'],
        ['button', 'Button', 'atom', 'Button']
      ]
    );
    // The story's inputs become the hero's fixture, inside rough/, in the stack's fixture file.
    assert.equal(map.components[1]!.fixture, 'rough/map/fixtures/hero/preview.json');
    assert.deepEqual(fixtures, [
      { file: 'rough/map/fixtures/hero/preview.json', content: '{\n  "title": "Plan less"\n}\n' }
    ]);
    assert.deepEqual(map.unplaced, ['components/old-banner.tsx']);
    assert.deepEqual(mapProblems(map), []);
    // A stack whose preview takes no fixture gets none.
    assert.equal(buildMap([found()], null, { fixture: null }).map.components[1]!.fixture, null);
  });

  it('merges two discoverers: pages by address, components by file and export', () => {
    const vite = found({
      by: 'vite',
      pages: [
        {
          address: '/',
          name: null,
          files: ['resources/js/Pages/Home.tsx'],
          sections: ['components/pricing.tsx#Pricing', 'resources/js/Faq.tsx#default'],
          signIn: 'no',
          example: null
        },
        {
          address: '/account',
          name: 'Account',
          files: ['resources/js/Pages/Account.tsx'],
          sections: [],
          signIn: 'yes',
          example: null
        }
      ],
      components: [
        component('components/pricing.tsx#Pricing', 'Pricing'),
        component('resources/js/Faq.tsx#default', 'Faq')
      ],
      missed: [{ what: 'resources/js/Pages/Admin.tsx', why: 'no route renders it' }],
      unplaced: ['components/old-banner.tsx', 'resources/js/Old.tsx']
    });
    const { map } = buildMap([found(), vite], null, { fixture: 'preview.json' });
    assert.deepEqual(map.by, ['next', 'vite']);
    const home = map.pages.find(page => page.slug === 'home')!;
    assert.deepEqual(home.sections, ['hero', 'pricing', 'faq']);
    assert.deepEqual(home.files, ['app/page.tsx', 'resources/js/Pages/Home.tsx']);
    assert.equal(home.signIn, 'no');
    assert.equal(map.pages.find(page => page.slug === 'account')!.signIn, 'yes');
    assert.equal(map.components.filter(item => item.slug === 'pricing').length, 1);
    assert.deepEqual(map.missed, [
      { what: 'resources/js/Pages/Admin.tsx', why: 'no route renders it' }
    ]);
    assert.deepEqual(map.unplaced, ['components/old-banner.tsx', 'resources/js/Old.tsx']);
  });

  it('tells two components of one name apart by their folders', () => {
    const { map } = buildMap(
      [
        found({
          components: [
            component('components/site-header.tsx#SiteHeader', 'SiteHeader', 'shared'),
            component('components/hero.tsx#default', 'Hero'),
            component('components/pricing.tsx#Pricing', 'Pricing'),
            component('components/blog/header.tsx#default', 'Header'),
            component('components/admin/header.tsx#default', 'Header', 'atom'),
            component('components/ui/button.tsx#Button', 'Button', 'atom')
          ]
        })
      ],
      null,
      { fixture: 'preview.json' }
    );
    const slugs = map.components.map(item => item.slug);
    assert.ok(slugs.includes('admin-header') && slugs.includes('blog-header'), slugs.join(' '));
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it('keeps slugs and what the map run wrote when a file moves, and drops what is gone', async () => {
    const repo = await tempDir();
    const first = buildMap([found()], null, { fixture: 'preview.json' }).map;
    // The map run's work: a better name, a fixture, an example, a sign-in, a component it found.
    const edited: RepoMap = {
      ...first,
      by: ['next', 'agent'],
      pages: first.pages.map(page =>
        page.slug === 'blog-slug'
          ? { ...page, name: 'Blog post', example: '/blog/hello-world', signIn: 'no' }
          : page.slug === 'home'
            ? { ...page, sections: ['hero', 'testimonials', 'pricing'] }
            : page
      ),
      components: [
        ...first.components.map(item =>
          item.slug === 'pricing'
            ? {
                ...item,
                name: 'Plans',
                kind: 'section' as const,
                alone: 'no' as const,
                why: 'It fetches the plans.'
              }
            : item
        ),
        {
          slug: 'testimonials',
          name: 'Testimonials',
          kind: 'section',
          files: ['app/page.tsx'],
          export: 'Testimonials',
          fixture: null,
          alone: 'no',
          why: 'Defined inside the page file.',
          byAgent: true
        }
      ]
    };
    // The hero moves into a folder of its own; the blog header is deleted.
    const moved = found({
      pages: found().pages.map(page =>
        page.address === '/'
          ? {
              ...page,
              sections: ['components/marketing/hero.tsx#default', 'components/pricing.tsx#Pricing']
            }
          : page.address === '/blog/[slug]'
            ? { ...page, sections: [] }
            : page
      ),
      components: [
        component('components/site-header.tsx#SiteHeader', 'SiteHeader', 'shared'),
        component('components/marketing/hero.tsx#default', 'Hero'),
        component('components/pricing.tsx#Pricing', 'Pricing'),
        component('components/ui/button.tsx#Button', 'Button', 'atom')
      ]
    });
    const exists = (file: string) => file === 'app/page.tsx';
    const { map } = buildMap([moved], edited, { fixture: 'preview.json', exists });
    void repo;
    const hero = map.components.find(item => item.slug === 'hero')!;
    assert.deepEqual(hero.files, ['components/marketing/hero.tsx']);
    assert.equal(hero.fixture, 'rough/map/fixtures/hero/preview.json');
    const pricing = map.components.find(item => item.slug === 'pricing')!;
    assert.deepEqual(
      [pricing.name, pricing.alone, pricing.why],
      ['Plans', 'no', 'It fetches the plans.']
    );
    assert.ok(!map.components.some(item => item.slug === 'header'));
    assert.ok(map.components.some(item => item.slug === 'testimonials' && item.byAgent));
    const home = map.pages.find(page => page.slug === 'home')!;
    assert.deepEqual(home.sections, ['hero', 'testimonials', 'pricing']);
    const post = map.pages.find(page => page.slug === 'blog-slug')!;
    assert.deepEqual(
      [post.name, post.example, post.signIn],
      ['Blog post', '/blog/hello-world', 'no']
    );
    assert.deepEqual(map.by, ['next', 'agent']);
    // An agent's component whose file is gone goes with it.
    const gone = buildMap([moved], edited, { fixture: 'preview.json', exists: () => false }).map;
    assert.ok(!gone.components.some(item => item.slug === 'testimonials'));
    assert.deepEqual(gone.pages.find(page => page.slug === 'home')!.sections, ['hero', 'pricing']);
    assert.deepEqual(mapProblems(map), []);
  });

  it('keeps a page the map run added, and a slug of its own for a page at /shared', () => {
    const previous = buildMap([found()], null, { fixture: null }).map;
    previous.pages.push({
      slug: 'checkout',
      name: 'Checkout',
      address: '/checkout',
      example: null,
      signIn: 'yes',
      files: [],
      sections: [],
      byAgent: true
    });
    const withShared = found({
      pages: [
        ...found().pages,
        {
          address: '/shared',
          name: null,
          files: ['app/shared/page.tsx'],
          sections: [],
          signIn: 'unknown',
          example: null
        }
      ]
    });
    const { map } = buildMap([withShared], previous, { fixture: null, exists: () => true });
    assert.ok(map.pages.some(page => page.slug === 'checkout' && page.byAgent));
    assert.ok(map.pages.some(page => page.slug === 'shared-page' && page.address === '/shared'));
    assert.deepEqual(mapProblems(map), []);
  });

  it("keeps a page's sections as the map run set them while the code reads the same", () => {
    const sections = (map: RepoMap) =>
      Object.fromEntries(map.pages.map(page => [page.slug, page.sections]));
    const first = buildMap([found()], null, { fixture: null });
    // What the discoverers found, by page, kept beside the map to tell an edit from their reading.
    assert.deepEqual(first.found, {
      shared: ['site-header'],
      home: ['hero', 'pricing'],
      'blog-slug': ['header']
    });
    // The map run puts the pricing first on the home page and adds it to the post, which shows it.
    const edited: RepoMap = {
      ...first.map,
      pages: first.map.pages.map(page =>
        page.slug === 'home'
          ? { ...page, sections: ['pricing', 'hero'] }
          : page.slug === 'blog-slug'
            ? { ...page, sections: ['header', 'pricing'] }
            : page
      )
    };
    const again = buildMap([found()], edited, { fixture: null, lastFound: first.found });
    assert.deepEqual(sections(again.map), {
      shared: ['site-header'],
      home: ['pricing', 'hero'],
      'blog-slug': ['header', 'pricing']
    });
    assert.deepEqual(again.found, first.found);
    // The post's code changes: its new reading, with what the map run added kept in its place;
    // the home page reads the same, so its order stays the map run's.
    const changed = found({
      pages: found().pages.map(page =>
        page.address === '/blog/[slug]'
          ? { ...page, sections: [...page.sections, 'components/hero.tsx#default'] }
          : page
      )
    });
    const later = buildMap([changed], again.map, { fixture: null, lastFound: again.found });
    assert.deepEqual(sections(later.map), {
      shared: ['site-header'],
      home: ['pricing', 'hero'],
      'blog-slug': ['header', 'pricing', 'hero']
    });
    // A map written before the studio kept its reading: the discoverers' sections, as before.
    assert.deepEqual(sections(buildMap([found()], edited, { fixture: null }).map).home, [
      'hero',
      'pricing'
    ]);
  });
});
