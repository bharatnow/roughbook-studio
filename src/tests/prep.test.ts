import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  applyPrep,
  checkRepo,
  planEslint,
  planGitignore,
  planPrep,
  planTsconfig,
  stripJsonc
} from '../repo/prep.js';
import {
  listIterations,
  previewRouteFiles,
  previewUrl,
  renderPreviewRegistry,
  writePreviewRegistry
} from '../repo/preview.js';
import { appRoot, detectFramework } from '../repo/framework.js';
import { changedLines } from '../repo/diff.js';
import { tempDir } from './helpers.js';

const NEXT_TSCONFIG = `{
  "compilerOptions": {
    // keep this comment
    "strict": true,
    "paths": { "@/*": ["./src/*"] },
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
`;

const NEXT_ESLINT = `import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
`;

const LINK = { version: 1 as const, orgId: 'org-1', project: 'site', roughCommitted: true };

async function tempRepo(files: Record<string, string>): Promise<string> {
  const repo = await tempDir('roughbook-client-');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  return repo;
}

const read = (repo: string, name: string) => fs.readFileSync(path.join(repo, name), 'utf8');

describe('preparing a repo', () => {
  it('needs an absolute folder with a package.json', async () => {
    const repo = await tempRepo({ 'package.json': '{}' });
    assert.deepEqual(checkRepo(repo), []);
    assert.match(checkRepo('client')[0]!, /absolute/);
    assert.match(checkRepo(path.join(repo, 'missing'))[0]!, /does not exist/);
    fs.rmSync(path.join(repo, 'package.json'));
    assert.match(checkRepo(repo)[0]!, /no package\.json/);
    assert.match(checkRepo(repo, repo)[0]!, /home folder/);
    assert.match(checkRepo(path.dirname(repo), repo)[0]!, /home folder/);
  });

  it("finds the app's package.json above where init runs, but never outside its git repo", async () => {
    const repo = await tempRepo({ 'package.json': '{}', 'src/app/x/.keep': '' });
    assert.equal(appRoot(path.join(repo, 'src', 'app', 'x')), repo);
    const outer = await tempRepo({
      'package.json': '{}',
      'client/.git/HEAD': '',
      'client/src/.keep': ''
    });
    const inner = path.join(outer, 'client', 'src');
    assert.equal(appRoot(inner), inner);
  });

  it('prepares a Next.js 16 repo with rough/ committed, previews and all, and a second run changes nothing', async () => {
    const repo = await tempRepo({
      'package.json': '{ "dependencies": { "next": "^16.3.0" } }',
      '.gitignore': '/node_modules\n/.next/',
      'tsconfig.json': NEXT_TSCONFIG,
      'eslint.config.mjs': NEXT_ESLINT,
      'src/app/layout.tsx': 'export default function L() { return null; }\n',
      'src/app/globals.css': '@import "tailwindcss";\n\n:root { --brand: #1d4ed8; }\n'
    });
    const plan = planPrep(repo, { link: LINK });
    assert.deepEqual(plan.problems, []);
    assert.deepEqual(
      plan.changes.map(change => change.file),
      [
        'rough/README.md',
        'rough/AGENTS.md',
        'rough/CLAUDE.md',
        'rough/roughbook.json',
        'src/app/rough-preview/[...slug]/page.tsx',
        'src/app/rough-preview/[...slug]/ready.tsx',
        'rough/preview.tsx',
        'src/app/globals.css',
        'rough/preview-registry.ts',
        '.gitignore',
        'tsconfig.json',
        'eslint.config.mjs'
      ]
    );
    assert.deepEqual(plan.manual, []);
    assert.equal(plan.before['.gitignore'], '/node_modules\n/.next/');

    applyPrep(plan);
    assert.equal(
      read(repo, '.gitignore'),
      '/node_modules\n/.next/\n\n# Roughbook\n/rough/.roughbook/\n/rough/.screenshots/\n/rough/preview-registry.ts\n/src/app/rough-preview/\n'
    );
    assert.match(
      read(repo, 'tsconfig.json'),
      /"exclude": \["rough", "src\/app\/rough-preview", "node_modules"\]/
    );
    assert.match(read(repo, 'tsconfig.json'), /\/\/ keep this comment/);
    assert.match(read(repo, 'eslint.config.mjs'), /globalIgnores\(\["rough\/\*\*", "\.next\/\*\*"/);
    assert.equal(
      read(repo, 'src/app/globals.css'),
      '@import "tailwindcss";\n@source "../../rough";\n\n:root { --brand: #1d4ed8; }\n'
    );
    assert.deepEqual(JSON.parse(read(repo, 'rough/roughbook.json')), {
      ...LINK,
      appDir: 'src/app'
    });
    assert.equal(read(repo, 'rough/CLAUDE.md'), '@AGENTS.md\n');
    assert.match(read(repo, 'rough/AGENTS.md'), /Never edit an existing iteration/);
    assert.match(read(repo, 'rough/README.md'), /This folder is committed/);
    const page = read(repo, 'src/app/rough-preview/[...slug]/page.tsx');
    // Four levels up from src/app/rough-preview/[...slug]/ is the repo root.
    assert.match(
      page,
      /process\.env\.NODE_ENV === "development" \? await import\("\.\.\/\.\.\/\.\.\/\.\.\/rough\/preview-registry"\) : null/
    );
    for (const file of fs.readdirSync(path.join(repo, 'rough'))) {
      if (fs.statSync(path.join(repo, 'rough', file)).isFile()) {
        assert.ok(!read(repo, `rough/${file}`).includes('\r'), `${file} has CRLF`);
      }
    }

    const again = planPrep(repo, { link: LINK });
    assert.deepEqual(again.changes, []);
  });

  it('ignores all of rough/ when it is not committed, and says so in its README', async () => {
    const repo = await tempRepo({ 'package.json': '{}', 'app/layout.tsx': '' });
    applyPrep(planPrep(repo, { link: { ...LINK, roughCommitted: false } }));
    assert.equal(read(repo, '.gitignore'), '# Roughbook\n/rough/\n/app/rough-preview/\n');
    assert.match(read(repo, 'rough/README.md'), /not committed/);

    // Choosing to commit later takes rough/ out of .gitignore.
    const plan = planPrep(repo, { link: LINK });
    const gitignore = plan.changes.find(change => change.file === '.gitignore');
    assert.match(gitignore!.summary, /Stop ignoring rough\//);
    applyPrep(plan);
    assert.equal(
      read(repo, '.gitignore'),
      '# Roughbook\n/app/rough-preview/\n/rough/.roughbook/\n/rough/.screenshots/\n/rough/preview-registry.ts\n'
    );
  });

  it("adopts a repo prepared by v2, which kept rough/ out of git, and keeps the designer's own files", async () => {
    const repo = await tempRepo({
      'package.json': '{}',
      '.gitignore': '/node_modules\n\n# Roughbook (local only)\n/rough/\n/src/app/rough-preview/\n',
      'src/app/layout.tsx': '',
      'rough/README.md':
        "# rough/\n\nRoughbook's local design workspace for this repo: reference iterations.\n",
      'rough/preview.tsx': '// my providers\n',
      'rough/AGENTS.md': '# My own notes\n',
      'rough/home/hero/iteration-01/index.tsx': 'export default function A() { return null; }\n'
    });
    const plan = planPrep(repo, { link: LINK });
    const files = plan.changes.map(change => change.file);
    assert.ok(files.includes('rough/README.md'));
    assert.ok(!files.includes('rough/AGENTS.md'));
    assert.ok(!files.includes('rough/preview.tsx'));
    assert.match(
      plan.manual.join(' '),
      /rough\/AGENTS\.md exists and was not written by Roughbook/
    );
    applyPrep(plan);
    assert.equal(
      read(repo, '.gitignore'),
      '/node_modules\n\n# Roughbook\n/src/app/rough-preview/\n/rough/.roughbook/\n/rough/.screenshots/\n/rough/preview-registry.ts\n'
    );
    assert.equal(read(repo, 'rough/preview.tsx'), '// my providers\n');
    assert.match(read(repo, 'rough/preview-registry.ts'), /"home\/hero\/iteration-01"/);
  });

  it('says so instead of guessing when there is no App Router, and leaves Tailwind v3 to the designer', async () => {
    const plain = await tempRepo({ 'package.json': '{}' });
    const plan = planPrep(plain, { link: LINK });
    assert.match(plan.manual.join(' '), /No App Router folder/);
    assert.ok(!plan.changes.some(change => change.file.includes('rough-preview')));
    assert.equal(
      JSON.parse(plan.changes.find(c => c.file === 'rough/roughbook.json')!.after).appDir,
      null
    );

    const v3 = await tempRepo({
      'package.json': '{}',
      'app/layout.tsx': '',
      'app/globals.css': 'body { margin: 0; }\n',
      'tailwind.config.js': 'module.exports = { content: [] };\n'
    });
    assert.match(planPrep(v3, { link: LINK }).manual.join(' '), /tailwind\.config\.js/);
  });

  it('never replaces a preview route file someone else wrote', async () => {
    const repo = await tempRepo({
      'package.json': '{}',
      'src/app/layout.tsx': '',
      'src/app/rough-preview/[...slug]/ready.tsx': '// mine\n'
    });
    const plan = planPrep(repo, { link: LINK });
    assert.ok(!plan.changes.some(change => change.file.endsWith('ready.tsx')));
    assert.match(plan.manual.join(' '), /ready\.tsx exists and was not written by Roughbook/);
  });
});

describe('the edits, one at a time', () => {
  it('gitignore: created when missing, nothing to do when covered', () => {
    assert.equal(planGitignore(null, ['/rough/'])?.after, '# Roughbook\n/rough/\n');
    assert.equal(planGitignore('node_modules\nrough/\n', ['/rough/']), null);
    assert.equal(planGitignore('/rough\n', ['/rough/']), null);
    // Ignoring all of rough/ covers what is inside it.
    assert.equal(planGitignore('/rough/\n', ['/rough/.roughbook/']), null);
  });

  it('tsconfig: an exclude is added with node_modules kept, an empty one is filled, unreadable ones are left to the designer', () => {
    const added = planTsconfig('{\n  "compilerOptions": {}\n}\n', ['rough']);
    assert.ok(added && 'after' in added);
    assert.deepEqual(JSON.parse(stripJsonc(added.after)).exclude, ['node_modules', 'rough']);
    const empty = planTsconfig('{ "exclude": [] }', ['rough']);
    assert.deepEqual(JSON.parse((empty as { after: string }).after).exclude, ['rough']);
    assert.equal(planTsconfig('{ "exclude": ["node_modules", "rough/**"] }', ['rough']), null);
    assert.equal(planTsconfig(null, ['rough']), null);
    assert.ok('manual' in (planTsconfig('{ not json', ['rough']) as object));
  });

  it('eslint: flat configs get rough/** in their ignores; others are left to the designer', () => {
    const flat = planEslint({ 'eslint.config.mjs': "export default [{ ignores: ['dist/**'] }];" });
    assert.match((flat as { after: string }).after, /ignores: \["rough\/\*\*", 'dist\/\*\*'\]/);
    assert.equal(planEslint({ 'eslint.config.mjs': 'globalIgnores(["rough/**"])' }), null);
    assert.ok('manual' in (planEslint({ 'eslint.config.mjs': 'export default [];' }) as object));
    assert.equal(
      (planEslint({ '.eslintignore': 'dist' }) as { after: string }).after,
      'dist\nrough/\n'
    );
    assert.ok('manual' in (planEslint({ '.eslintrc.json': '{}' }) as object));
    assert.equal(planEslint({}), null);
  });

  it('stripJsonc keeps slashes inside strings', () => {
    assert.deepEqual(JSON.parse(stripJsonc('{ "url": "https://x.dev//a", /* c */ "b": [1,], }')), {
      url: 'https://x.dev//a',
      b: [1]
    });
  });

  it('shows an edit as the lines it takes out and puts in', () => {
    assert.deepEqual(changedLines('a\nb\nc\n', 'a\nB\nc\n'), { removed: ['b'], added: ['B'] });
    assert.deepEqual(changedLines('a\n', 'a\nb\n'), { removed: [], added: ['b'] });
    assert.deepEqual(changedLines('a\n', 'a\n\n# R\n/x/\n'), {
      removed: [],
      added: ['', '# R', '/x/']
    });
  });
});

describe('previews', () => {
  it('lists every iteration with an index.tsx, and rewrites the registry only when they change', async () => {
    const repo = await tempRepo({
      'rough/home/hero/iteration-03/index.tsx': 'export default function P() { return null; }\n',
      'rough/home/hero/iteration-04/notes.md': '',
      'rough/home/hero/prompts/run.md': '',
      'rough/home_page/hero/iteration-01/index.tsx': ''
    });
    assert.deepEqual(listIterations(repo), ['home/hero/iteration-03']);
    assert.equal(writePreviewRegistry(repo), true);
    const registry = read(repo, 'rough/preview-registry.ts');
    assert.match(
      registry,
      /"home\/hero\/iteration-03": \(\) => import\("\.\/home\/hero\/iteration-03\/index"\),/
    );
    assert.match(registry, /export \{ default as Preview \} from "\.\/preview";/);
    assert.equal(writePreviewRegistry(repo), false);
  });

  it('builds the route files and URLs', () => {
    const [page, ready] = previewRouteFiles('app');
    assert.equal(page!.file, 'app/rough-preview/[...slug]/page.tsx');
    assert.match(page!.content, /await import\("\.\.\/\.\.\/\.\.\/rough\/preview-registry"\)/);
    assert.match(ready!.content, /^"use client";/);
    assert.match(ready!.content, /postMessage\(\{ roughbook: "ready", id \}, "\*"\)/);
    assert.equal(
      previewUrl('http://localhost:3001/', 'home', 'hero', 'iteration-03'),
      'http://localhost:3001/rough-preview/home/hero/iteration-03'
    );
    assert.match(
      renderPreviewRegistry([]),
      /loaders: Record<string, \(\) => Promise<\{ default: ComponentType \}>> = \{\n\};/
    );
  });

  it('records the framework and its major version, never more', async () => {
    const next = await tempRepo({
      'package.json': '{ "dependencies": { "next": "16.3.8", "vite": "7" } }'
    });
    assert.equal(detectFramework(next), 'next-16');
    const vite = await tempRepo({ 'package.json': '{ "devDependencies": { "vite": "^7.1.0" } }' });
    assert.equal(detectFramework(vite), 'vite-7');
    const none = await tempRepo({ 'package.json': '{}' });
    assert.equal(detectFramework(none), null);
  });
});
