// F8 of the frameworks plan: the launch recipes, 2 to 10 in the launch order (Vite with React,
// WordPress themes, Shopify themes, Laravel with Blade, Expo, Flutter, Nuxt, SwiftUI and Jetpack
// Compose), as detection offers them, as `init` plans their preview setup, as their environments
// say how a preview is started, gated and checked, and as `roughbook new` scaffolds each. The
// stacks' own tools do not run here: each recipe's fixture runs them in the conformance suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readEnvironmentSync } from '../environment/read.js';
import { serveUntil } from '../launch/processes.js';
import { compose } from '../recipes/compose/index.js';
import { detectStack } from '../recipes/detect.js';
import { RECIPES, recipeFor } from '../recipes/index.js';
import { laravel } from '../recipes/laravel/index.js';
import { nuxt } from '../recipes/nuxt/index.js';
import { shopify } from '../recipes/shopify/index.js';
import { swiftui } from '../recipes/swiftui/index.js';
import type { Recipe, ScaffoldCommand } from '../recipes/types.js';
import { vite } from '../recipes/vite/index.js';
import { wordpress } from '../recipes/wordpress/index.js';
import type { RepoLink } from '../repo/link.js';
import { syncIterations } from '../repo/mirror.js';
import { applyPrep, planPrep } from '../repo/prep.js';
import { importsFromRough } from '../runs/checks.js';
import { PLACEHOLDER_LINE } from '../runs/placeholder.js';
import { createSlot } from '../runs/slots.js';
import { tempDir } from './helpers.js';

const LINK: Omit<RepoLink, 'appDir'> = {
  version: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  project: 'app',
  roughCommitted: true
};

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function write(repo: string, file: string, text: string) {
  const full = path.join(repo, ...file.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

const exists = (repo: string, file: string) => fs.existsSync(path.join(repo, ...file.split('/')));

/** A recipe's preview setup applied to a repo, which planning again leaves as it is. */
function prepare(repo: string, recipe: Recipe): string[] {
  const plan = planPrep(repo, { link: LINK, recipe });
  assert.deepEqual(plan.problems, []);
  applyPrep(plan);
  assert.deepEqual(
    planPrep(repo, { link: LINK, recipe }).changes.map(change => change.file),
    [],
    `${recipe.name}: planned again, nothing changes`
  );
  return plan.changes.map(change => change.file);
}

/** The lines `.gitignore` holds, trimmed. */
const ignoredLines = (repo: string) => read(repo, '.gitignore').split(/\r?\n/);

/** Writes what a scaffold's write steps hold into `parent/name`, as `roughbook new` would. */
function writeScaffold(recipe: Recipe, parent: string, name: string): string {
  const dir = path.join(parent, name);
  for (const step of recipe.scaffold!.steps(name)) {
    if (step.kind !== 'write') continue;
    for (const [file, text] of Object.entries(step.files)) write(dir, file, text);
  }
  return dir;
}

const commands = (recipe: Recipe, name = 'my-app') =>
  recipe.scaffold!.steps(name).filter((step): step is ScaffoldCommand => step.kind === 'run');

async function viteApp(): Promise<string> {
  const repo = await tempDir('roughbook-vite-');
  write(
    repo,
    'package.json',
    JSON.stringify({
      name: 'vite-app',
      type: 'module',
      scripts: { dev: 'vite', build: 'tsc -b && vite build' },
      dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0' },
      devDependencies: { vite: '^8.3.5', '@vitejs/plugin-react': '^6.1.2', typescript: '~6.0.2' }
    })
  );
  write(
    repo,
    'tsconfig.json',
    '{\n  "files": [],\n  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]\n}\n'
  );
  write(
    repo,
    'tsconfig.app.json',
    '{\n  "compilerOptions": { "jsx": "react-jsx" },\n  "include": ["src"]\n}\n'
  );
  write(
    repo,
    'index.html',
    '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n'
  );
  write(repo, 'src/main.tsx', "import './index.css';\n");
  write(repo, 'src/index.css', ':root { color-scheme: light dark; }\n');
  return repo;
}

const WEB_ROUTES =
  "<?php\n\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::get('/', function () {\n    return view('welcome');\n});\n";

async function laravelApp(): Promise<string> {
  const repo = await tempDir('roughbook-laravel-');
  write(
    repo,
    'composer.json',
    JSON.stringify({ require: { php: '^8.3', 'laravel/framework': '^13.0' } })
  );
  write(repo, 'artisan', '#!/usr/bin/env php\n<?php\n');
  write(repo, 'routes/web.php', WEB_ROUTES);
  write(repo, 'resources/css/app.css', "@import 'tailwindcss';\n\n@source '../**/*.blade.php';\n");
  write(repo, 'resources/views/welcome.blade.php', '<h1>Welcome</h1>\n');
  write(
    repo,
    'package.json',
    JSON.stringify({ devDependencies: { vite: '^8.0.0', tailwindcss: '^4.0.0' } })
  );
  return repo;
}

async function nuxtApp(): Promise<string> {
  const repo = await tempDir('roughbook-nuxt-');
  write(
    repo,
    'package.json',
    JSON.stringify({
      name: 'nuxt-app',
      type: 'module',
      scripts: { dev: 'nuxt dev', build: 'nuxt build' },
      dependencies: { nuxt: '^4.6.2', vue: '^3.5.44', 'vue-router': '^5.4.0' }
    })
  );
  write(repo, 'nuxt.config.ts', 'export default defineNuxtConfig({});\n');
  write(repo, 'app/app.vue', '<template><div><NuxtWelcome /></div></template>\n');
  write(repo, 'tsconfig.json', '{\n  "files": [],\n  "references": []\n}\n');
  return repo;
}

async function shopifyTheme(): Promise<string> {
  const repo = await tempDir('roughbook-shopify-');
  write(
    repo,
    'config/settings_schema.json',
    '[{ "name": "theme_info", "theme_name": "Skeleton" }]\n'
  );
  write(
    repo,
    'layout/theme.liquid',
    '<html><head>{{ content_for_header }}</head><body>{{ content_for_layout }}</body></html>\n'
  );
  write(repo, 'sections/hello-world.liquid', '<p>Hello</p>\n');
  write(repo, 'snippets/image.liquid', '{{ image }}\n');
  write(repo, 'templates/index.json', '{ "sections": {}, "order": [] }\n');
  write(repo, '.gitignore', 'node_modules/\n.shopify/\n');
  return repo;
}

describe('the launch order', () => {
  it('has a recipe for every stack from 1 to 10, each with a scaffold for roughbook new', () => {
    assert.deepEqual(
      RECIPES.map(recipe => recipe.id),
      [
        'next',
        'vite',
        'wordpress',
        'shopify',
        'laravel',
        'expo',
        'flutter',
        'nuxt',
        'swiftui',
        'compose'
      ]
    );
    for (const recipe of RECIPES) {
      assert.ok(recipe.scaffold, `${recipe.name} has a scaffold`);
      assert.ok(recipe.scaffold.steps('my-app').length, `${recipe.name}: steps`);
      assert.ok(recipe.scaffold.needs.length, `${recipe.name}: the programs it needs`);
      assert.equal(recipeFor(recipe.id), recipe);
      assert.ok(recipe.setupNotes.length > 200, `${recipe.name}: notes for the setup run`);
      assert.match(
        recipe.placeholder(recipe.environment(null).entry, 'home/hero/iteration-01'),
        new RegExp(PLACEHOLDER_LINE.replace(/[.]/g, '\\.'))
      );
    }
  });

  it('pins a conformance fixture for every recipe, with how it is installed and served', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(studioRoot, 'conformance', 'fixtures.json'), 'utf8')
    ) as { fixtures: Record<string, { version: string; install?: string[]; dev?: string | null }> };
    for (const recipe of RECIPES) {
      const fixture = manifest.fixtures[recipe.id];
      assert.ok(fixture, `${recipe.id} in conformance/fixtures.json`);
      assert.ok(fixture.version, `${recipe.id}: a pinned version`);
      const mode = recipe.environment(null).mode;
      if (mode === 'live')
        assert.ok(
          fixture.dev?.includes('{port}') || fixture.dev,
          `${recipe.id}: how its app is served`
        );
    }
  });

  it('gives every recipe samples doctor can render: the marker and fixture in one, a failure in the other', () => {
    for (const recipe of RECIPES) {
      const environment = recipe.environment(null);
      const samples = recipe.doctorSamples({
        marker: 'roughbook-doctor-abc',
        fixtureNote: 'fixture-123',
        key: 'doctor-check-ab12/sample/iteration-01'
      });
      const good = Object.values(samples.good).join('\n');
      assert.ok(samples.good[environment.entry], `${recipe.name}: the good sample has the entry`);
      assert.ok(
        samples.broken[environment.entry],
        `${recipe.name}: the broken sample has the entry`
      );
      assert.match(good, /roughbook-doctor-abc/);
      if (environment.fixture) {
        assert.match(samples.good[environment.fixture] ?? '', /fixture-123/, recipe.name);
      }
    }
  });
});

describe('the Vite with React recipe', () => {
  it('is what detection offers a Vite app with React', async () => {
    const detected = detectStack(await viteApp());
    assert.equal(detected.recipe, 'vite');
    assert.equal(detected.family, 'react-like');
  });

  it('adds a page Vite serves in development and never builds, with the wrapper beside it', async () => {
    const repo = await viteApp();
    const files = prepare(repo, vite);
    for (const file of [
      'rough-preview.html',
      'rough/preview-entry.tsx',
      'rough/preview.tsx',
      '.gitignore'
    ]) {
      assert.ok(files.includes(file), `${file} in ${files.join(', ')}`);
    }
    assert.ok(ignoredLines(repo).includes('/rough-preview.html'));
    assert.ok(ignoredLines(repo).includes('/rough/preview-entry.tsx'));
    assert.match(read(repo, 'rough-preview.html'), /src="\/rough\/preview-entry\.tsx"/);
    const entry = read(repo, 'rough/preview-entry.tsx');
    assert.match(entry, /import\.meta\.glob\(/);
    assert.match(entry, /roughbook: 'ready'|roughbook: "ready"/);
    assert.match(entry, /roughbook: 'error'|roughbook: "error"/);
    assert.match(entry, /localhost\|127/);
    assert.match(entry, /roughbook-scheme/);
    assert.match(read(repo, 'rough/preview.tsx'), /\.\.\/src\/index\.css/);
    // The app's own build entry is left alone: only index.html is built.
    assert.equal(
      read(repo, 'index.html'),
      '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n'
    );

    const environment = vite.environment(null);
    assert.equal(environment.preview, '/rough-preview.html?key={key}');
    assert.equal(environment.gate, 'build');
    assert.deepEqual(environment.build.output, ['dist']);
    assert.equal(environment.sketches, 'copy');
    assert.equal(environment.reload, 'app');
    assert.deepEqual(vite.setupFiles(repo, { ...LINK, appDir: null }), ['rough-preview.html']);
    assert.deepEqual(
      importsFromRough(
        repo,
        ['src/main.tsx'],
        vite.importAllowed({ ...LINK, appDir: null }),
        environment.code
      ),
      []
    );
  });

  it('lets Tailwind see rough/ when the app has it', async () => {
    const repo = await viteApp();
    write(repo, 'src/index.css', '@import "tailwindcss";\n');
    prepare(repo, vite);
    assert.match(read(repo, 'src/index.css'), /@source "\.\.\/rough";/);
  });

  it('scaffolds with create-vite and React, then installs', () => {
    const steps = commands(vite);
    assert.equal(vite.scaffold!.tool, 'create-vite');
    assert.match(
      steps[0]!.line,
      /^npx --yes create-vite@9 my-app --template react-ts --no-interactive$/
    );
    assert.equal(steps[0]!.in, 'parent');
    assert.ok(steps.some(step => step.in === 'app' && step.line === 'npm install'));
  });
});

describe('the Laravel with Blade recipe', () => {
  it('is what detection offers a Laravel app', async () => {
    const detected = detectStack(await laravelApp());
    assert.equal(detected.recipe, 'laravel');
    assert.equal(detected.family, 'markup-css');
  });

  it('adds a route loaded only in the local environment, the wrapper, and Tailwind’s source', async () => {
    const repo = await laravelApp();
    const files = prepare(repo, laravel);
    for (const file of [
      'routes/rough-preview.php',
      'routes/web.php',
      'rough/preview.blade.php',
      'resources/css/app.css'
    ]) {
      assert.ok(files.includes(file), `${file} in ${files.join(', ')}`);
    }
    const web = read(repo, 'routes/web.php');
    assert.ok(web.startsWith(WEB_ROUTES), 'the app’s routes are kept as they were');
    assert.match(web, /app\(\)->environment\('local'\)/);
    assert.match(web, /is_file\(__DIR__\.'\/rough-preview\.php'\)/);
    const route = read(repo, 'routes/rough-preview.php');
    assert.match(route, /localhost/);
    assert.match(route, /preview\.json/);
    assert.match(route, /404/);
    assert.match(route, /500/);
    assert.match(route, /roughbook: 'error'/);
    assert.match(read(repo, 'rough/preview.blade.php'), /roughbook: 'ready'/);
    assert.match(read(repo, 'resources/css/app.css'), /@source "\.\.\/\.\.\/rough";/);
    assert.ok(ignoredLines(repo).includes('/routes/rough-preview.php'));

    const environment = laravel.environment(null);
    assert.equal(environment.entry, 'index.blade.php');
    assert.equal(environment.gate, 'runtime');
    assert.equal(environment.preview, '/rough-preview/{key}');
    // The app's own dev script: its server and Vite, so an iteration's Tailwind classes compile.
    assert.equal(environment.start.command, 'composer run dev');
    assert.match(environment.production!.command!, /APP_ENV/);
    assert.equal(environment.sketches, 'port');
    assert.deepEqual(environment.terms, { page: 'view', component: 'component' });
    assert.ok(environment.ignore.includes('vendor'));
    // On Windows the production command sets the variable in PowerShell.
    write(repo, 'rough/environment.md', '---\ncontract: 1\nrecipe: laravel\n---\n');
    const windows = readEnvironmentSync(repo, { ...LINK, appDir: null }, { os: 'windows' });
    assert.equal(windows.shell, 'powershell');
    assert.match(windows.production!.command!, /\$env:APP_ENV='production'/);
    const linux = readEnvironmentSync(repo, { ...LINK, appDir: null }, { os: 'linux' });
    assert.match(linux.production!.command!, /^APP_ENV=production /);
  });

  it('is taken out by uninstall: the route file gone, the snippet out of routes/web.php', async () => {
    const repo = await laravelApp();
    prepare(repo, laravel);
    const link = { ...LINK, appDir: laravel.appDir(repo) };
    assert.deepEqual(laravel.setupFiles(repo, link), ['routes/rough-preview.php']);
    assert.deepEqual(
      laravel.snippets!(repo, link).map(snippet => snippet.file),
      ['routes/web.php']
    );
  });

  it('scaffolds with composer create-project, then builds its assets', () => {
    const steps = commands(laravel);
    assert.equal(laravel.scaffold!.tool, 'composer create-project');
    assert.deepEqual(laravel.scaffold!.needs, ['php', 'composer', 'npm']);
    // A tilde, since cmd.exe takes a caret for its escape character.
    assert.match(steps[0]!.line, /^composer create-project laravel\/laravel:~13\.0 my-app/);
    // Composer is a batch file on Windows, which only a shell starts.
    assert.equal(steps[0]!.shellWindows, 'cmd');
    assert.ok(steps.some(step => step.in === 'app' && step.line === 'npm install'));
    assert.ok(steps.some(step => step.in === 'app' && step.line === 'npm run build'));
  });
});

describe('the Nuxt recipe', () => {
  it('is what detection offers a Nuxt app', async () => {
    const detected = detectStack(await nuxtApp());
    assert.equal(detected.recipe, 'nuxt');
  });

  it('adds a local module that shows previews in development only, and the page it shows', async () => {
    const repo = await nuxtApp();
    const files = prepare(repo, nuxt);
    for (const file of [
      'modules/rough-preview.ts',
      'rough/preview-page.vue',
      'rough/preview.vue'
    ]) {
      assert.ok(files.includes(file), `${file} in ${files.join(', ')}`);
    }
    const module = read(repo, 'modules/rough-preview.ts');
    assert.match(module, /if \(!nuxt\.options\.dev\) return;/);
    assert.ok(ignoredLines(repo).includes('/modules/rough-preview.ts'));
    assert.ok(ignoredLines(repo).includes('/rough/preview-page.vue'));
    const page = read(repo, 'rough/preview-page.vue');
    assert.match(page, /import \{ fixtures, iterations \} from "\.\/preview-registry";/);
    assert.match(page, /roughbook: ["']ready["']/);
    assert.match(page, /roughbook: ["']error["']/);
    assert.equal(read(repo, 'nuxt.config.ts'), 'export default defineNuxtConfig({});\n');
    // Only where the app has pages does the module add a route: one of its own would turn the
    // router on and send the app's own addresses to its 404.
    assert.match(module, /if \(!pages\.length && !pagesOn\) return;/);
    // The registry, rewritten when iterations come and go: Nuxt's server render keeps the list a
    // glob import gave it, but sees a change to a file it imports.
    assert.ok(ignoredLines(repo).includes('/rough/preview-registry.ts'));
    write(repo, 'rough/home/hero/iteration-01/index.vue', '<template><p>One</p></template>\n');
    write(repo, 'rough/home/hero/iteration-01/preview.json', '{ "title": "Hi" }\n');
    syncIterations(repo, nuxt.environment(null));
    const registry = read(repo, 'rough/preview-registry.ts');
    assert.match(
      registry,
      /"home\/hero\/iteration-01": \(\) => import\("\.\/home\/hero\/iteration-01\/index\.vue"\),/
    );
    assert.match(
      registry,
      /"home\/hero\/iteration-01": \(\) => import\("\.\/home\/hero\/iteration-01\/preview\.json"\),/
    );

    const environment = nuxt.environment(null);
    assert.equal(environment.entry, 'index.vue');
    assert.equal(environment.gate, 'build');
    assert.deepEqual(environment.build.output, ['.output']);
    assert.equal(environment.sketches, 'port');
  });

  it('scaffolds with create-nuxt', () => {
    const steps = commands(nuxt);
    assert.match(
      steps[0]!.line,
      /^npx --yes create-nuxt@4 my-app --template minimal --packageManager npm --no-gitInit/
    );
  });
});

describe('the WordPress recipe', () => {
  it('scaffolds a block theme run by wp-env, which detection offers this recipe', async () => {
    const parent = await tempDir('roughbook-wp-');
    const dir = writeScaffold(wordpress, parent, 'harbor-theme');
    assert.match(read(dir, 'style.css'), /Theme Name: Harbor Theme/);
    assert.ok(exists(dir, 'theme.json') && exists(dir, 'templates/index.html'));
    const pkg = JSON.parse(read(dir, 'package.json')) as {
      devDependencies: Record<string, string>;
    };
    assert.match(pkg.devDependencies['@wordpress/env']!, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(wordpress.scaffold!.needs, ['npm', 'docker']);
    assert.ok(commands(wordpress).some(step => step.line === 'npm install'));
    const detected = detectStack(dir);
    assert.equal(detected.recipe, 'wordpress');
  });

  it('maps a must-use plugin into wp-env that previews only in the local environment', async () => {
    const parent = await tempDir('roughbook-wp-');
    const repo = writeScaffold(wordpress, parent, 'harbor-theme');
    write(repo, '.git/HEAD', 'ref: refs/heads/main\n');
    const files = prepare(repo, wordpress);
    for (const file of ['rough/preview-plugin.php', '.wp-env.override.json', 'rough/preview.php']) {
      assert.ok(files.includes(file), `${file} in ${files.join(', ')}`);
    }
    const plugin = read(repo, 'rough/preview-plugin.php');
    assert.match(plugin, /wp_get_environment_type\(\)/);
    assert.match(plugin, /rough_preview/);
    assert.match(plugin, /localhost/);
    // Anywhere but the local environment, the address answers 404 (the runtime gate).
    assert.match(
      plugin,
      /'local' !== wp_get_environment_type\(\) \) \{\s+roughbook_preview_failed\( 404/
    );
    assert.match(plugin, /roughbook: 'error'/);
    const override = JSON.parse(read(repo, '.wp-env.override.json')) as {
      config: Record<string, string>;
      mappings: Record<string, string>;
    };
    assert.equal(override.config.WP_ENVIRONMENT_TYPE, 'local');
    assert.equal(
      override.mappings['wp-content/mu-plugins/rough-preview.php'],
      './rough/preview-plugin.php'
    );
    assert.ok(ignoredLines(repo).includes('/.wp-env.override.json'));
    assert.ok(ignoredLines(repo).includes('/rough/preview-plugin.php'));

    const environment = wordpress.environment(null);
    assert.equal(environment.entry, 'index.php');
    assert.equal(environment.gate, 'runtime');
    assert.equal(environment.preview, '/?rough_preview={key}');
    assert.deepEqual(environment.runtime, { kind: 'container', url: 'http://localhost:8888' });
    assert.equal(environment.production!.url, 'http://localhost:8891');
    assert.match(
      read(repo, '.wp-env.rough-production.json'),
      /"WP_ENVIRONMENT_TYPE": "production"/
    );
  });
});

describe('the Shopify themes recipe', () => {
  it('is what detection offers a theme', async () => {
    assert.equal(detectStack(await shopifyTheme()).recipe, 'shopify');
  });

  it('writes each iteration as a snippet and a template that shows one, for development themes only', async () => {
    const repo = await shopifyTheme();
    prepare(repo, shopify);
    write(repo, 'rough/home/hero/iteration-01/index.liquid', '<h1>{{ heading }}</h1>\n');
    write(
      repo,
      'rough/home/hero/iteration-01/preview.json',
      '{ "heading": "Morning \\"bread\\"" }\n'
    );
    syncIterations(repo, shopify.environment(null));
    const snippet = read(repo, 'snippets/rough-iteration--home--hero--iteration-01.liquid');
    assert.match(snippet, /<h1>\{\{ heading \}\}<\/h1>/);
    const dispatch = read(repo, 'snippets/rough-preview.liquid');
    assert.match(dispatch, /when 'home\/hero\/iteration-01'/);
    // Liquid strings have no escapes: a value is captured as raw text, then passed.
    assert.match(
      dispatch,
      /capture rough_heading -%\}\{%- raw -%\}Morning "bread"\{%- endraw -%\}/
    );
    assert.match(
      dispatch,
      /render 'rough-iteration--home--hero--iteration-01', heading: rough_heading/
    );
    const template = read(repo, 'templates/search.rough-preview.liquid');
    assert.match(template, /theme\.role == 'development'/);
    assert.match(template, /search\.terms/);
    assert.match(template, /roughbook: 'ready'/);
    for (const file of [
      '/snippets/rough-preview.liquid',
      '/snippets/rough-iteration--*.liquid',
      '/templates/search.rough-preview.liquid'
    ]) {
      assert.ok(ignoredLines(repo).includes(file), `${file} in .gitignore`);
    }
    // An iteration removed from rough/ leaves the theme too.
    fs.rmSync(path.join(repo, 'rough', 'home'), { recursive: true });
    syncIterations(repo, shopify.environment(null));
    assert.ok(!exists(repo, 'snippets/rough-iteration--home--hero--iteration-01.liquid'));

    const environment = shopify.environment(null);
    assert.equal(environment.entry, 'index.liquid');
    assert.equal(environment.preview, '/search?q={key}&view=rough-preview');
    assert.equal(environment.start.url, 'http://127.0.0.1:9292');
    assert.match(environment.start.command!, /^shopify theme dev /);
  });

  it('scaffolds with the Shopify CLI’s theme init', () => {
    assert.match(commands(shopify)[0]!.line, /^npx --yes @shopify\/cli@4 theme init my-app/);
  });
});

describe('the SwiftUI recipe', () => {
  it('scaffolds a Swift package with a SwiftUI library, which detection offers this recipe', async () => {
    const parent = await tempDir('roughbook-swift-');
    const dir = writeScaffold(swiftui, parent, 'harbor');
    assert.match(read(dir, 'Package.swift'), /name: "Harbor"/);
    assert.ok(exists(dir, 'Sources/Harbor/HarborTheme.swift'));
    const detected = detectStack(dir);
    assert.equal(detected.recipe, 'swiftui');
    assert.equal(detected.family, 'swiftui');
  });

  it('mirrors iterations into a test target a release build never compiles, each type named by its key', async () => {
    const parent = await tempDir('roughbook-swift-');
    const repo = writeScaffold(swiftui, parent, 'harbor');
    const files = prepare(repo, swiftui);
    assert.ok(files.includes('Package.swift'));
    // Declared only where its folder is, so a clone the studio has not prepared builds as before.
    const manifest = read(repo, 'Package.swift');
    assert.ok(
      manifest.includes(
        'fileExists(atPath: Context.packageDirectory + "/Tests/RoughSnapshotTests")'
      )
    );
    assert.ok(
      manifest.includes('.testTarget(name: "RoughSnapshotTests", dependencies: ["Harbor"]')
    );
    assert.ok(exists(repo, 'Tests/RoughSnapshotTests/RoughSnapshotTests.swift'));
    const environment = swiftui.environment(null);
    assert.equal(environment.mode, 'snapshot');
    assert.deepEqual(environment.placement, {
      kind: 'in-tree',
      path: 'Tests/RoughSnapshotTests/Iterations'
    });
    assert.match(environment.snapshot!, /swift test --filter RoughSnapshotTests/);
    assert.match(environment.build.command!, /swift build -c release/);
    const placeholder = swiftui.placeholder('Iteration.swift', 'home/hero/iteration-01');
    assert.match(placeholder, /struct HomeHeroIteration01: RoughIteration/);
    write(repo, 'rough/home/hero/iteration-01/Iteration.swift', placeholder);
    syncIterations(repo, environment);
    assert.ok(
      exists(repo, 'Tests/RoughSnapshotTests/Iterations/home/hero/iteration-01/Iteration.swift')
    );
    assert.match(
      read(repo, 'Tests/RoughSnapshotTests/RoughRegistry.swift'),
      /"home\/hero\/iteration-01": HomeHeroIteration01\.self/
    );
    assert.equal(
      swiftui.retarget!(
        'Iteration.swift',
        placeholder,
        'home/hero/iteration-01',
        'home/hero/iteration-02'
      ),
      swiftui.placeholder('Iteration.swift', 'home/hero/iteration-02')
    );
  });
});

describe('the Jetpack Compose recipe', () => {
  it('scaffolds an app with a Gradle wrapper, which detection offers this recipe', async () => {
    const parent = await tempDir('roughbook-compose-');
    const dir = writeScaffold(compose, parent, 'harbor');
    assert.match(read(dir, 'app/build.gradle.kts'), /compose-bom/);
    assert.ok(
      commands(compose).some(step => /^gradle wrapper --gradle-version \d+\.\d+/.test(step.line))
    );
    assert.deepEqual(compose.scaffold!.needs, ['gradle', 'java']);
    const detected = detectStack(dir);
    assert.equal(detected.recipe, 'compose');
    assert.equal(detected.family, 'compose');
  });

  it('adds Roborazzi snapshot tests in the debug unit tests, and mirrors iterations by their package', async () => {
    const parent = await tempDir('roughbook-compose-');
    const repo = writeScaffold(compose, parent, 'harbor');
    const files = prepare(repo, compose);
    for (const file of [
      'app/build.gradle.kts',
      'app/src/debug/kotlin/roughbook/RoughIteration.kt',
      'app/src/testDebug/kotlin/roughbook/RoughSnapshotTest.kt',
      'rough/RoughPreview.kt'
    ]) {
      assert.ok(files.includes(file), `${file} in ${files.join(', ')}`);
    }
    assert.match(
      read(repo, 'app/build.gradle.kts'),
      /testImplementation\("org\.robolectric:robolectric:/
    );
    const environment = compose.environment(null);
    assert.equal(environment.mode, 'snapshot');
    assert.deepEqual(environment.placement, {
      kind: 'in-tree',
      path: 'app/src/debug/kotlin/rough'
    });
    const placeholder = compose.placeholder('Iteration.kt', 'home/hero/iteration-01');
    assert.match(placeholder, /^package rough\.home\.hero\.iteration_01$/m);
    assert.match(
      compose.retarget!(
        'Iteration.kt',
        placeholder,
        'home/hero/iteration-01',
        'home/hero/iteration-02'
      ),
      /^package rough\.home\.hero\.iteration_02$/m
    );
    write(repo, 'rough/home/hero/iteration-01/Iteration.kt', placeholder);
    syncIterations(repo, environment);
    assert.ok(exists(repo, 'app/src/debug/kotlin/rough/home/hero/iteration-01/Iteration.kt'));
    assert.ok(exists(repo, 'app/src/debug/kotlin/roughbook/RoughPreview.kt'));
    assert.deepEqual(
      compose.snippets!(repo, { ...LINK, appDir: null }).map(snippet => snippet.file),
      ['app/build.gradle.kts']
    );
  });

  it('retargets a fork’s package when its slot is made', async () => {
    const repo = await tempDir('roughbook-compose-');
    write(
      repo,
      'rough/home/hero/iteration-01/Iteration.kt',
      compose.placeholder('Iteration.kt', 'home/hero/iteration-01')
    );
    createSlot(
      repo,
      { page: 'home', component: 'hero', iteration: 'iteration-02', parent: 'iteration-01' },
      {
        file: 'Iteration.kt',
        content: '',
        retarget: (file, text, from, to) => compose.retarget!(file, text, from, to)
      }
    );
    assert.match(
      read(repo, 'rough/home/hero/iteration-02/Iteration.kt'),
      /^package rough\.home\.hero\.iteration_02$/m
    );
  });
});

describe('what the launch recipes need of the core', () => {
  it('counts a command that starts something in the background and exits, once its address answers', async () => {
    const server = http.createServer((_request, response) => response.end('up'));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise(resolve => server.close(resolve));
    // The container comes up after the command that started it has exited.
    setTimeout(() => server.listen(port, '127.0.0.1'), 1500);
    try {
      const served = await serveUntil(
        `node -e "0"`,
        studioRoot,
        `http://127.0.0.1:${port}/`,
        10_000
      );
      assert.ok(served, 'served once the address answered');
      await served.stop();
      const failed = await serveUntil(
        `node -e "process.exit(3)"`,
        studioRoot,
        'http://127.0.0.1:9/',
        10_000
      );
      assert.equal(failed, null, 'a command that failed is not waited on');
    } finally {
      server.close();
    }
  });

  it('waits for a dev server that holds its first request while it renders the page', async () => {
    // Metro renders the app's home page on the server before it answers its first request.
    const server = http.createServer((_request, response) => {
      setTimeout(() => response.end('rendered'), 3000);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const served = await serveUntil(
        `node -e "setTimeout(() => {}, 20000)"`,
        studioRoot,
        `http://127.0.0.1:${port}/`,
        15_000
      );
      assert.ok(served, 'a slow first answer still counts');
      await served.stop();
    } finally {
      server.close();
    }
  });

  it('waits for a container’s bring-up command to finish before its address counts', async () => {
    // A web server in the container answers long before the tool that brings it up has finished
    // setting the app up (wp-env installs WordPress after Apache answers).
    const server = http.createServer((_request, response) => response.end('installing'));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const started = Date.now();
      const served = await serveUntil(
        `node -e "setTimeout(() => {}, 1500)"`,
        studioRoot,
        `http://127.0.0.1:${port}/`,
        10_000,
        'none',
        { untilExit: true }
      );
      assert.ok(served);
      assert.ok(Date.now() - started >= 1400, 'not before the command finished');
      await served.stop();
      const failed = await serveUntil(
        `node -e "process.exit(2)"`,
        studioRoot,
        `http://127.0.0.1:${port}/`,
        10_000,
        'none',
        { untilExit: true }
      );
      assert.equal(failed, null, 'a bring-up that failed does not count, whatever answers');
    } finally {
      server.close();
    }
  });

  it('reads a production address with nothing to start: an app already running in production', async () => {
    const repo = await tempDir('roughbook-production-');
    write(
      repo,
      'rough/environment.md',
      '---\ncontract: 1\nrecipe: shopify\nproduction: https://harbor.myshopify.com\n---\n'
    );
    const environment = readEnvironmentSync(repo, { ...LINK, appDir: null }, { os: 'linux' });
    assert.deepEqual(environment.production, {
      command: null,
      url: 'https://harbor.myshopify.com'
    });
  });
});

describe('the scaffolds of the recipes F6 and F1 made', () => {
  it('Next.js with create-next-app, Expo with create-expo-app, Flutter with flutter create', () => {
    assert.match(commands(recipeFor('next')!)[0]!.line, /^npx --yes create-next-app@16 my-app /);
    assert.match(
      commands(recipeFor('expo')!)[0]!.line,
      /^npx --yes create-expo-app@5 my-app --template default@sdk-58/
    );
    const flutter = commands(recipeFor('flutter')!)[0]!;
    assert.match(flutter.line, /^flutter create --project-name my_app /);
    assert.equal(flutter.shellWindows, 'cmd');
  });
});
