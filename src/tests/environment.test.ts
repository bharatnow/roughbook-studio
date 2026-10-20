import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ENTRY_PLACEHOLDER,
  defaultEnvironment,
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
    // Not in the header, so the recipe's.
    assert.deepEqual(environment.sources, next.environment(LINK).sources);
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
      ['---\nviewports:\n  - desktop wide\n---\n', 'viewports']
    ] as const) {
      const repo = await tempRepo({
        'rough/roughbook.json': `${JSON.stringify(LINK)}\n`,
        'rough/environment.md': header
      });
      await assert.rejects(readEnvironment(repo), new RegExp(`environment\\.md: ${field}`), field);
    }
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
