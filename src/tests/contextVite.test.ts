// The in-page view's switch for Vite with React (ROUGHBOOK-BROWNFIELD-PLAN.md, B5b, decisions 41
// and 42): the plugin's transform and the browser's wrapper run as written (the wrapper bundled with
// a stand-in React), the edit in vite.config and its undo, and the setup planned for a mapped repo
// alone (ground rule 2). The swap in a real page is the conformance suite's (the vite fixture).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { buildSync } from 'esbuild';
import { writeMap } from '../map/file.js';
import type { MapComponent, MapPage } from '../map/types.js';
import { CONTEXT_SENTINEL, contextSections } from '../recipes/context.js';
import { recipeFor } from '../recipes/index.js';
import {
  CONTEXT_MODULES,
  CONTEXT_PLUGIN,
  CONTEXT_SECTION,
  contextFiles,
  editViteConfig,
  planViteConfig,
  renderModules,
  undoViteConfig
} from '../recipes/vite/context.js';
import { applyPrep, planPrep } from '../repo/prep.js';
import { contextCheck } from '../doctor/context.js';
import type { DoctorTools } from '../doctor/types.js';
import { fakeServer, type FakeServer } from './devServer.js';
import { tempDir } from './helpers.js';

const vite = recipeFor('vite')!;
const LINK = { version: 1 as const, orgId: 'org-1', project: 'site', roughCommitted: true };

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

const page = (slug: string, address: string | null, sections: string[]): MapPage => ({
  slug,
  name: slug,
  address,
  example: null,
  signIn: 'no',
  files: [],
  sections,
  byAgent: false
});
const component = (slug: string, file: string, exported: string): MapComponent => ({
  slug,
  name: slug,
  kind: 'section',
  files: [file],
  export: exported,
  fixture: null,
  alone: 'unknown',
  why: null,
  byAgent: false
});

// As create-vite 9 writes it.
const CONFIG = `import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
`;

/** A mapped Vite app with its pricing section adopted, one fork of it, and the hero not adopted. */
async function viteRepo(): Promise<string> {
  const repo = await tempDir('roughbook-context-vite-');
  writeMap(repo, {
    version: 1,
    by: ['vite'],
    pages: [page('home', '/', ['hero', 'pricing']), page('plans', '/plans', ['pricing'])],
    components: [
      component('hero', 'src/components/Hero.tsx', 'Hero'),
      component('pricing', 'src/components/Pricing.tsx', 'Pricing')
    ],
    missed: [],
    unplaced: []
  });
  write(repo, 'index.html', '<script type="module" src="/src/main.tsx"></script>\n');
  write(repo, 'tsconfig.json', '{}\n');
  write(repo, 'vite.config.ts', CONFIG);
  for (const key of ['home/pricing/iteration-00', 'home/pricing/iteration-01']) {
    write(repo, `rough/${key}/index.tsx`, 'export default function X() {\n  return null;\n}\n');
  }
  return repo;
}

describe('the Vite switch, planned', () => {
  it('is planned with its files and the config’s edit for a mapped repo only, and listed for doctor and uninstall', async () => {
    assert.ok(vite.version >= 3);
    const repo = await viteRepo();
    const plan = planPrep(repo, { link: LINK, recipe: vite });
    const files = plan.changes.map(change => change.file);
    assert.ok(files.includes(CONTEXT_PLUGIN) && files.includes(CONTEXT_SECTION));
    assert.ok(files.includes('vite.config.ts'));
    const link = { ...LINK, appDir: null };
    for (const file of [CONTEXT_PLUGIN, CONTEXT_SECTION]) {
      assert.ok(vite.setupFiles(repo, link).includes(file), file);
    }
    assert.deepEqual(
      vite.edits!(repo, link).map(edit => edit.file),
      ['vite.config.ts']
    );
    const hook = vite.contextPreview!;
    assert.deepEqual(hook.missing(repo, link), [CONTEXT_PLUGIN, CONTEXT_SECTION, 'vite.config.ts']);
    assert.ok(vite.generatedFiles.includes(CONTEXT_MODULES));
    assert.equal(hook.sentinel, CONTEXT_SENTINEL);
    assert.equal(hook.browser, true);
    assert.equal(
      hook.address('/plans', 'plans/pricing/iteration-01', { markers: false }),
      '/plans?roughbook-swap=plans/pricing/iteration-01&roughbook-markers=0'
    );

    // Applied, as init and setup --upgrade apply it: the list of adopted modules comes with it.
    applyPrep(plan);
    assert.deepEqual(hook.missing(repo, link), []);
    assert.equal(read(repo, CONTEXT_MODULES), renderModules(contextSections(repo, 'index.tsx')));
    assert.deepEqual(JSON.parse(read(repo, CONTEXT_MODULES)), {
      'src/components/Pricing.tsx': {
        export: 'Pricing',
        sections: [{ key: 'home/pricing', address: '/' }]
      }
    });
    const gitignore = read(repo, '.gitignore');
    for (const file of [CONTEXT_PLUGIN, CONTEXT_SECTION, CONTEXT_MODULES]) {
      assert.ok(gitignore.includes(`/${file}`), file);
    }

    const plain = await tempDir('roughbook-context-vite-');
    write(plain, 'index.html', '<script type="module" src="/src/main.tsx"></script>\n');
    write(plain, 'vite.config.ts', CONFIG);
    const before = planPrep(plain, { link: LINK, recipe: vite }).changes.map(change => change.file);
    assert.ok(!before.includes('vite.config.ts'));
    assert.ok(!before.includes(CONTEXT_PLUGIN));
    assert.deepEqual(vite.setupFiles(plain, link), ['rough-preview.html']);
    vite.syncPreview(plain);
    assert.ok(!fs.existsSync(path.join(plain, CONTEXT_MODULES)));
  });

  it('every file of the switch holds the gate’s sentinel', () => {
    for (const item of contextFiles())
      assert.ok(item.content.includes(CONTEXT_SENTINEL), item.file);
  });
});

describe('vite.config’s edit', () => {
  it('adds the import, the plugin first in plugins and the function that loads it, and its undo gives the file back exactly', () => {
    const edited = editViteConfig(CONFIG)!;
    assert.match(
      edited,
      /^import react from '@vitejs\/plugin-react'\nimport \{ defineConfig \} from 'vite'\nimport \{ existsSync as roughbookExists \} from "node:fs";\n/
    );
    assert.match(edited, /plugins: \[roughbookContext\(\), react\(\)\],/);
    assert.match(edited, /function roughbookContext\(\) \{/);
    assert.match(
      edited,
      /new URL\("\.\/rough\/context-plugin\.mjs", import\.meta\.url\);\n {2}return roughbookExists\(file\) \? import\(\/\* @vite-ignore \*\/ file\.href\)\.then\(\(plugin\) => plugin\.default\(\)\) : null;\n\}\n$/
    );
    assert.equal(undoViteConfig(edited), CONFIG);
    assert.equal(editViteConfig(edited), null);
    assert.equal(undoViteConfig(CONFIG), null);
    const crlf = CONFIG.replace(/\n/g, '\r\n');
    const editedCrlf = editViteConfig(crlf)!;
    assert.ok(!/[^\r]\n/.test(editedCrlf));
    assert.equal(undoViteConfig(editedCrlf), crlf);
  });

  it('puts the plugin in the config’s own plugins, never in a nested list the build runs', () => {
    const nested = `import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  build: {
    rollupOptions: {
      plugins: [visualizer()],
    },
  },
  plugins: [react()],
})
`;
    const edited = editViteConfig(nested)!;
    assert.match(edited, /\n {2}plugins: \[roughbookContext\(\), react\(\)\],/);
    assert.match(edited, /plugins: \[visualizer\(\)\]/);
    assert.equal(undoViteConfig(edited), nested);
  });

  it('knows its edit after a formatter went over it, and takes it out whole', async () => {
    // As prettier with singleQuote and no semicolons writes it, the plugins one per line.
    const formatted = editViteConfig(CONFIG)!
      .replace(
        `import { existsSync as roughbookExists } from "node:fs";`,
        `import { existsSync as roughbookExists } from 'node:fs'`
      )
      .replace(
        'plugins: [roughbookContext(), react()],',
        'plugins: [\n    roughbookContext(),\n    react(),\n  ],'
      )
      .replaceAll('"', "'");
    assert.equal(
      undoViteConfig(formatted),
      CONFIG.replace('plugins: [react()],', 'plugins: [\n    react(),\n  ],')
    );
    const repo = await tempDir('roughbook-context-vite-');
    write(repo, 'vite.config.ts', formatted);
    assert.equal(planViteConfig(repo), null);
  });

  it('asks for it by hand when the config has no plugins list', async () => {
    const repo = await tempDir('roughbook-context-vite-');
    write(repo, 'vite.config.js', 'export default {}\n');
    const planned = planViteConfig(repo);
    assert.ok(planned && 'manual' in planned && /vite\.config\.js/.test(planned.manual));
  });
});

type Plugin = {
  name: string;
  apply: string;
  enforce: string;
  transform(code: string, id: string): { code: string } | null;
  configureServer(server: FakeServer): void;
};

describe('the plugin', () => {
  it('applies to the dev server alone, wraps an adopted module’s export and leaves every other module as it is', async () => {
    const repo = await viteRepo();
    for (const item of contextFiles()) write(repo, item.file, item.content);
    write(
      repo,
      CONTEXT_MODULES,
      JSON.stringify({
        'src/components/Pricing.tsx': {
          export: 'Pricing',
          sections: [{ key: 'home/pricing', address: '/' }]
        },
        'src/components/Hero.tsx': {
          export: 'default',
          sections: [{ key: 'home/hero', address: '/' }]
        }
      })
    );
    const made = (await import(pathToFileURL(path.join(repo, CONTEXT_PLUGIN)).href)) as {
      default: () => Plugin;
    };
    const plugin = made.default();
    assert.equal(plugin.apply, 'serve');
    assert.equal(plugin.enforce, 'pre');
    const id = (file: string) =>
      path
        .join(repo, ...file.split('/'))
        .split(path.sep)
        .join('/');
    const source = 'export function Pricing() {}\nexport default Pricing;\n';
    assert.equal(
      plugin.transform(source, id('src/components/Pricing.tsx'))!.code,
      [
        'import * as RoughbookOriginal from "./Pricing.tsx?roughbook-original";',
        'import { wrap as roughbookWrap } from "../../rough/context-section.tsx";',
        'export * from "./Pricing.tsx?roughbook-original";',
        'export const Pricing = roughbookWrap(RoughbookOriginal["Pricing"], [{"key":"home/pricing","address":"/"}]);',
        'export { default } from "./Pricing.tsx?roughbook-original";',
        ''
      ].join('\n')
    );
    assert.match(
      plugin.transform('export default function Hero() {}', id('src/components/Hero.tsx'))!.code,
      /export default roughbookWrap\(RoughbookOriginal\["default"\], \[\{"key":"home\/hero","address":"\/"\}\]\);\n$/
    );
    assert.equal(
      plugin.transform(source, `${id('src/components/Pricing.tsx')}?roughbook-original`),
      null
    );
    assert.equal(plugin.transform('export const A = 1;', id('src/components/Other.tsx')), null);
  });

  it('wraps a component adopted while the dev server runs, with no restart (decision 61)', async () => {
    const repo = await viteRepo();
    for (const item of contextFiles()) write(repo, item.file, item.content);
    write(repo, CONTEXT_MODULES, '{}\n');
    const made = (await import(pathToFileURL(path.join(repo, CONTEXT_PLUGIN)).href)) as {
      default: () => Plugin;
    };
    const plugin = made.default();
    const faq = path.join(repo, 'src/components/Faq.tsx').split(path.sep).join('/');
    const server = fakeServer({ [faq]: {} });
    plugin.configureServer(server);
    assert.equal(plugin.transform('export function Faq() {}', faq), null);
    write(
      repo,
      CONTEXT_MODULES,
      JSON.stringify({
        'src/components/Faq.tsx': { export: 'Faq', sections: [{ key: 'home/faq', address: '/' }] }
      })
    );
    // The watcher names the file as the OS does: backslashes on Windows.
    server.change(path.join(repo, ...CONTEXT_MODULES.split('/')));
    assert.deepEqual(server.invalidated, [faq]);
    assert.deepEqual(server.sent, [{ type: 'full-reload' }]);
    assert.match(
      plugin.transform('export function Faq() {}', faq)!.code,
      /RoughbookOriginal\["Faq"\]/
    );
  });
});

/** The stand-in React the wrapper is bundled with: elements as plain objects. */
const FAKE_REACT = `export function createElement(type, props, ...children) { return { type, props: props ?? {}, children }; }
export function createContext(value) { return { Provider: "Provider", value }; }
export function useContext() { return globalThis.roughbookAround ?? null; }
export function lazy(load) { return { lazy: load }; }
export const Suspense = "Suspense";
export class Component { constructor(props) { this.props = props; } }
`;

type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type Wrap = (
  original: (props: Record<string, unknown>) => unknown,
  sections: { key: string; address: string | null }[]
) => (props: Record<string, unknown>) => Element;

/** The wrapper as written, with import.meta's development values and the iterations it can find. */
async function wrapper(repo: string, dev = true): Promise<Wrap> {
  write(repo, 'stand-ins/react.js', FAKE_REACT);
  const text = read(repo, CONTEXT_SECTION).replace(
    /import\.meta\.glob\("[^"]+"\)/,
    'globalThis.roughbookIterations'
  );
  write(repo, 'rough/section-for-test.tsx', text);
  const out = path.join(repo, `bundle-${Math.random().toString(36).slice(2)}.mjs`);
  buildSync({
    entryPoints: [path.join(repo, 'rough', 'section-for-test.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
    define: { 'import.meta.env.DEV': String(dev) },
    alias: { react: path.join(repo, 'stand-ins/react.js') }
  });
  return ((await import(pathToFileURL(out).href)) as { wrap: Wrap }).wrap;
}

/** Runs `body` with the page at `url` in a stand-in window. */
async function at<T>(url: string, body: () => Promise<T> | T): Promise<T> {
  const globals = globalThis as Record<string, unknown>;
  globals.window = { location: new URL(url) };
  try {
    return await body();
  } finally {
    delete globals.window;
  }
}

describe('the wrapper in the browser', () => {
  const SECTIONS = [
    { key: 'home/pricing', address: '/' },
    { key: 'plans/pricing', address: '/plans' }
  ];
  const Original = (props: Record<string, unknown>) => `plans: ${String(props.plans)}`;

  async function loaded(dev = true): Promise<Wrap> {
    const repo = await viteRepo();
    for (const item of contextFiles()) write(repo, item.file, item.content);
    (globalThis as Record<string, unknown>).roughbookIterations = {
      './plans/pricing/iteration-02/index.tsx': async () => ({ default: () => 'fork' })
    };
    // The window is read once, as the module loads.
    return at('http://localhost:5173/plans', () => wrapper(repo, dev));
  }

  it('marks the app’s own component by the page the address is, on this machine', async () => {
    const wrap = await loaded();
    await at('http://localhost:5173/plans', () => {
      const marker = wrap(Original, SECTIONS)({ plans: 3 });
      assert.equal(marker.type, 'roughbook-section');
      assert.equal(marker.props['data-roughbook-section'], 'plans/pricing');
      assert.deepEqual(marker.props.style, { display: 'contents' });
      assert.equal(marker.props['data-roughbook-swap'], undefined);
      const own = marker.children[0] as Element;
      assert.equal(own.type, Original);
      assert.deepEqual(own.props, { plans: 3 });
    });
    await at('http://localhost:5173/?roughbook-markers=0', () => {
      assert.equal(wrap(Original, SECTIONS)({}).type, Original);
    });
  });

  it('swaps the iteration in for the address that asks, with the same props, inside its marker', async () => {
    const wrap = await loaded();
    await at('http://localhost:5173/plans?roughbook-swap=plans/pricing/iteration-02', () => {
      const failed = wrap(Original, SECTIONS)({ plans: 3 });
      assert.deepEqual(failed.props, {
        section: 'plans/pricing',
        swap: 'plans/pricing/iteration-02',
        markers: true
      });
      const marker = failed.children[0] as Element;
      assert.equal(marker.props['data-roughbook-swap'], 'plans/pricing/iteration-02');
      const around = marker.children[0] as Element;
      assert.equal(around.type, 'Provider');
      assert.equal(around.props.value, 'plans/pricing');
      const suspense = around.children[0] as Element;
      assert.equal(suspense.type, 'Suspense');
      const shown = suspense.children[0] as Element;
      assert.ok((shown.type as { lazy?: unknown }).lazy);
      assert.deepEqual(shown.props, { plans: 3 });
    });
    // An iteration that renders the original shows it, not itself again.
    (globalThis as Record<string, unknown>).roughbookAround = 'plans/pricing';
    try {
      await at('http://localhost:5173/plans?roughbook-swap=plans/pricing/iteration-02', () => {
        const marker = wrap(Original, SECTIONS)({});
        assert.equal(marker.type, 'roughbook-section');
        assert.equal((marker.children[0] as Element).type, Original);
      });
    } finally {
      delete (globalThis as Record<string, unknown>).roughbookAround;
    }
    // Another section's swap, or an iteration the repo does not have, leaves this one the app's.
    await at('http://localhost:5173/plans?roughbook-swap=home/pricing/iteration-02', () => {
      assert.equal((wrap(Original, SECTIONS)({}).children[0] as Element).type, Original);
    });
    await at('http://localhost:5173/plans?roughbook-swap=plans/pricing/iteration-09', () => {
      assert.equal((wrap(Original, SECTIONS)({}).children[0] as Element).type, Original);
    });
  });

  it('is the app’s own component outside development, and on an address from the network', async () => {
    const production = await loaded(false);
    assert.equal(production(Original, SECTIONS), Original);
    const repo = await viteRepo();
    for (const item of contextFiles()) write(repo, item.file, item.content);
    const network = await at('http://192.168.1.37:5173/plans', () => wrapper(repo));
    assert.equal(network(Original, SECTIONS), Original);
  });

  it('Pick posts the section a click fell in, instead of following the page', () => {
    const section = contextFiles().find(item => item.file === CONTEXT_SECTION)!.content;
    assert.match(section, /get\("roughbook-pick"\) === "1"/);
    assert.match(section, /event\.preventDefault\(\);/);
    assert.match(section, /closest\("\[data-roughbook-section\]"\)/);
    assert.match(section, /postMessage\(\{ roughbook: "section", key \}, "\*"\)/);
  });
});

/** A one-pixel white PNG. */
const WHITE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64'
);

describe('map-context on a page drawn in the browser', () => {
  it('reads the markers from the page the browser shows, not from the HTML the server sent', async () => {
    const repo = await viteRepo();
    applyPrep(planPrep(repo, { link: LINK, recipe: vite }));
    const probed: string[] = [];
    let clock = 0;
    const tools = {
      browser: 'chrome',
      screenshot: async ({ file }: { file: string }) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, WHITE_PNG);
        return true;
      },
      now: () => (clock += 60_000),
      sleep: async () => {},
      // The dev server sends the app's empty shell, whatever is asked.
      fetch: (async () => new Response('<div id="root"></div>')) as typeof fetch,
      probe: async ({ url }: { url: string }) => {
        const asked = new URL(url);
        probed.push(`${asked.pathname}${asked.search}`);
        const swap = asked.searchParams.get('roughbook-swap');
        return {
          shows: true,
          ready: false,
          error: null,
          visibleOverlays: 0,
          exceptions: [],
          text: 'Solo Team Fleet',
          markers: [
            `<roughbook-section data-roughbook-section="home/pricing"${swap ? ` data-roughbook-swap="${swap}"` : ''} style="display: contents;">`
          ]
        };
      }
    } as Partial<DoctorTools> as DoctorTools;
    const found = await contextCheck({
      repoRoot: repo,
      environment: vite.environment(null),
      recipe: vite,
      tools,
      base: 'http://localhost:5173',
      shotsDir: repo,
      gate: { leaked: [], where: 'the production build' },
      link: null
    });
    assert.equal(found.status, 'pass', found.detail);
    assert.match(found.detail, /^1 of 1 iteration of 1 adopted section shown in its page/);
    assert.match(found.detail, /the markers leave 2 pictures the same/);
    assert.deepEqual(probed, ['/', '/?roughbook-swap=home/pricing/iteration-01']);
  });
});
