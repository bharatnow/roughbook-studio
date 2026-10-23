// `roughbook new` (decision 35 of the frameworks plan): picks a recipe, runs its scaffold in an
// empty folder, starts git, then `init` links and prepares the new app; a project that began on
// web sketches is told how to bring them in as ports. The scaffolds' own tools never run here: a
// stand-in runner plays each step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { main } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import type { Shell } from '../environment/types.js';
import { fakeFetch, ok, recordingIo, refused, tempDir, type RecordedRequest } from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';

type Ran = { line: string; shell: Shell; cwd: string };

function write(dir: string, file: string, text: string) {
  const full = path.join(dir, ...file.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

/** What create-vite leaves, as the stand-in runner plays it. */
function viteApp(dir: string) {
  write(
    dir,
    'package.json',
    JSON.stringify({
      name: path.basename(dir),
      type: 'module',
      scripts: { dev: 'vite', build: 'tsc -b && vite build' },
      dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0' },
      devDependencies: { vite: '^8.3.5', '@vitejs/plugin-react': '^6.1.2' }
    })
  );
  write(dir, 'index.html', '<div id="root"></div>\n');
  write(dir, 'src/index.css', 'body { margin: 0; }\n');
}

type Tree = {
  pages: {
    slug: string;
    name: string;
    components: { slug: string; name: string; iterations: unknown[] }[];
  }[];
};

async function studio(
  options: {
    signedIn?: boolean;
    answers?: (string | null)[];
    missing?: string[];
    fail?: RegExp;
    tree?: Tree;
  } = {}
) {
  const configDir = await tempDir('roughbook-config-');
  if (options.signedIn !== false) {
    await saveCredentials(configDir, {
      server: SERVER,
      installId: 'install-1',
      token: 'rbi_token',
      signedInAs: 'dana@example.test',
      savedAt: new Date(0).toISOString()
    });
  }
  const parent = await tempDir('roughbook-new-');
  const ran: Ran[] = [];
  const fake = fakeFetch((request: RecordedRequest) => {
    const url = new URL(request.url);
    // The app's own address: nothing answers there yet, so init does not run doctor.
    if (url.origin !== SERVER) return 'offline';
    const key = `${request.method} ${url.pathname.replace('/v1/api/studio', '')}`;
    if (key === 'GET /projects') {
      return ok([
        { id: ORG, name: 'Acme', role: 'owner', projects: [{ slug: 'site', name: 'Site' }] }
      ]);
    }
    if (key === `POST /orgs/${ORG}/links`) {
      return ok(
        {
          linkId: 'link-9',
          org: { id: ORG, name: 'Acme' },
          project: { slug: 'site', name: 'Site' }
        },
        201
      );
    }
    if (key === `GET /orgs/${ORG}/projects/site`) {
      return ok({
        slug: 'site',
        name: 'Site',
        delivery: { componentsDir: 'src/components', publicDir: 'public', devUrl: '' },
        ...(options.tree ?? { pages: [] })
      });
    }
    return refused('NOT_FOUND', 404);
  });
  const io = recordingIo(options.answers ?? []);
  const run = (argv: string[]) =>
    main(argv, {
      cwd: parent,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      io,
      fetch: fake.fetch,
      scaffoldTools: {
        which: program => (options.missing?.includes(program) ? null : `/usr/bin/${program}`),
        run: async step => {
          ran.push(step);
          if (options.fail?.test(step.line)) return 1;
          const created = /create-vite@\d+ (\S+)/.exec(step.line);
          if (created) viteApp(path.join(step.cwd, created[1]!));
          return 0;
        }
      }
    });
  return { io, run, ran, parent, requests: fake.requests };
}

describe('roughbook new', () => {
  it('scaffolds the chosen recipe in an empty folder, starts git, and links and prepares it', async () => {
    const { io, run, ran, parent, requests } = await studio();
    assert.equal(
      await run(['new', 'vite', 'shop-app', '--project', 'site', '--yes']),
      0,
      io.errors.join('\n')
    );
    const app = path.join(parent, 'shop-app');
    assert.deepEqual(
      ran.map(step => [step.line, path.relative(parent, step.cwd) || '.']),
      [
        ['npx --yes create-vite@9 shop-app --template react-ts --no-interactive', '.'],
        ['npm install', 'shop-app']
      ]
    );
    assert.ok(fs.existsSync(path.join(app, '.git')), 'git was started');
    assert.ok(fs.existsSync(path.join(app, 'rough-preview.html')), 'the recipe’s preview setup');
    assert.match(
      fs.readFileSync(path.join(app, 'rough', 'roughbook.json'), 'utf8'),
      /"project": "site"/
    );
    const link = requests.find(request => request.url.endsWith('/links'))!;
    assert.equal((link.body as { project: string }).project, 'site');
    assert.ok(
      io.lines.some(line => /Made shop-app with create-vite/.test(line)),
      io.lines.join('\n')
    );
  });

  it('asks which recipe and which folder when nobody said', async () => {
    const { io, run, ran } = await studio({ answers: ['2', 'shop-app'] });
    assert.equal(await run(['new', '--project', 'site', '--yes']), 0, io.errors.join('\n'));
    assert.ok(
      io.lines.some(line => /^ {2}1\. Next\.js/.test(line)),
      io.lines.join('\n')
    );
    assert.ok(io.lines.some(line => /^ {2}2\. Vite with React \(vite\)$/.test(line)));
    // A recipe not yet proven says so in the list (support.json), and a passing one says nothing.
    assert.ok(
      io.lines.some(line =>
        /^ {2}7\. Flutter \(flutter\), not yet proven: .*roughbook doctor decides/.test(line)
      ),
      io.lines.join('\n')
    );
    assert.match(ran[0]!.line, /create-vite@9 shop-app/);
  });

  it('with nobody to answer (no terminal), runs no scaffold command and says to pass --yes', async () => {
    const { io, run, ran } = await studio();
    assert.equal(await run(['new', 'vite', 'shop-app', '--project', 'site']), 1);
    assert.deepEqual(ran, []);
    assert.match(io.errors.join(' '), /Nobody can answer here \(no terminal\).*--yes/);
  });

  it('refuses an unknown recipe, naming the ones there are', async () => {
    const { io, run, ran } = await studio();
    assert.equal(await run(['new', 'rails', 'x', '--yes']), 1);
    assert.match(io.errors.join(' '), /No recipe rails.*next, vite, wordpress, shopify, laravel/);
    assert.deepEqual(ran, []);
  });

  it('refuses a folder that is not empty, before anything runs', async () => {
    const { io, run, ran, parent } = await studio();
    write(parent, 'shop-app/notes.txt', 'mine\n');
    assert.equal(await run(['new', 'vite', 'shop-app', '--yes']), 1);
    assert.match(io.errors.join(' '), /not empty/);
    assert.deepEqual(ran, []);
  });

  it('refuses a folder name a scaffold cannot take', async () => {
    const { io, run, ran } = await studio();
    assert.equal(await run(['new', 'vite', 'My App', '--yes']), 1);
    assert.match(io.errors.join(' '), /lowercase letters, digits and hyphens/);
    assert.deepEqual(ran, []);
  });

  it('says how to install a program the scaffold needs that is not on the PATH', async () => {
    const { io, run, ran } = await studio({ missing: ['composer'] });
    assert.equal(await run(['new', 'laravel', 'shop-app', '--yes']), 1);
    assert.match(io.errors.join(' '), /composer is not on the PATH/);
    assert.match(io.errors.join(' '), /getcomposer\.org/);
    assert.deepEqual(ran, []);
  });

  it('needs a sign-in first, so nothing is made that cannot be linked', async () => {
    const { io, run, ran } = await studio({ signedIn: false });
    assert.equal(await run(['new', 'vite', 'shop-app', '--yes']), 1);
    assert.match(io.errors.join(' '), /Not signed in/);
    assert.deepEqual(ran, []);
  });

  it('stops at a step that fails, naming it, and links nothing', async () => {
    const { io, run, requests } = await studio({ fail: /^npm install$/ });
    assert.equal(await run(['new', 'vite', 'shop-app', '--project', 'site', '--yes']), 1);
    assert.match(io.errors.join(' '), /Install its dependencies.*failed \(exit 1\)/);
    assert.ok(!requests.some(request => request.url.endsWith('/links')));
  });

  it('shows the steps and asks before running them, unless --yes', async () => {
    const { io, run, ran } = await studio({ answers: ['n'] });
    assert.equal(await run(['new', 'vite', 'shop-app', '--project', 'site']), 0);
    assert.ok(io.lines.some(line => /npx --yes create-vite@9 shop-app/.test(line)));
    assert.deepEqual(ran, []);
  });

  it('tells a project that began on web sketches how to bring them in as ports', async () => {
    const { io, run } = await studio({
      tree: {
        pages: [
          {
            slug: 'home',
            name: 'Home',
            components: [
              { slug: 'hero', name: 'Hero', iterations: [{ id: 'iteration-01' }] },
              { slug: 'footer', name: 'Footer', iterations: [] }
            ]
          }
        ]
      }
    });
    assert.equal(
      await run(['new', 'vite', 'shop-app', '--project', 'site', '--yes']),
      0,
      io.errors.join('\n')
    );
    assert.ok(
      io.lines.some(line => /roughbook pull home\/hero/.test(line)),
      io.lines.join('\n')
    );
    assert.ok(!io.lines.some(line => /home\/footer/.test(line)));
  });
});
