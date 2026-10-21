import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ENTRY_PLACEHOLDER,
  ENVIRONMENT_LINE,
  ENVIRONMENT_PLACEHOLDER,
  TERM_COMPONENT_PLACEHOLDER,
  TERM_PAGE_PLACEHOLDER,
  defaultEnvironment,
  environmentFromHeader,
  extensionOf,
  fillEnvironment,
  parseEnvironmentHeader,
  previewUrl,
  readEnvironment
} from '../environment/read.js';
import { next } from '../recipes/next/index.js';
import { readFolder } from '../runs/checks.js';
import { listRepoFiles } from '../runs/snapshot.js';
import { tempDir } from './helpers.js';

const LINK = {
  version: 1 as const,
  orgId: 'org-1',
  project: 'site',
  roughCommitted: true,
  appDir: 'src/app'
};

async function tempRepo(files: Record<string, string>): Promise<string> {
  const repo = await tempDir('roughbook-env-');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  return repo;
}

const HEADER = `---
contract: 1
recipe: next
stack:
  - next-16
  - react-19
family: react-like
mode: live
entry: index.tsx
preview: /rough-preview/{key}
start: http://localhost:3001
viewports:
  - desktop 1280x800
  - phone 390x844 mobile
ignore:
  - node_modules
  - vendor
overlays:
  - nextjs-portal
fixture: none
build: npm run build:web
buildOutput:
  - dist
gate: both
production: npm run serve @ http://127.0.0.1:4100/
timeoutBuild: 900
---

# This repo

Prose for agents.
`;

/** Every field of the environment table, for a repo no recipe set up, with Windows variants. */
const FULL_HEADER = `---
contract: 1
recipe: none
stack:
  - php-8
  - laravel-13
  - blade
  - tailwind-4
family: markup-css
mode: live
entry: index.blade.php
sources:
  - .blade.php
  - .css
code:
  - .php
placement: rough
wrapper: rough/preview.blade.php
runtime: local
shell: bash
shellWindows: powershell
start: php artisan serve @ http://127.0.0.1:8000
startWindows: php artisan serve --host 127.0.0.1 @ http://127.0.0.1:8000
preview: /rough-preview/{key}
viewports:
  - phone 390x844 mobile
  - tablet 768x1024
  - desktop 1280x800
variants:
  - light
  - dark
  - en
  - ar
ignore:
  - vendor
  - storage
  - node_modules
  - .git
fixture: preview.json
build: npm run build
buildOutput:
  - public/build
gate: runtime
production: php artisan serve --env=production @ http://127.0.0.1:8001
checks:
  - ./vendor/bin/pint --test
checksWindows:
  - vendor/bin/pint.bat --test
promote: resources/views/components
promoteExtensions:
  - .blade.php
assets: public/images
assetsCopy: no
copy: localized lang/en/sections.php
terms:
  - page: view
  - component: partial
workshop: none
setupFiles:
  - routes/rough-preview.php
  - routes/web.php (snippet)
---

# This repo

Prose for agents.
`;

describe('the environment', () => {
  it('is the Next.js recipe’s for a repo linked before environments existed', async () => {
    const repo = await tempRepo({ 'rough/roughbook.json': `${JSON.stringify(LINK)}\n` });
    const environment = await readEnvironment(repo);
    assert.deepEqual(environment, next.environment(LINK));
    assert.equal(environment.contract, 1);
    assert.equal(environment.recipe, 'next');
    assert.equal(environment.family, 'react-like');
    assert.equal(environment.mode, 'live');
    assert.equal(environment.entry, 'index.tsx');
    assert.equal(environment.start.url, 'http://localhost:3000');
    assert.equal(environment.preview, '/rough-preview/{key}');
    assert.deepEqual(
      environment.viewports.map(viewport => [viewport.name, viewport.width, viewport.height]),
      [
        ['desktop', 1440, 900],
        ['mobile', 390, 844]
      ]
    );
    assert.ok(environment.ignore.includes('.next'));
    assert.deepEqual(environment.overlays, ['nextjs-portal']);
    assert.ok(environment.sources.includes('.tsx') && environment.sources.includes('.css'));
    assert.ok(environment.code.includes('.tsx') && !environment.code.includes('.css'));
    // A repo with no link at all reads the same way, so snapshots and watching work there too.
    assert.deepEqual(defaultEnvironment(), next.environment(null));
  });

  it('reads the header of rough/environment.md, with the recipe’s values where it says nothing', async () => {
    const repo = await tempRepo({
      'rough/roughbook.json': `${JSON.stringify(LINK)}\n`,
      'rough/environment.md': HEADER
    });
    const environment = await readEnvironment(repo);
    assert.equal(environment.start.url, 'http://localhost:3001');
    assert.deepEqual(environment.stack, ['next-16', 'react-19']);
    assert.deepEqual(environment.ignore, ['node_modules', 'vendor']);
    assert.deepEqual(environment.viewports, [
      { name: 'desktop', width: 1280, height: 800, mobile: false },
      { name: 'phone', width: 390, height: 844, mobile: true }
    ]);
    assert.equal(environment.fixture, null);
    assert.deepEqual(environment.build, { command: 'npm run build:web', output: ['dist'] });
    assert.equal(environment.gate, 'both');
    assert.deepEqual(environment.production, {
      command: 'npm run serve',
      url: 'http://127.0.0.1:4100'
    });
    assert.deepEqual(environment.timeouts, { start: 60, preview: 150, build: 900 });
    // Not in the header, so the recipe's.
    assert.deepEqual(environment.sources, next.environment(LINK).sources);
    const recipe = next.environment(LINK);
    assert.equal(recipe.fixture, 'preview.json');
    assert.equal(recipe.gate, 'build');
    assert.equal(recipe.production, null);
    assert.equal(recipe.build.command, 'npm run build');
  });

  it('parses the header alone, and refuses one it cannot read, naming the field', async () => {
    assert.deepEqual(parseEnvironmentHeader('# No header\n'), null);
    assert.deepEqual(parseEnvironmentHeader('---\nentry: index.tsx\nstack:\n  - a\n  - b\n---\n'), {
      entry: 'index.tsx',
      stack: ['a', 'b']
    });
    for (const [header, field] of [
      ['---\ncontract: 2\n---\n', 'contract'],
      ['---\nfamily: cobol\n---\n', 'family'],
      ['---\nmode: telepathy\n---\n', 'mode'],
      ['---\nentry: parts/index.tsx\n---\n', 'entry'],
      ['---\npreview: /rough-preview/\n---\n', 'preview'],
      ['---\nstart: not a url\n---\n', 'start'],
      ['---\nviewports:\n  - desktop wide\n---\n', 'viewports'],
      ['---\ngate: hope\n---\n', 'gate'],
      ['---\nproduction: npm start\n---\n', 'production'],
      ['---\ntimeoutBuild: soon\n---\n', 'timeoutBuild'],
      ['---\nfixture: parts/preview.json\n---\n', 'fixture']
    ] as const) {
      const repo = await tempRepo({
        'rough/roughbook.json': `${JSON.stringify(LINK)}\n`,
        'rough/environment.md': header
      });
      await assert.rejects(readEnvironment(repo), new RegExp(`environment\\.md: ${field}`), field);
    }
  });

  it('reads every field of the table for a repo no recipe set up, with the defaults where it says nothing', async () => {
    const repo = await tempRepo({
      'rough/roughbook.json': `${JSON.stringify({ ...LINK, appDir: null, stack: ['laravel-13'], family: 'markup-css' })}\n`,
      'rough/environment.md': FULL_HEADER
    });
    const environment = await readEnvironment(repo, undefined, { os: 'linux' });
    assert.equal(environment.recipe, null);
    assert.equal(environment.recipeVersion, null);
    assert.deepEqual(environment.stack, ['php-8', 'laravel-13', 'blade', 'tailwind-4']);
    assert.equal(environment.family, 'markup-css');
    assert.equal(environment.mode, 'live');
    assert.equal(environment.entry, 'index.blade.php');
    assert.deepEqual(environment.sources, ['.blade.php', '.css']);
    assert.deepEqual(environment.code, ['.php']);
    assert.deepEqual(environment.placement, { kind: 'rough' });
    assert.equal(environment.wrapper, 'rough/preview.blade.php');
    assert.deepEqual(environment.runtime, { kind: 'local' });
    assert.equal(environment.shell, 'bash');
    assert.deepEqual(environment.start, {
      command: 'php artisan serve',
      url: 'http://127.0.0.1:8000'
    });
    assert.equal(environment.preview, '/rough-preview/{key}');
    assert.deepEqual(
      environment.viewports.map(viewport => viewport.name),
      ['phone', 'tablet', 'desktop']
    );
    assert.deepEqual(environment.variants, ['light', 'dark', 'en', 'ar']);
    assert.deepEqual(environment.ignore, ['vendor', 'storage', 'node_modules', '.git']);
    assert.deepEqual(environment.overlays, []);
    assert.equal(environment.fixture, 'preview.json');
    assert.deepEqual(environment.build, { command: 'npm run build', output: ['public/build'] });
    assert.equal(environment.gate, 'runtime');
    assert.deepEqual(environment.production, {
      command: 'php artisan serve --env=production',
      url: 'http://127.0.0.1:8001'
    });
    assert.deepEqual(environment.checks, ['./vendor/bin/pint --test']);
    assert.deepEqual(environment.timeouts, { start: 60, preview: 150, build: 600 });
    assert.deepEqual(environment.promote, {
      dir: 'resources/views/components',
      extensions: ['.blade.php']
    });
    assert.deepEqual(environment.assets, { dir: 'public/images', copy: false });
    assert.deepEqual(environment.copy, { kind: 'localized', file: 'lang/en/sections.php' });
    assert.deepEqual(environment.terms, { page: 'view', component: 'partial' });
    assert.equal(environment.workshop, null);
    assert.deepEqual(environment.setupFiles, [
      { path: 'routes/rough-preview.php', kind: 'file' },
      { path: 'routes/web.php', kind: 'snippet' }
    ]);
    assert.deepEqual(environment.devDependencies, []);

    // The same file read on Windows takes the Windows variants of the shell and the commands.
    const windows = await readEnvironment(repo, undefined, { os: 'windows' });
    assert.equal(windows.shell, 'powershell');
    assert.deepEqual(windows.start, {
      command: 'php artisan serve --host 127.0.0.1',
      url: 'http://127.0.0.1:8000'
    });
    assert.deepEqual(windows.checks, ['vendor/bin/pint.bat --test']);
    // The build has no Windows line, so Windows runs the same one.
    assert.equal(windows.build.command, 'npm run build');
  });

  it('refuses a header it cannot read for each new field, naming the field, and requires what no recipe supplies', () => {
    const refused = (header: string, field: string) => {
      const fields = parseEnvironmentHeader(header)!;
      assert.throws(
        () => environmentFromHeader(fields, LINK, 'linux'),
        new RegExp(`environment\\.md: ${field}`),
        header
      );
    };
    refused('---\nrecipe: django\n---\n', 'recipe');
    refused('---\nrecipeVersion: two\n---\n', 'recipeVersion');
    refused('---\nshell: fish\n---\n', 'shell');
    refused('---\nruntime: cloud\n---\n', 'runtime');
    refused('---\nplacement: sideways\n---\n', 'placement');
    refused('---\nwrapper: ../outside.php\n---\n', 'wrapper');
    refused('---\nvariants:\n  - Dark Mode\n---\n', 'variants');
    refused('---\nstart: none\n---\n', 'start');
    refused('---\nassetsCopy: maybe\n---\n', 'assetsCopy');
    refused('---\ncopy: translated\n---\n', 'copy');
    refused('---\nterms:\n  - screen: view\n---\n', 'terms');
    refused('---\nsetupFiles:\n  - rough/setup/x.php\n---\n', 'setupFiles');
    refused('---\npromoteExtensions:\n  - blade\n---\n', 'promoteExtensions');
    // With no recipe, the file must say what a recipe would have.
    const bare = '---\nrecipe: none\n';
    refused(`${bare}---\n`, 'entry');
    refused(`${bare}entry: index.html\n---\n`, 'sources');
    refused(`${bare}entry: index.html\nsources:\n  - .html\n---\n`, 'start');
    refused(
      `${bare}entry: index.html\nsources:\n  - .html\nstart: http://localhost:8080\n---\n`,
      'preview'
    );
    refused(
      `${bare}entry: index.html\nsources:\n  - .html\nstart: http://localhost:8080\npreview: /p/{key}\n---\n`,
      'gate'
    );
    const minimal = environmentFromHeader(
      parseEnvironmentHeader(
        `${bare}entry: index.html\nsources:\n  - .html\nstart: http://localhost:8080\npreview: /p/{key}\ngate: runtime\n---\n`
      )!,
      { ...LINK, stack: ['static'], family: 'markup-css' },
      'linux'
    );
    assert.equal(minimal.recipe, null);
    assert.deepEqual(minimal.stack, ['static']);
    assert.equal(minimal.family, 'markup-css');
    assert.equal(minimal.shell, 'none');
    assert.deepEqual(minimal.start, { command: null, url: 'http://localhost:8080' });
    // The entry's extension is the one promote accepts when nothing says.
    assert.deepEqual(minimal.promote, { dir: null, extensions: ['.html'] });
    assert.deepEqual(minimal.terms, { page: 'page', component: 'component' });
    assert.equal(extensionOf('index.blade.php'), '.blade.php');
    assert.equal(extensionOf('Makefile'), '');
  });

  it('fills the terms as labels and the environment line, which stays out of a repo with no environment file', () => {
    const environment = {
      ...defaultEnvironment(),
      entry: 'index.blade.php',
      terms: { page: 'view', component: 'partial' }
    };
    const prompt = `<target>\n${TERM_PAGE_PLACEHOLDER}: Home\n${TERM_COMPONENT_PLACEHOLDER}: Hero\n</target>\n<implementation>\n${ENVIRONMENT_PLACEHOLDER}\nRead the app first.\nEntry file is ${ENTRY_PLACEHOLDER}.\n</implementation>\n`;
    assert.equal(
      fillEnvironment(prompt, environment, {}, { hasEnvironmentFile: true }),
      `<target>\nView: Home\nPartial: Hero\n</target>\n<implementation>\n${ENVIRONMENT_LINE}\nRead the app first.\nEntry file is index.blade.php.\n</implementation>\n`
    );
    assert.equal(
      fillEnvironment(prompt, defaultEnvironment(), {}, { hasEnvironmentFile: false }),
      `<target>\nPage: Home\nComponent: Hero\n</target>\n<implementation>\nRead the app first.\nEntry file is index.tsx.\n</implementation>\n`
    );
    // The backend may name its stand-ins; a prompt from before has none and reads unchanged.
    assert.equal(
      fillEnvironment(
        'Page: Home\n',
        environment,
        { termPage: '<p>' },
        { hasEnvironmentFile: true }
      ),
      'Page: Home\n'
    );
  });

  it('builds a preview URL from the template, and the prompt line from the entry', () => {
    const environment = defaultEnvironment();
    assert.equal(
      previewUrl('http://localhost:3000/', 'home', 'hero', 'iteration-01', environment),
      'http://localhost:3000/rough-preview/home/hero/iteration-01'
    );
    assert.equal(
      previewUrl('http://localhost:3000', 'home', 'hero', 'iteration-01', {
        ...environment,
        preview: '/__preview?i={key}'
      }),
      'http://localhost:3000/__preview?i=home/hero/iteration-01'
    );
    assert.equal(ENTRY_PLACEHOLDER, '{{roughbook:entry}}');
    assert.equal(
      fillEnvironment('Entry file is {{roughbook:entry}}.\nKeep {{roughbook:entry}}.', environment),
      'Entry file is index.tsx.\nKeep index.tsx.'
    );
    assert.equal(
      fillEnvironment('Entry: <e>', { ...environment, entry: 'index.vue' }, { entry: '<e>' }),
      'Entry: index.vue'
    );
  });

  it('reads only the sources the environment names, at the top of the iteration', async () => {
    const repo = await tempRepo({
      'it/index.tsx': 'a',
      'it/styles.css': 'b',
      'it/view.blade.php': 'c',
      'it/meta.json': '{}',
      'it/parts/deep.tsx': 'd'
    });
    const dir = path.join(repo, 'it');
    assert.deepEqual([...readFolder(dir, ['.tsx', '.css'])!.keys()].sort(), [
      'index.tsx',
      'styles.css'
    ]);
    assert.deepEqual([...readFolder(dir, ['.php'])!.keys()], ['view.blade.php']);
    assert.equal(readFolder(path.join(repo, 'none'), ['.tsx']), null);
  });

  it('skips the folders the environment ignores, outside git and inside it', async () => {
    const plain = await tempRepo({
      'src/a.ts': 'a',
      'vendor/autoload.php': 'v',
      '.git/HEAD': 'ref'
    });
    assert.deepEqual((await listRepoFiles(plain, ['vendor', '.git'])).files, ['src/a.ts']);
    assert.deepEqual((await listRepoFiles(plain, ['.git'])).files, [
      'src/a.ts',
      'vendor/autoload.php'
    ]);

    const repo = await tempRepo({ 'src/a.ts': 'a', '.gitignore': 'vendor/\n' });
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, stdio: 'ignore', windowsHide: true });
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.email=t@example.test', '-c', 'user.name=t', 'commit', '-q', '-m', 'a');
    fs.mkdirSync(path.join(repo, 'vendor'));
    fs.writeFileSync(path.join(repo, 'vendor', 'x.php'), 'x');
    fs.writeFileSync(path.join(repo, 'b.ts'), 'b');
    fs.mkdirSync(path.join(repo, 'build'));
    fs.writeFileSync(path.join(repo, 'build', 'out.js'), 'o');
    // What git tracks plus what it would add, less the ignored folders, whether or not git ignores them.
    const listed = await listRepoFiles(repo, ['build']);
    assert.equal(listed.git, true);
    assert.deepEqual(listed.files, ['.gitignore', 'b.ts', 'src/a.ts']);
  });
});
