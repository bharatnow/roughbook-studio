// The in-page view's switch (ROUGHBOOK-BROWNFIELD-PLAN.md, B5, decisions 41 and 42): which adopted
// sections there are and what each can show; the address that asks for a swap; and each recipe's
// switch: Next.js's loader and wrappers run as written (bundled with a stand-in React and request
// store), its edit in next.config and the edit's undo, and Laravel's list and PHP. Nothing of it is
// planned for a repo that maps nothing (ground rule 2).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { buildSync } from 'esbuild';
import { writeMap } from '../map/file.js';
import { recipeFor } from '../recipes/index.js';
import type { MapComponent, MapPage, RepoMap } from '../map/types.js';
import {
  CONTEXT_SENTINEL,
  contextAddress,
  contextSections,
  sectionKeyFor,
  swapAddress
} from '../recipes/context.js';
import {
  CONTEXT_BLOCK,
  CONTEXT_LIST,
  SECTION_FILE,
  SECTION_TEMPLATE,
  renderContextList,
  viewName
} from '../recipes/laravel/context.js';
import { PREVIEW_ROUTE, ROUTE_FILE } from '../recipes/laravel/preview.js';
import {
  CONTEXT_MODULES,
  CONTEXT_KEYS,
  CONTEXT_REGISTRY,
  contextFiles,
  editNextConfig,
  planNextConfig,
  renderContext,
  undoNextConfig
} from '../recipes/next/context.js';
import { planPrep } from '../repo/prep.js';
import { tempDir } from './helpers.js';

// By the recipes' index, which every command loads first.
const next = recipeFor('next')!;
const laravel = recipeFor('laravel')!;

const LINK = {
  version: 1 as const,
  orgId: 'org-1',
  project: 'site',
  roughCommitted: true,
  appDir: 'app'
};

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

function page(slug: string, sections: string[], extra: Partial<MapPage> = {}): MapPage {
  return {
    slug,
    name: slug,
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
    name: slug,
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

const NEXT_MAP: RepoMap = {
  version: 1,
  by: ['next'],
  pages: [
    page('shared', ['site-header']),
    page('home', ['hero', 'pricing-section']),
    page('pricing', ['pricing-section', 'faq']),
    page('blog-slug', ['post'], { address: '/blog/[slug]', example: '/blog/hello' })
  ],
  components: [
    component('site-header', ['components/layout/site-header.tsx'], {
      kind: 'shared',
      export: 'SiteHeader'
    }),
    component('hero', ['components/home/hero.tsx']),
    component('pricing-section', ['components/pricing/pricing-section.tsx'], {
      export: 'PricingSection'
    }),
    component('faq', ['components/pricing/faq.tsx'], { export: 'Faq' }),
    component('post', ['components/blog/post.tsx'], { export: 'Post' })
  ],
  missed: [],
  unplaced: []
};

/** A mapped Next.js repo with the pricing page's sections adopted and two forks of one of them. */
async function nextRepo(): Promise<string> {
  const repo = await tempDir('roughbook-context-');
  writeMap(repo, NEXT_MAP);
  write(repo, 'app/layout.tsx', 'export default function Layout() { return null; }\n');
  write(repo, 'tsconfig.json', '{}\n');
  write(
    repo,
    'next.config.ts',
    'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  cacheComponents: true,\n};\n\nexport default nextConfig;\n'
  );
  for (const key of [
    'pricing/pricing-section/iteration-00',
    'pricing/pricing-section/iteration-01',
    'pricing/pricing-section/iteration-02',
    'pricing/faq/iteration-00',
    'shared/site-header/iteration-00'
  ]) {
    write(
      repo,
      `rough/${key}/index.tsx`,
      'export default function Iteration() {\n  return null;\n}\n'
    );
  }
  // A fork from the app keeps its copy of the component's file, which its base names.
  write(repo, 'rough/pricing/pricing-section/iteration-01/pricing-section.tsx', 'export {};\n');
  write(
    repo,
    'rough/pricing/pricing-section/iteration-01/.base/base.json',
    JSON.stringify({
      version: 1,
      files: [
        {
          path: 'components/pricing/pricing-section.tsx',
          sha256: 'x',
          copy: 'pricing-section.tsx'
        }
      ]
    })
  );
  // An iteration being written, with no entry yet, is not shown.
  fs.mkdirSync(path.join(repo, 'rough/pricing/faq/iteration-01'), { recursive: true });
  return repo;
}

describe('the adopted sections an iteration can be shown in', () => {
  it('lists each component with a baseline on its page, with its iterations and the file each swap renders', async () => {
    const repo = await nextRepo();
    const sections = contextSections(repo, 'index.tsx');
    assert.deepEqual(
      sections.map(section => [section.key, section.address, section.iterations.map(i => i.key)]),
      [
        ['shared/site-header', null, []],
        [
          'pricing/pricing-section',
          '/pricing',
          ['pricing/pricing-section/iteration-01', 'pricing/pricing-section/iteration-02']
        ],
        ['pricing/faq', '/pricing', []]
      ]
    );
    const forks = sections[1]!.iterations;
    assert.equal(forks[0]!.shown, 'rough/pricing/pricing-section/iteration-01/pricing-section.tsx');
    assert.equal(forks[1]!.shown, 'rough/pricing/pricing-section/iteration-02/index.tsx');
  });

  it('lists nothing for a repo with no map', async () => {
    const repo = await tempDir('roughbook-context-');
    write(repo, 'rough/home/hero/iteration-00/index.tsx', 'x');
    assert.deepEqual(contextSections(repo, 'index.tsx'), []);
  });

  it('sees a section at its page, and a shared part at the first page anyone may open', () => {
    assert.equal(contextAddress(NEXT_MAP, { page: 'pricing' }), '/pricing');
    assert.equal(contextAddress(NEXT_MAP, { page: 'shared' }), '/');
    assert.equal(contextAddress(NEXT_MAP, { page: 'blog-slug' }), '/blog/hello');
    const signedIn = { ...NEXT_MAP, pages: [page('account', [], { signIn: 'yes' })] };
    assert.equal(contextAddress(signedIn, { page: 'account' }), null);
  });

  it('asks for a swap, Pick and no markers in the page’s own address, its query kept', () => {
    assert.equal(
      swapAddress('/pricing', { swap: 'pricing/pricing-section/iteration-02' }),
      '/pricing?roughbook-swap=pricing/pricing-section/iteration-02'
    );
    assert.equal(
      swapAddress('/blog/hello?tab=2', { swap: 'blog-slug/post/iteration-01', pick: true }),
      '/blog/hello?tab=2&roughbook-swap=blog-slug/post/iteration-01&roughbook-pick=1'
    );
    assert.equal(swapAddress('/', { markers: false }), '/?roughbook-markers=0');
    assert.equal(swapAddress('/pricing'), '/pricing');
    assert.equal(
      next.contextPreview!.address('/pricing', 'pricing/faq/iteration-01', { pick: true }),
      '/pricing?roughbook-swap=pricing/faq/iteration-01&roughbook-pick=1'
    );
  });

  it('names a marker by the page the request is on, else the first page it is adopted on', () => {
    const keys = [
      { key: 'home/pricing-section', address: '/' },
      { key: 'pricing/pricing-section', address: '/pricing' },
      { key: 'blog-slug/post', address: '/blog/[slug]' }
    ];
    assert.equal(sectionKeyFor(keys, '/pricing'), 'pricing/pricing-section');
    assert.equal(sectionKeyFor(keys, '/pricing/'), 'pricing/pricing-section');
    assert.equal(sectionKeyFor(keys, '/'), 'home/pricing-section');
    assert.equal(sectionKeyFor(keys, '/blog/hello'), 'blog-slug/post');
    assert.equal(sectionKeyFor(keys, '/about'), 'home/pricing-section');
    assert.equal(
      sectionKeyFor([{ key: 'shared/site-header', address: null }], '/x'),
      'shared/site-header'
    );
  });
});

/** The stand-in React the wrappers are bundled with: elements as plain objects, `cache` per request. */
const FAKE_REACT = `export function createElement(type, props, ...children) { return { type, props: props ?? {}, children }; }
export function cache(fn) { return () => { const scope = (globalThis.roughbookRequest ??= {}); scope.cache ??= new Map(); if (!scope.cache.has(fn)) scope.cache.set(fn, fn()); return scope.cache.get(fn); }; }
export function useEffect() {}
`;
/** With useState, the stand-in is a client component's React. */
const CLIENT_REACT = `${FAKE_REACT}export function useState() {}\n`;
const FAKE_STORE = `export const workUnitAsyncStorage = { getStore: () => globalThis.roughbookRequest?.store };\n`;

type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type Wrap = (
  id: string,
  original: (props: Record<string, unknown>) => unknown
) => (props: Record<string, unknown>) => Element;

/** The generated wrapper, bundled with the stand-ins and imported. */
async function bundled(repo: string, file: string, react = FAKE_REACT): Promise<Wrap> {
  write(repo, 'stand-ins/react.js', react);
  write(repo, 'stand-ins/store.js', FAKE_STORE);
  const out = path.join(repo, `bundle-${Math.random().toString(36).slice(2)}.mjs`);
  buildSync({
    entryPoints: [path.join(repo, ...file.split('/'))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
    alias: {
      react: path.join(repo, 'stand-ins/react.js'),
      'next/dist/server/app-render/work-unit-async-storage.external': path.join(
        repo,
        'stand-ins/store.js'
      )
    }
  });
  return ((await import(pathToFileURL(out).href)) as { wrap: Wrap }).wrap;
}

/** One request, as Next.js's request store holds it. */
function request(url: string, host = 'localhost:3000') {
  const parsed = new URL(url, 'http://x');
  (globalThis as Record<string, unknown>).roughbookRequest = {
    store: {
      type: 'request',
      url: { pathname: parsed.pathname, search: parsed.search },
      headers: new Headers({ host })
    }
  };
}

/** Runs `body` with NODE_ENV as given, put back after. */
async function inEnv<T>(value: string, body: () => Promise<T> | T): Promise<T> {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await body();
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
}

/** The keys alone, as the browser wrapper reads them: no iteration is reachable from here. */
const KEYS = `export const modules = {
  "components/pricing/pricing-section.tsx#PricingSection": [{ key: "home/pricing-section", address: "/" }, { key: "pricing/pricing-section", address: "/pricing" }],
};
`;

const REGISTRY = `export const modules = {
  "components/pricing/pricing-section.tsx#PricingSection": [{ key: "home/pricing-section", address: "/" }, { key: "pricing/pricing-section", address: "/pricing" }],
};
export const loaders = { "pricing/pricing-section/iteration-02": async () => ({ default: function Fork() { return "fork"; } }) };
`;

describe('the Next.js switch', () => {
  async function switchRepo(): Promise<string> {
    const repo = await tempDir('roughbook-context-');
    for (const item of contextFiles('app')) write(repo, item.file, item.content);
    write(repo, 'rough/context-registry.ts', REGISTRY);
    write(repo, 'rough/context-keys.ts', KEYS);
    return repo;
  }
  const Original = (props: Record<string, unknown>) => `plans for ${String(props.plan)}`;

  it('swaps the iteration in for the request that asks, with the same props, inside its marker', async () => {
    const repo = await switchRepo();
    const wrap = await bundled(repo, 'app/rough-preview/context/section.tsx');
    await inEnv('development', async () => {
      const Wrapped = wrap('components/pricing/pricing-section.tsx#PricingSection', Original);
      request('/pricing?roughbook-swap=pricing/pricing-section/iteration-02');
      const marker = Wrapped({ plan: 'team' });
      assert.equal(marker.type, 'roughbook-section');
      assert.equal(marker.props['data-roughbook-section'], 'pricing/pricing-section');
      assert.equal(marker.props['data-roughbook-swap'], 'pricing/pricing-section/iteration-02');
      assert.deepEqual(marker.props.style, { display: 'contents' });
      const shown = marker.children[0] as Element;
      assert.notEqual(shown.type, Original);
      assert.deepEqual(shown.props.props, { plan: 'team' });
      // The iteration itself, loaded and rendered with the page's props.
      const rendered = (await (shown.type as (p: unknown) => Promise<Element>)(
        shown.props
      )) as Element;
      assert.equal((rendered.type as () => string)(), 'fork');
      assert.deepEqual(rendered.props, { plan: 'team' });
      // Once a request: a second instance (or the original inside the iteration) is the app's.
      const again = Wrapped({ plan: 'team' });
      assert.equal((again.children[0] as Element).type, Original);
    });
  });

  it('without the parameter renders the app’s own component, marked by the page the request is on', async () => {
    const repo = await switchRepo();
    const wrap = await bundled(repo, 'app/rough-preview/context/section.tsx');
    await inEnv('development', () => {
      const Wrapped = wrap('components/pricing/pricing-section.tsx#PricingSection', Original);
      request('/');
      const marker = Wrapped({ plan: 'free' });
      assert.equal(marker.props['data-roughbook-section'], 'home/pricing-section');
      assert.equal(marker.props['data-roughbook-swap'], undefined);
      assert.equal((marker.children[0] as Element).type, Original);
      // A swap for another page's section leaves this one alone.
      request('/?roughbook-swap=pricing/pricing-section/iteration-02');
      assert.equal((Wrapped({}).children[0] as Element).type, Original);
      // With the markers off, the component alone, as the page has it.
      request('/pricing?roughbook-markers=0');
      const plain = Wrapped({ plan: 'free' });
      assert.equal(plain.type, Original);
      assert.deepEqual(plain.props, { plan: 'free' });
      // A module nothing adopted is left as it is.
      request('/pricing');
      assert.equal(wrap('components/other.tsx#Other', Original)({}).type, Original);
    });
  });

  it('answers this machine only: a request addressed to the network gets the app’s component, unmarked', async () => {
    const repo = await switchRepo();
    const wrap = await bundled(repo, 'app/rough-preview/context/section.tsx');
    await inEnv('development', () => {
      const Wrapped = wrap('components/pricing/pricing-section.tsx#PricingSection', Original);
      request('/pricing?roughbook-swap=pricing/pricing-section/iteration-02', '192.168.1.37:3000');
      const shown = Wrapped({ plan: 'team' });
      assert.equal(shown.type, Original);
      request('/pricing', '127.0.0.1:3000');
      assert.equal(Wrapped({}).type, 'roughbook-section');
    });
  });

  it('is the app’s own component outside development, and never swaps in a client component’s render', async () => {
    const repo = await switchRepo();
    const wrap = await bundled(repo, 'app/rough-preview/context/section.tsx');
    await inEnv('production', () => {
      assert.equal(
        wrap('components/pricing/pricing-section.tsx#PricingSection', Original),
        Original
      );
    });
    const client = await bundled(repo, 'app/rough-preview/context/section.tsx', CLIENT_REACT);
    await inEnv('development', () => {
      request('/pricing?roughbook-swap=pricing/pricing-section/iteration-02');
      const marker = client('components/pricing/pricing-section.tsx#PricingSection', Original)({});
      assert.equal(marker.type, 'roughbook-section');
      assert.equal((marker.children[0] as Element).type, Original);
    });
  });

  it('marks the same in the browser, by the page’s own address', async () => {
    const repo = await switchRepo();
    const wrap = await bundled(repo, 'app/rough-preview/context/section-browser.tsx');
    const globals = globalThis as Record<string, unknown>;
    await inEnv('development', () => {
      globals.window = { location: new URL('http://localhost:3000/pricing') };
      try {
        const marker = wrap('components/pricing/pricing-section.tsx#PricingSection', Original)({});
        assert.equal(marker.props['data-roughbook-section'], 'pricing/pricing-section');
        globals.window = { location: new URL('http://192.168.1.37:3000/pricing') };
        assert.equal(
          wrap('components/pricing/pricing-section.tsx#PricingSection', Original)({}).type,
          Original
        );
      } finally {
        delete globals.window;
      }
    });
  });

  it('keeps every iteration out of the browser wrapper’s graph, so a server-only one never compiles there', async () => {
    const repo = await switchRepo();
    // A server-only iteration, as B6's integration had one: an async server component whose data
    // has an inline "use cache", which Turbopack refuses in a client component's graph.
    write(
      repo,
      'rough/context-registry.ts',
      `${KEYS}export const loaders = { "pricing/pricing-section/iteration-03": () => import("./pricing/pricing-section/iteration-03/index") };\n`
    );
    write(
      repo,
      'rough/pricing/pricing-section/iteration-03/index.tsx',
      'async function plans() { "use cache"; return []; }\nexport default async function Fork() { return (await plans()).length; }\n'
    );
    write(repo, 'stand-ins/react.js', FAKE_REACT);
    const result = buildSync({
      entryPoints: [path.join(repo, 'app/rough-preview/context/section-browser.tsx')],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      metafile: true,
      logLevel: 'silent',
      alias: { react: path.join(repo, 'stand-ins/react.js') }
    });
    const inputs = Object.keys(result.metafile.inputs);
    assert.ok(
      inputs.some(file => file.endsWith('rough/context-keys.ts')),
      inputs.join(', ')
    );
    assert.ok(!inputs.some(file => /context-registry|iteration-\d+/.test(file)), inputs.join(', '));
    // The server's wrapper keeps the registry, with its loaders.
    const server = contextFiles('app').find(item => item.file.endsWith('/section.tsx'))!.content;
    assert.match(
      server,
      /import \{ loaders, modules \} from "\.\.\/\.\.\/\.\.\/rough\/context-registry";/
    );
  });

  it('Pick posts the section a click fell in, instead of following the page', async () => {
    const pick = contextFiles('app').find(item => item.file.endsWith('pick.tsx'))!.content;
    assert.match(pick, /^"use client";/);
    assert.match(
      pick,
      /new URLSearchParams\(window\.location\.search\)\.get\("roughbook-pick"\) !== "1"/
    );
    assert.match(pick, /event\.preventDefault\(\);/);
    assert.match(pick, /closest\("\[data-roughbook-section\]"\)/);
    assert.match(pick, /postMessage\(\{ roughbook: "section", key \}, "\*"\)/);
  });

  it('every file of the switch holds the gate’s sentinel', () => {
    assert.equal(next.contextPreview!.sentinel, CONTEXT_SENTINEL);
    for (const item of contextFiles('src/app'))
      assert.ok(item.content.includes(CONTEXT_SENTINEL), item.file);
  });

  it('the loader wraps an adopted module’s export and leaves every other file as it is', async () => {
    const repo = await switchRepo();
    write(
      repo,
      CONTEXT_MODULES,
      JSON.stringify({
        'components/pricing/pricing-section.tsx': 'PricingSection',
        'components/home/hero.tsx': 'default'
      })
    );
    const loader = createRequire(import.meta.url)(
      path.join(repo, 'app/rough-preview/context/loader.cjs')
    ) as (this: unknown, source: string) => string;
    const watched: string[] = [];
    const run = (file: string, source: string, browser = false) =>
      loader.call(
        {
          getOptions: () => ({ browser }),
          addDependency: (dep: string) => watched.push(dep),
          resourcePath: path.join(repo, ...file.split('/'))
        },
        source
      );
    const source = 'export async function PricingSection() {}\nexport default PricingSection;\n';
    const wrapped = run('components/pricing/pricing-section.tsx', source);
    assert.equal(
      wrapped,
      [
        'import * as RoughbookOriginal from "./pricing-section.tsx?roughbook-original";',
        'import { wrap as roughbookWrap } from "../../app/rough-preview/context/section";',
        'export * from "./pricing-section.tsx?roughbook-original";',
        'export const PricingSection = roughbookWrap("components/pricing/pricing-section.tsx#PricingSection", RoughbookOriginal["PricingSection"]);',
        'export { default } from "./pricing-section.tsx?roughbook-original";',
        ''
      ].join('\n')
    );
    assert.match(
      run('components/home/hero.tsx', 'export default function Hero() {}', true),
      /export default roughbookWrap\("components\/home\/hero\.tsx#default", RoughbookOriginal\["default"\]\);\n$/
    );
    assert.match(run('components/home/hero.tsx', 'x', true), /context\/section-browser"/);
    assert.equal(
      run('components/other.tsx', 'export const Other = 1;\n'),
      'export const Other = 1;\n'
    );
    assert.ok(watched.every(file => file === path.join(repo, 'rough', 'context-modules.json')));
    fs.rmSync(path.join(repo, CONTEXT_MODULES));
    assert.equal(run('components/pricing/pricing-section.tsx', source), source);
  });

  it('generates the registry of adopted modules and their iterations, and the loader’s list', async () => {
    const repo = await nextRepo();
    const { registry, modules, keys } = renderContext(contextSections(repo, 'index.tsx'));
    // The browser's keys: the same modules, and nothing that loads an iteration.
    assert.match(
      keys,
      /"components\/pricing\/pricing-section\.tsx#PricingSection": \[\{"key":"pricing\/pricing-section", "address":"\/pricing"\}\],/
    );
    assert.doesNotMatch(keys, /import\(|loaders|iteration-/);
    assert.match(
      registry,
      /"components\/pricing\/pricing-section\.tsx#PricingSection": \[\{"key":"pricing\/pricing-section", "address":"\/pricing"\}\],/
    );
    assert.match(
      registry,
      /"components\/layout\/site-header\.tsx#SiteHeader": \[\{"key":"shared\/site-header", "address":null\}\],/
    );
    assert.match(
      registry,
      /"pricing\/pricing-section\/iteration-01": \(\) => import\("\.\/pricing\/pricing-section\/iteration-01\/index"\),/
    );
    assert.doesNotMatch(registry, /iteration-00/);
    assert.deepEqual(JSON.parse(modules), {
      'components/layout/site-header.tsx': 'SiteHeader',
      'components/pricing/pricing-section.tsx': 'PricingSection',
      'components/pricing/faq.tsx': 'Faq'
    });
    // The studio rewrites them as iterations change, as it does the preview registry.
    next.syncPreview(repo);
    assert.equal(read(repo, CONTEXT_REGISTRY), registry);
    assert.equal(read(repo, CONTEXT_MODULES), modules);
    assert.equal(read(repo, CONTEXT_KEYS), keys);
  });
});

const CONFIG = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
};

export default nextConfig;
`;

describe('next.config’s edit', () => {
  it('adds the import and the development-only rule, and its undo gives the file back exactly', () => {
    const edited = editNextConfig(CONFIG, 'next.config.ts', 'app')!;
    assert.match(
      edited,
      /^import type \{ NextConfig \} from "next";\nimport \{ existsSync as roughbookExists \} from "node:fs";\n/
    );
    assert.match(edited, /if \(roughbookExists\("app\/rough-preview\/context\/loader\.cjs"\)\) \{/);
    assert.match(edited, /const roughbookConfig: import\("next"\)\.NextConfig = nextConfig;/);
    assert.match(edited, /"development" as const,/);
    assert.match(edited, /\{ not: \{ path: \/\^\(\?:rough\|app\\\/rough-preview\)\\\/\/ \} \},/);
    assert.match(edited, /turbopackLazyDynamicImportsSSR: true/);
    assert.match(edited, /"\*\.\{tsx,jsx,js\}": \[roughbookRule\(false\), roughbookRule\(true\)\]/);
    assert.equal(undoNextConfig(edited), CONFIG);
    assert.equal(editNextConfig(edited, 'next.config.ts', 'app'), null);
    assert.equal(undoNextConfig(CONFIG), null);
  });

  it('writes the block as pinned here, with Turbopack’s development cache off (decision 67)', () => {
    const edited = editNextConfig(CONFIG, 'next.config.ts', 'app')!;
    const block = edited.slice(edited.indexOf('// Roughbook, development only'));
    assert.equal(
      block,
      `// Roughbook, development only: the in-page view: shows an iteration in its real page and marks the page's
// sections (rough/CONTRACT.md). Its rules apply in \`next dev\` alone, and only once the files beside the
// preview route are there; roughbook uninstall takes this out.
if (roughbookExists("app/rough-preview/context/loader.cjs")) {
  const roughbookConfig: import("next").NextConfig = nextConfig;
  const roughbookRule = (browser: boolean) => ({
    condition: {
      all: [
        "development" as const,
        { not: "foreign" as const },
        browser ? "browser" as const : { not: "browser" as const },
        { not: { path: /^(?:rough|app\\/rough-preview)\\// } },
        { not: { query: /roughbook-original/ } },
      ],
    },
    loaders: [{ loader: "./app/rough-preview/context/loader.cjs", options: { browser } }],
  });
  // An iteration is compiled only when a page asks to show it, so one that does not compile never breaks a page.
  // Without the development cache: next dev restarted onto it after files changed can lose such an import
  // ("Lazily compiled dynamic import ... was not activated"). next build keeps its own.
  roughbookConfig.experimental = {
    ...roughbookConfig.experimental,
    ...{ turbopackLazyDynamicImportsSSR: true, turbopackFileSystemCacheForDev: false },
  };
  roughbookConfig.turbopack = {
    ...roughbookConfig.turbopack,
    rules: { ...roughbookConfig.turbopack?.rules, "*.{tsx,jsx,js}": [roughbookRule(false), roughbookRule(true)] },
  };
}
`
    );
  });

  it('rewrites a block written before the cache setting on setup --upgrade, and uninstall takes the new one out', async () => {
    const repo = await nextRepo();
    const current = editNextConfig(CONFIG, 'next.config.ts', 'app')!;
    // The block as version 7 wrote it: the lazy imports alone.
    const old = current
      .replace(/\n {2}\/\/ Without the development cache[^\n]*\n[^\n]*\n/, '\n')
      .replace(
        /roughbookConfig\.experimental = \{\n[^\n]*\n[^\n]*\n {2}\};/,
        'roughbookConfig.experimental = { ...roughbookConfig.experimental, ...{ turbopackLazyDynamicImportsSSR: true } };'
      );
    assert.notEqual(old, current);
    assert.doesNotMatch(old, /turbopackFileSystemCacheForDev/);
    write(repo, 'next.config.ts', old);
    const planned = planNextConfig(repo, 'app');
    assert.ok(planned && 'after' in planned, JSON.stringify(planned));
    assert.equal(planned.summary, 'Update the in-page view’s rule.');
    assert.equal(planned.after, current);
    assert.equal(undoNextConfig(current), CONFIG);
    assert.equal(next.version, 8);
  });

  it('keeps the file’s line endings, and writes CommonJS and plain JavaScript as such', () => {
    const crlf = CONFIG.replace(/\n/g, '\r\n');
    const edited = editNextConfig(crlf, 'next.config.ts', 'src/app')!;
    assert.ok(!/[^\r]\n/.test(edited));
    assert.match(edited, /src\/app\/rough-preview\/context\/loader\.cjs/);
    assert.equal(undoNextConfig(edited), crlf);
    const cjs = `/** @type {import('next').NextConfig} */\nconst config = { reactStrictMode: true };\n\nmodule.exports = config;\n`;
    const js = editNextConfig(cjs, 'next.config.js', 'app')!;
    assert.match(js, /const \{ existsSync: roughbookExists \} = require\("node:fs"\);/);
    assert.doesNotMatch(js, /as const|: boolean|import\("next"\)/);
    assert.match(js, /const roughbookConfig = config;/);
    assert.equal(undoNextConfig(js), cjs);
  });

  it('knows its edit after a formatter went over it, and takes it out whole', async () => {
    // As prettier with singleQuote writes it: other quotes, the long rules line broken.
    const formatted = editNextConfig(CONFIG, 'next.config.ts', 'app')!
      .replaceAll('"', "'")
      .replace(
        "rules: { ...roughbookConfig.turbopack?.rules, '*.{tsx,jsx,js}': [roughbookRule(false), roughbookRule(true)] },",
        "rules: {\n      ...roughbookConfig.turbopack?.rules,\n      '*.{tsx,jsx,js}': [roughbookRule(false), roughbookRule(true)],\n    },"
      );
    assert.equal(undoNextConfig(formatted), CONFIG.replaceAll('"', "'"));
    const repo = await nextRepo();
    write(repo, 'next.config.ts', formatted);
    assert.equal(planNextConfig(repo, 'app'), null);
    // Without semicolons, CommonJS too.
    const cjs = 'const config = { reactStrictMode: true }\n\nmodule.exports = config\n';
    const js = editNextConfig(cjs, 'next.config.js', 'app')!.replace(
      'const { existsSync: roughbookExists } = require("node:fs");',
      "const { existsSync: roughbookExists } = require('node:fs')"
    );
    assert.equal(undoNextConfig(js), cjs);
  });

  it('asks for it by hand when the config exports no variable it can extend', async () => {
    const repo = await tempDir('roughbook-context-');
    write(repo, 'next.config.mjs', 'export default { reactStrictMode: true };\n');
    const planned = planNextConfig(repo, 'app');
    assert.ok(planned && 'manual' in planned && /next\.config\.mjs/.test(planned.manual));
  });

  it('is planned with the switch’s files for a mapped repo only, and uninstall’s list has them', async () => {
    const repo = await nextRepo();
    const plan = planPrep(repo, { link: LINK, recipe: next });
    const files = plan.changes.map(change => change.file);
    for (const item of contextFiles('app')) assert.ok(files.includes(item.file), item.file);
    assert.ok(files.includes('next.config.ts'));
    for (const file of contextFiles('app')) {
      assert.ok(next.setupFiles(repo, LINK).includes(file.file));
    }
    assert.deepEqual(
      next.edits!(repo, LINK).map(edit => edit.file),
      ['next.config.ts']
    );
    assert.ok(next.generatedFiles.includes(CONTEXT_REGISTRY));
    assert.ok(next.generatedFiles.includes(CONTEXT_MODULES));
    assert.ok(next.generatedFiles.includes(CONTEXT_KEYS));
    assert.ok(next.contextPreview!.generated.includes(CONTEXT_KEYS));

    const plain = await tempDir('roughbook-context-');
    write(plain, 'app/layout.tsx', 'x');
    write(plain, 'next.config.ts', CONFIG);
    const before = planPrep(plain, { link: LINK, recipe: next }).changes.map(change => change.file);
    assert.ok(!before.includes('next.config.ts'));
    assert.ok(!before.some(file => file.includes('rough-preview/context/')));
    assert.ok(!next.setupFiles(plain, LINK).some(file => file.includes('/context/')));
    next.syncPreview(plain);
    assert.ok(!fs.existsSync(path.join(plain, CONTEXT_REGISTRY)));
  });
});

const BLADE_MAP: RepoMap = {
  version: 1,
  by: ['laravel'],
  pages: [
    page('shared', ['site-footer']),
    page('pricing', ['pricing']),
    page('blog-post', ['post'], { address: '/blog/{post}' })
  ],
  components: [
    component('site-footer', ['resources/views/components/site-footer.blade.php'], {
      kind: 'shared',
      export: 'x-site-footer'
    }),
    component('pricing', ['resources/views/sections/pricing.blade.php'], {
      export: 'view sections.pricing'
    }),
    component('post', ['resources/views/livewire/post.blade.php'], { export: 'livewire post' })
  ],
  missed: [],
  unplaced: []
};

describe('the Laravel switch', () => {
  async function bladeRepo(): Promise<string> {
    const repo = await tempDir('roughbook-context-');
    writeMap(repo, BLADE_MAP);
    write(repo, 'routes/web.php', '<?php\n');
    for (const key of [
      'pricing/pricing/iteration-00',
      'pricing/pricing/iteration-01',
      'shared/site-footer/iteration-00',
      'blog-post/post/iteration-00'
    ]) {
      write(repo, `rough/${key}/index.blade.php`, '<p>x</p>\n');
    }
    return repo;
  }

  it('lists each adopted view by the name Blade renders it by, with the file each swap renders', async () => {
    const repo = await bladeRepo();
    const sections = contextSections(repo, 'index.blade.php');
    assert.deepEqual(sections.map(viewName), ['components.site-footer', 'sections.pricing', null]);
    assert.deepEqual(JSON.parse(renderContextList(sections)), {
      views: {
        'components.site-footer': [{ key: 'shared/site-footer', address: null }],
        'sections.pricing': [{ key: 'pricing/pricing', address: '/pricing' }]
      },
      iterations: {
        'pricing/pricing/iteration-01': 'rough/pricing/pricing/iteration-01/index.blade.php'
      }
    });
    laravel.syncPreview(repo);
    assert.equal(read(repo, CONTEXT_LIST), renderContextList(sections));
  });

  it('adds the switch after the route and its marker beside it, for a mapped app only', async () => {
    const repo = await bladeRepo();
    const plan = planPrep(repo, { link: LINK, recipe: laravel });
    const route = plan.changes.find(change => change.file === ROUTE_FILE)!;
    assert.equal(route.after, `${PREVIEW_ROUTE}${CONTEXT_BLOCK}`);
    assert.equal(
      plan.changes.find(change => change.file === SECTION_TEMPLATE)?.after,
      SECTION_FILE
    );
    assert.deepEqual(laravel.setupFiles(repo, LINK), [ROUTE_FILE, SECTION_TEMPLATE]);
    assert.ok(laravel.generatedFiles.includes(CONTEXT_LIST));
    // For this machine only, the swap once a section, the markers off on asking, Pick once a page.
    assert.match(
      CONTEXT_BLOCK,
      /in_array\(\$request->getHost\(\), \['localhost', '127\.0\.0\.1', '\[::1\]', '::1'\], true\)/
    );
    assert.match(CONTEXT_BLOCK, /! isset\(\$swapped\[\$key\]\)/);
    assert.match(CONTEXT_BLOCK, /query\('roughbook-markers'\) !== '0'/);
    assert.match(
      SECTION_FILE,
      /<roughbook-section data-roughbook-section="'\.e\(\$__roughbook\['key'\]\)/
    );
    assert.match(SECTION_FILE, /style="display: contents"/);
    assert.match(
      SECTION_FILE,
      /postMessage\(\{roughbook:'section',key:s\.getAttribute\('data-roughbook-section'\)\},'\*'\)/
    );
    assert.ok(CONTEXT_BLOCK.includes(CONTEXT_SENTINEL) && SECTION_FILE.includes(CONTEXT_SENTINEL));

    const plain = await tempDir('roughbook-context-');
    write(plain, 'routes/web.php', '<?php\n');
    const before = planPrep(plain, { link: LINK, recipe: laravel });
    assert.equal(before.changes.find(change => change.file === ROUTE_FILE)?.after, PREVIEW_ROUTE);
    assert.ok(!before.changes.some(change => change.file === SECTION_TEMPLATE));
    assert.deepEqual(laravel.setupFiles(plain, LINK), [ROUTE_FILE]);
  });

  it('writes PHP that parses, where PHP is on this machine', async t => {
    let php = true;
    try {
      execFileSync('php', ['-v'], { stdio: 'ignore' });
    } catch {
      php = false;
    }
    if (!php) return t.skip('PHP is not on the PATH');
    const repo = await tempDir('roughbook-context-');
    write(repo, 'route.php', `${PREVIEW_ROUTE}${CONTEXT_BLOCK}`);
    write(repo, 'section.php', SECTION_FILE);
    for (const file of ['route.php', 'section.php']) {
      assert.match(
        execFileSync('php', ['-l', path.join(repo, file)], { encoding: 'utf8' }),
        /No syntax errors/
      );
    }
  });
});
