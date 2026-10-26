// The in-page view's switch for Expo (ROUGHBOOK-BROWNFIELD-PLAN.md, B5b, decisions 41, 42 and 44):
// on the web target alone, Metro's resolver sends the app's imports of an adopted component to a
// generated wrapper, which marks it and, for a swap, renders the iteration in its place with the
// same props. The resolver and the wrapper run as written (the wrapper bundled with stand-ins for
// React, React Native and Expo Router); metro.config's edit and its undo; and nothing of it is
// planned for a repo that maps nothing (ground rule 2).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { buildSync } from 'esbuild';
import { writeMap } from '../map/file.js';
import type { MapComponent, MapPage, RepoMap } from '../map/types.js';
import { CONTEXT_SENTINEL } from '../recipes/context.js';
import {
  CONTEXT_DIR,
  CONTEXT_MODULES,
  METRO_CONFIG,
  METRO_FILE,
  SECTION_FILE,
  contextFiles,
  editMetroConfig,
  planMetroConfig,
  undoMetroConfig,
  writeContext
} from '../recipes/expo/context.js';
import { recipeFor } from '../recipes/index.js';
import { planPrep } from '../repo/prep.js';
import { tempDir } from './helpers.js';

const expo = recipeFor('expo')!;

const LINK = {
  version: 1 as const,
  orgId: 'org-1',
  project: 'app',
  roughCommitted: true,
  appDir: 'src/app'
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

const EXPO_MAP: RepoMap = {
  version: 1,
  by: ['expo'],
  pages: [
    page('shared', ['animated-splash-overlay']),
    page('home', ['hint-row', 'web-badge']),
    page('explore', ['web-badge'])
  ],
  components: [
    component('animated-splash-overlay', ['src/components/animated-icon.tsx'], {
      kind: 'shared',
      export: 'AnimatedSplashOverlay'
    }),
    component('animated-icon', ['src/components/animated-icon.tsx'], {
      kind: 'atom',
      export: 'AnimatedIcon'
    }),
    component('hint-row', ['src/components/hint-row.tsx'], { export: 'HintRow' }),
    component('web-badge', ['src/components/web-badge.tsx'], { export: 'WebBadge' })
  ],
  missed: [],
  unplaced: []
};

const DEFAULT_CONFIG = `const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;
`;

/** A mapped Expo app with the home page's sections adopted, a shared part, and a fork of one. */
async function expoRepo(): Promise<string> {
  const repo = await tempDir('roughbook-context-expo-');
  writeMap(repo, EXPO_MAP);
  write(repo, 'package.json', '{ "dependencies": { "expo": "~58.0.0" } }\n');
  write(repo, 'tsconfig.json', '{}\n');
  write(
    repo,
    'src/app/_layout.tsx',
    'import { Slot } from "expo-router";\n\nexport default function Layout() {\n  return <Slot />;\n}\n'
  );
  write(
    repo,
    'src/components/hint-row.tsx',
    'export function HintRow() {\n  return null;\n}\n\nexport default HintRow;\n'
  );
  write(repo, 'src/components/web-badge.tsx', 'export function WebBadge() {\n  return null;\n}\n');
  write(
    repo,
    'src/components/animated-icon.tsx',
    'export function AnimatedIcon() {\n  return null;\n}\nexport function AnimatedSplashOverlay() {\n  return null;\n}\n'
  );
  // Its web variant, which Metro resolves the same import to on the web target.
  write(
    repo,
    'src/components/animated-icon.web.tsx',
    'export function AnimatedIcon() {\n  return null;\n}\nexport function AnimatedSplashOverlay() {\n  return null;\n}\n'
  );
  for (const key of [
    'home/hint-row/iteration-00',
    'home/hint-row/iteration-01',
    'home/web-badge/iteration-00',
    'shared/animated-splash-overlay/iteration-00'
  ]) {
    write(
      repo,
      `rough/${key}/index.tsx`,
      'export default function Iteration() {\n  return null;\n}\n'
    );
  }
  return repo;
}

describe('the Expo switch’s generated wrappers', () => {
  it('sends each adopted file, and its web variant, to one wrapper that wraps its adopted exports', async () => {
    const repo = await expoRepo();
    assert.equal(writeContext(repo), true);
    const modules = JSON.parse(read(repo, CONTEXT_MODULES)) as Record<string, string>;
    assert.deepEqual(modules, {
      'src/components/animated-icon.tsx': `${CONTEXT_DIR}/src__components__animated-icon.tsx`,
      'src/components/animated-icon.web.tsx': `${CONTEXT_DIR}/src__components__animated-icon.tsx`,
      'src/components/hint-row.tsx': `${CONTEXT_DIR}/src__components__hint-row.tsx`,
      'src/components/web-badge.tsx': `${CONTEXT_DIR}/src__components__web-badge.tsx`
    });
    const hint = read(repo, `${CONTEXT_DIR}/src__components__hint-row.tsx`);
    assert.match(
      hint,
      /import \* as RoughbookOriginal from "\.\.\/\.\.\/src\/components\/hint-row";/
    );
    assert.match(hint, /export \* from "\.\.\/\.\.\/src\/components\/hint-row";/);
    assert.match(
      hint,
      /export const HintRow = roughbookWrap\(RoughbookOriginal\.HintRow, \[\{"key":"home\/hint-row","address":"\/"\}\]\);/
    );
    // The file's default export is kept, which `export *` leaves out.
    assert.match(hint, /export \{ default \} from "\.\.\/\.\.\/src\/components\/hint-row";/);
    assert.ok(hint.includes(CONTEXT_SENTINEL));
    // Shared on every page: no page's address; the atom on no page is not adopted, so not wrapped.
    const icon = read(repo, `${CONTEXT_DIR}/src__components__animated-icon.tsx`);
    assert.match(
      icon,
      /export const AnimatedSplashOverlay = roughbookWrap\(RoughbookOriginal\.AnimatedSplashOverlay, \[\{"key":"shared\/animated-splash-overlay","address":null\}\]\);/
    );
    assert.doesNotMatch(icon, /export const AnimatedIcon/);
    assert.doesNotMatch(read(repo, `${CONTEXT_DIR}/src__components__web-badge.tsx`), /default/);
    // Unchanged, it writes nothing; a component no longer adopted loses its wrapper.
    assert.equal(writeContext(repo), false);
    fs.rmSync(path.join(repo, 'rough/home/web-badge'), { recursive: true });
    assert.equal(writeContext(repo), true);
    assert.ok(!fs.existsSync(path.join(repo, CONTEXT_DIR, 'src__components__web-badge.tsx')));
    assert.ok(expo.setupFiles(repo, LINK).includes(`${CONTEXT_DIR}/src__components__hint-row.tsx`));
  });
});

type Resolution = { type: string; filePath?: string } | null;
type Context = {
  dev: boolean;
  originModulePath: string;
  resolveRequest: (context: Context, name: string, platform: string | null) => Resolution;
};
type MetroConfig = {
  resolver?: {
    resolveRequest?: (context: Context, name: string, platform: string | null) => Resolution;
  };
};

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

describe('the Expo switch’s resolver', () => {
  async function resolverRepo() {
    const repo = await expoRepo();
    for (const item of contextFiles()) write(repo, item.file, item.content);
    writeContext(repo);
    const require = createRequire(import.meta.url);
    const withContext = require(path.join(repo, ...METRO_FILE.split('/'))) as (
      config: MetroConfig | Promise<MetroConfig>
    ) => MetroConfig | Promise<MetroConfig>;
    const abs = (file: string) => path.join(repo, ...file.split('/'));
    // What Expo's own resolver answers: the file the name points at.
    const context = (origin: string, dev = true): Context => ({
      dev,
      originModulePath: abs(origin),
      resolveRequest: (_context, name) => ({
        type: 'sourceFile',
        filePath: abs(name.replace(/^@\//, 'src/'))
      })
    });
    return { repo, withContext, abs, context };
  }

  it('sends an adopted file to its wrapper on the web target in development alone', async () => {
    const { withContext, abs, context } = await resolverRepo();
    await inEnv('development', () => {
      const config = withContext({}) as MetroConfig;
      const resolve = config.resolver!.resolveRequest!;
      const hint = 'src/components/hint-row.tsx';
      const wrapper = abs(`${CONTEXT_DIR}/src__components__hint-row.tsx`);
      assert.equal(
        resolve(context('src/app/index.tsx'), `@/components/hint-row.tsx`, 'web')!.filePath,
        wrapper
      );
      // The web variant too.
      assert.equal(
        resolve(context('src/app/index.tsx'), '@/components/animated-icon.web.tsx', 'web')!
          .filePath,
        abs(`${CONTEXT_DIR}/src__components__animated-icon.tsx`)
      );
      // Native gets the app's own file, as does a production bundle and any file not adopted.
      assert.equal(resolve(context('src/app/index.tsx'), hint, 'ios')!.filePath, abs(hint));
      assert.equal(resolve(context('src/app/index.tsx'), hint, 'android')!.filePath, abs(hint));
      assert.equal(resolve(context('src/app/index.tsx', false), hint, 'web')!.filePath, abs(hint));
      assert.equal(
        resolve(context('src/app/index.tsx'), 'src/components/other.tsx', 'web')!.filePath,
        abs('src/components/other.tsx')
      );
      // The wrapper itself, and every iteration, import the app's real file.
      assert.equal(
        resolve(context(`${CONTEXT_DIR}/src__components__hint-row.tsx`), hint, 'web')!.filePath,
        abs(hint)
      );
      assert.equal(
        resolve(context('rough/home/hint-row/iteration-01/index.tsx'), hint, 'web')!.filePath,
        abs(hint)
      );
    });
  });

  it('keeps the app’s own resolver first, follows a config given as a promise, and is nothing in production', async () => {
    const { withContext, abs, context } = await resolverRepo();
    await inEnv('development', async () => {
      const seen: string[] = [];
      const own: MetroConfig = {
        resolver: {
          resolveRequest: (ctx, name, platform) => {
            seen.push(name);
            return ctx.resolveRequest(ctx, name, platform);
          }
        }
      };
      const config = (await withContext(Promise.resolve(own))) as MetroConfig;
      assert.equal(
        config.resolver!.resolveRequest!(
          context('src/app/index.tsx'),
          'src/components/hint-row.tsx',
          'web'
        )!.filePath,
        abs(`${CONTEXT_DIR}/src__components__hint-row.tsx`)
      );
      assert.deepEqual(seen, ['src/components/hint-row.tsx']);
    });
    await inEnv('production', () => {
      const config: MetroConfig = { resolver: {} };
      assert.equal(withContext(config), config);
    });
  });
});

const FAKE_REACT = `export function createElement(type, props, ...children) { return { type, props: props ?? {}, children }; }
export function useEffect() {}
`;
const FAKE_NATIVE = `export const Platform = { get OS() { return globalThis.roughbookPlatform ?? "web"; } };\n`;
const FAKE_ROUTER = `export function useGlobalSearchParams() { return Object.fromEntries(new URL(globalThis.roughbookUrl, "http://x").searchParams); }
export function usePathname() { return new URL(globalThis.roughbookUrl, "http://x").pathname; }
`;
const FAKE_REGISTRY = `export const loaders = { "home/hint-row/iteration-01": () => ({ default: function Fork() { return "fork"; } }) };\n`;

type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type Wrap = (
  original: (props: Record<string, unknown>) => unknown,
  keys: { key: string; address: string | null }[]
) => (props: Record<string, unknown>) => Element;

/** The switch's wrapper, bundled with the stand-ins and imported, with __DEV__ as given. */
async function bundled(repo: string, dev = true): Promise<Wrap> {
  write(repo, 'stand-ins/react.js', FAKE_REACT);
  write(repo, 'stand-ins/native.js', FAKE_NATIVE);
  write(repo, 'stand-ins/router.js', FAKE_ROUTER);
  write(repo, 'rough/preview-registry.ts', FAKE_REGISTRY);
  const out = path.join(repo, `bundle-${Math.random().toString(36).slice(2)}.mjs`);
  buildSync({
    entryPoints: [path.join(repo, ...SECTION_FILE.split('/'))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
    define: { __DEV__: String(dev) },
    alias: {
      react: path.join(repo, 'stand-ins/react.js'),
      'react-native': path.join(repo, 'stand-ins/native.js'),
      'expo-router': path.join(repo, 'stand-ins/router.js')
    }
  });
  return ((await import(pathToFileURL(out).href)) as { wrap: Wrap }).wrap;
}

const KEYS = [
  { key: 'home/hint-row', address: '/' },
  { key: 'explore/hint-row', address: '/explore' }
];

/** The page asked for, and the browser's address when given (none: the dev server's own render). */
function at(url: string, browser: string | null = null) {
  const globals = globalThis as Record<string, unknown>;
  globals.roughbookUrl = url;
  if (browser) globals.window = { location: new URL(browser) };
  else delete globals.window;
}

describe('the Expo switch’s wrapper', () => {
  async function switchRepo(): Promise<string> {
    const repo = await tempDir('roughbook-context-expo-');
    for (const item of contextFiles()) write(repo, item.file, item.content);
    return repo;
  }
  const Original = (props: Record<string, unknown>) => `hint ${String(props.title)}`;

  it('swaps the iteration in for the request that asks, with the same props, inside its marker', async () => {
    const wrap = await bundled(await switchRepo());
    const Wrapped = wrap(Original, KEYS);
    for (const browser of [
      null,
      'http://localhost:8081/?roughbook-swap=home/hint-row/iteration-01'
    ]) {
      at('/?roughbook-swap=home/hint-row/iteration-01', browser);
      const marker = Wrapped({ title: 'Try editing' });
      assert.equal(marker.type, 'roughbook-section');
      assert.equal(marker.props['data-roughbook-section'], 'home/hint-row');
      assert.equal(marker.props['data-roughbook-swap'], 'home/hint-row/iteration-01');
      assert.deepEqual(marker.props.style, { display: 'contents' });
      const shown = marker.children[0] as Element;
      assert.notEqual(shown.type, Original);
      const rendered = (shown.type as (p: unknown) => Element)(shown.props);
      assert.equal((rendered.type as () => string)(), 'fork');
      assert.deepEqual(rendered.props, { title: 'Try editing' });
      // Every instance on the page, the same on the server and in the browser, so hydration agrees.
      assert.equal(Wrapped({}).props['data-roughbook-swap'], 'home/hint-row/iteration-01');
    }
    at('/');
  });

  it('without the parameter renders the app’s own component, marked by the page it is on', async () => {
    const wrap = await bundled(await switchRepo());
    const Wrapped = wrap(Original, KEYS);
    at('/explore');
    const marker = Wrapped({ title: 'x' });
    assert.equal(marker.props['data-roughbook-section'], 'explore/hint-row');
    assert.equal(marker.props['data-roughbook-swap'], undefined);
    assert.equal((marker.children[0] as Element).type, Original);
    // A swap for another page's section, or one with no iteration, leaves it alone.
    at('/explore?roughbook-swap=home/hint-row/iteration-01');
    assert.equal((Wrapped({}).children[0] as Element).type, Original);
    at('/?roughbook-swap=home/hint-row/iteration-09');
    assert.equal((Wrapped({}).children[0] as Element).type, Original);
    // With the markers off, the component alone, as the page has it.
    at('/?roughbook-markers=0');
    const plain = Wrapped({ title: 'x' });
    assert.equal(plain.type, Original);
    assert.deepEqual(plain.props, { title: 'x' });
    // Inside the preview route, where iterations show alone, nothing is marked.
    at('/rough-preview/home/hint-row/iteration-00');
    assert.equal(Wrapped({}).type, Original);
    at('/');
  });

  it('answers this machine only, on the web alone, and is the app’s own component outside development', async () => {
    const repo = await switchRepo();
    const wrap = await bundled(repo);
    at(
      '/?roughbook-swap=home/hint-row/iteration-01',
      'http://192.168.1.37:8081/?roughbook-swap=home/hint-row/iteration-01'
    );
    assert.equal(wrap(Original, KEYS)({}).type, Original);
    at('/', 'http://127.0.0.1:8081/');
    assert.equal(wrap(Original, KEYS)({}).type, 'roughbook-section');
    const globals = globalThis as Record<string, unknown>;
    globals.roughbookPlatform = 'ios';
    try {
      assert.equal(wrap(Original, KEYS), Original);
    } finally {
      delete globals.roughbookPlatform;
    }
    const production = await bundled(repo, false);
    assert.equal(production(Original, KEYS), Original);
    at('/');
  });

  it('keeps the component’s own statics, never what makes it a memo or a forwardRef', async () => {
    const wrap = await bundled(await switchRepo());
    const Own = Object.assign((props: Record<string, unknown>) => props, {
      options: { title: 'Hint' }
    });
    const Wrapped = wrap(Own, KEYS) as unknown as Record<string, unknown>;
    assert.deepEqual(Wrapped.options, { title: 'Hint' });
    assert.equal(Wrapped.displayName, CONTEXT_SENTINEL);
    const memo = { $$typeof: Symbol.for('react.memo'), type: Own, compare: null };
    const wrappedMemo = wrap(memo as never, KEYS) as unknown as Record<string, unknown>;
    assert.equal(typeof wrappedMemo, 'function');
    assert.equal(wrappedMemo.$$typeof, undefined);
  });

  it('Pick posts the section a click fell in, instead of following the page', () => {
    const section = contextFiles().find(item => item.file === SECTION_FILE)!.content;
    assert.match(section, /get\("roughbook-pick"\) !== "1"/);
    assert.match(section, /event\.preventDefault\(\);/);
    assert.match(section, /closest\("\[data-roughbook-section\]"\)/);
    assert.match(section, /postMessage\(\{ roughbook: "section", key \}, "\*"\)/);
  });

  it('every file of the switch holds the gate’s sentinel', () => {
    assert.equal(expo.contextPreview!.sentinel, CONTEXT_SENTINEL);
    for (const item of contextFiles())
      assert.ok(item.content.includes(CONTEXT_SENTINEL), item.file);
  });
});

describe('metro.config’s edit', () => {
  it('appends the development-only switch, and its undo gives the file back exactly', () => {
    const edited = editMetroConfig(DEFAULT_CONFIG)!;
    assert.ok(edited.startsWith(DEFAULT_CONFIG.trimEnd()));
    assert.match(
      edited,
      /module\.exports = require\("\.\/rough\/_context\/metro\.cjs"\)\(module\.exports\);/
    );
    assert.match(
      edited,
      /existsSync\(require\("node:path"\)\.join\(__dirname, "rough\/_context\/metro\.cjs"\)\)/
    );
    assert.equal(undoMetroConfig(edited), DEFAULT_CONFIG);
    assert.equal(editMetroConfig(edited), null);
    assert.equal(undoMetroConfig(DEFAULT_CONFIG), null);
    const crlf = DEFAULT_CONFIG.replace(/\n/g, '\r\n');
    const editedCrlf = editMetroConfig(crlf)!;
    assert.ok(!/[^\r]\n/.test(editedCrlf));
    assert.equal(undoMetroConfig(editedCrlf), crlf);
  });

  it('writes Expo’s default config with the switch when the app has none, and removes it on uninstall', async () => {
    const repo = await expoRepo();
    const planned = planMetroConfig(repo);
    assert.ok(planned && !('manual' in planned));
    assert.equal(planned.file, METRO_CONFIG);
    assert.equal(planned.action, 'create');
    assert.match(planned.after, /require\("expo\/metro-config"\)/);
    assert.match(planned.after, /module\.exports = getDefaultConfig\(__dirname\);/);
    write(repo, METRO_CONFIG, planned.after);
    assert.equal(planMetroConfig(repo), null);
    // Its own file, deleted whole by uninstall; no edit to reverse.
    assert.ok(expo.contextPreview!.files(repo, LINK).includes(METRO_CONFIG));
    assert.ok(!expo.contextPreview!.edits(repo, LINK).length);
  });

  it('edits the app’s own config, and asks for it by hand when the config is not CommonJS', async () => {
    const repo = await expoRepo();
    write(repo, METRO_CONFIG, DEFAULT_CONFIG);
    const planned = planMetroConfig(repo);
    assert.ok(planned && !('manual' in planned) && planned.action === 'edit');
    write(repo, METRO_CONFIG, planned.after);
    assert.ok(!expo.contextPreview!.files(repo, LINK).includes(METRO_CONFIG));
    assert.deepEqual(
      expo.contextPreview!.edits(repo, LINK).map(edit => edit.file),
      [METRO_CONFIG]
    );
    const esm = await expoRepo();
    write(esm, 'metro.config.mjs', 'export default {};\n');
    const manual = planMetroConfig(esm);
    assert.ok(manual && 'manual' in manual && /metro\.config\.mjs/.test(manual.manual));
  });
});

describe('the Expo switch in the setup', () => {
  it('is planned for a mapped repo only, behind a new version, with its files listed for doctor and uninstall', async () => {
    assert.equal(expo.version, 4);
    const repo = await expoRepo();
    const link = expo.contextPreview!;
    assert.deepEqual(
      link.missing(repo, LINK).sort(),
      [METRO_CONFIG, METRO_FILE, SECTION_FILE].sort()
    );
    const plan = planPrep(repo, { link: LINK, recipe: expo });
    const files = plan.changes.map(change => change.file);
    for (const file of [METRO_FILE, SECTION_FILE, METRO_CONFIG])
      assert.ok(files.includes(file), file);
    const gitignore = plan.changes.find(change => change.file === '.gitignore')!;
    assert.ok(gitignore.after.split('\n').includes(`/${CONTEXT_DIR}/`));
    for (const change of plan.changes) write(repo, change.file, change.after);
    assert.deepEqual(link.missing(repo, LINK), []);
    for (const file of [METRO_FILE, SECTION_FILE])
      assert.ok(expo.setupFiles(repo, LINK).includes(file));
    assert.ok(expo.generatedFiles.includes(CONTEXT_MODULES));
    assert.deepEqual(link.generated, [CONTEXT_MODULES]);
    assert.ok(expo.importAllowed(LINK).includes(METRO_CONFIG));
    expo.syncPreview(repo);
    assert.ok(fs.existsSync(path.join(repo, CONTEXT_MODULES)));
    assert.equal(
      link.address('/', 'home/hint-row/iteration-01', { pick: true }),
      '/?roughbook-swap=home/hint-row/iteration-01&roughbook-pick=1'
    );

    const plain = await tempDir('roughbook-context-expo-');
    write(plain, 'package.json', '{}\n');
    write(plain, 'src/app/_layout.tsx', 'export default function Layout() {\n  return null;\n}\n');
    const before = planPrep(plain, { link: LINK, recipe: expo }).changes.map(change => change.file);
    assert.ok(!before.includes(METRO_CONFIG));
    assert.ok(!before.some(file => file.startsWith(CONTEXT_DIR)));
    assert.deepEqual(link.missing(plain, LINK), []);
    expo.syncPreview(plain);
    assert.ok(!fs.existsSync(path.join(plain, CONTEXT_MODULES)));
  });
});
