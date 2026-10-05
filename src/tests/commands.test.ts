import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { main } from '../commands/index.js';
import { readCredentials, saveCredentials } from '../config/credentials.js';
import { openerFor } from '../launch/open.js';
import { currentOs } from '../launch/platform.js';
import { readLocalLink } from '../repo/link.js';
import { scratchFiles } from '../repo/scratch.js';
import { fakeFetch, ok, recordingIo, refused, tempDir, type RecordedRequest } from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'rbi_installtoken';

type Route = (request: RecordedRequest) => ReturnType<typeof ok> | 'offline';

/** A fake backend: answers by "METHOD /path" under /v1/api/studio, and 404s anything else. */
function backend(routes: Record<string, Route>) {
  return fakeFetch(request => {
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname.replace('/v1/api/studio', '')}`;
    const route = routes[key];
    return route ? route(request) : refused('NOT_FOUND', 404);
  });
}

async function setup(answers: (string | null)[] = []) {
  const configDir = await tempDir('roughbook-config-');
  const io = recordingIo(answers);
  const env = { ROUGHBOOK_CONFIG_DIR: configDir };
  const opened: string[] = [];
  const run = (argv: string[], cwd: string, fetchImpl: typeof fetch) =>
    main(argv, {
      cwd,
      env,
      io,
      fetch: fetchImpl,
      sleep: async () => {},
      openUrl: async url => {
        opened.push(url);
        return true;
      }
    });
  return { configDir, io, run, opened };
}

async function signedIn(configDir: string) {
  await saveCredentials(configDir, {
    server: SERVER,
    installId: 'install-1',
    token: TOKEN,
    signedInAs: 'alice@example.test',
    savedAt: new Date(0).toISOString()
  });
}

const DEVICE = {
  deviceCode: 'rbd_devicecode',
  userCode: 'BCDF-GHJK',
  verificationUri: 'http://localhost:3000/link',
  verificationUriComplete: 'http://localhost:3000/link?code=BCDF-GHJK',
  expiresIn: 600,
  interval: 5
};
const ME = ok({ user: { id: 'u1', email: 'alice@example.test', name: 'Alice' } });

describe('roughbook login', () => {
  it('shows the code, opens /link, waits for approval and keeps the token', async () => {
    const { configDir, io, run, opened } = await setup();
    const polls = [
      refused('AUTHORIZATION_PENDING', 400),
      refused('SLOW_DOWN', 400),
      ok({ token: TOKEN, installId: 'install-1' })
    ];
    const api = backend({
      'POST /auth/device': () => ok(DEVICE, 201),
      'POST /auth/token': () => polls.shift()!,
      'GET /me': () => ME
    });
    const cwd = await tempDir();
    assert.equal(await run(['login'], cwd, api.fetch), 0, io.errors.join('\n'));
    assert.ok(io.lines.some(line => line.includes('BCDF-GHJK')));
    assert.deepEqual(opened, [DEVICE.verificationUriComplete]);

    const start = api.requests.find(request => request.url.endsWith('/auth/device'))!;
    assert.deepEqual(start.body, { studioVersion: '0.1.0', os: currentOs() });
    assert.equal(start.headers.authorization, undefined);
    const me = api.requests.find(request => request.url.endsWith('/me'))!;
    assert.equal(me.headers.authorization, `Bearer ${TOKEN}`);

    const saved = await readCredentials(configDir);
    assert.deepEqual(
      [saved?.server, saved?.token, saved?.installId, saved?.signedInAs],
      [SERVER, TOKEN, 'install-1', 'alice@example.test']
    );
  });

  it('stops when the sign-in is turned away or expires, and saves nothing', async () => {
    for (const [error, status, message] of [
      ['ACCESS_DENIED', 403, /turned away/],
      ['EXPIRED_TOKEN', 400, /expired/]
    ] as const) {
      const { configDir, io, run } = await setup();
      const api = backend({
        'POST /auth/device': () => ok(DEVICE, 201),
        'POST /auth/token': () => refused(error, status)
      });
      assert.equal(await run(['login'], await tempDir(), api.fetch), 1);
      assert.match(io.errors.join(' '), message);
      assert.equal(await readCredentials(configDir), null);
    }
  });

  it('says so when already signed in, and refuses plain http to another machine', async () => {
    const { configDir, io, run } = await setup();
    await signedIn(configDir);
    const api = backend({ 'GET /me': () => ME });
    assert.equal(await run(['login'], await tempDir(), api.fetch), 0);
    assert.match(io.lines.join(' '), /already/);
    assert.equal(api.requests.length, 1);

    assert.equal(
      await run(['login', '--server', 'http://api.example.com'], await tempDir(), api.fetch),
      1
    );
    assert.match(io.errors.join(' '), /Use https/);
  });
});

describe('roughbook logout and status', () => {
  it('signs out on the server and here, and here alone when the server cannot be reached', async () => {
    const { configDir, io, run } = await setup();
    await signedIn(configDir);
    const api = backend({ 'POST /auth/logout': () => ok({ signedOut: true }) });
    assert.equal(await run(['logout'], await tempDir(), api.fetch), 0);
    assert.equal(await readCredentials(configDir), null);
    assert.equal(api.requests[0]!.headers.authorization, `Bearer ${TOKEN}`);

    await signedIn(configDir);
    const offline = backend({ 'POST /auth/logout': () => 'offline' });
    assert.equal(await run(['logout'], await tempDir(), offline.fetch), 0);
    assert.equal(await readCredentials(configDir), null);
    assert.match(io.errors.join(' '), /remove this studio in the web's settings/);
  });

  it('shows the sign-in and the linked project', async () => {
    const { configDir, io, run } = await setup();
    await signedIn(configDir);
    const repo = await tempDir();
    fs.mkdirSync(path.join(repo, 'rough'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'rough', 'roughbook.json'),
      JSON.stringify({
        version: 1,
        orgId: ORG,
        project: 'site',
        roughCommitted: true,
        appDir: null
      })
    );
    const api = backend({
      'GET /me': () => ME,
      'GET /projects': () =>
        ok([{ id: ORG, name: 'Acme', role: 'owner', projects: [{ slug: 'site', name: 'Site' }] }])
    });
    assert.equal(await run(['status'], path.join(repo, 'rough'), api.fetch), 0);
    const text = io.lines.join('\n');
    assert.match(text, /Signed in:\s+alice@example\.test/);
    assert.match(text, /Project:\s+Site \(site\) in Acme/);
    assert.match(text, /committed to git/);
    assert.match(text, /Waiting:\s+nothing to send/);
  });
});

describe('roughbook init', () => {
  const projects = () =>
    ok([
      {
        id: ORG,
        name: 'Acme',
        role: 'owner',
        projects: [
          { slug: 'site', name: 'Site' },
          { slug: 'landing', name: 'Landing' }
        ]
      },
      { id: OTHER_ORG, name: 'Client', role: 'viewer', projects: [{ slug: 'site', name: 'Site' }] }
    ]);
  const nextRepo = async () => {
    const repo = await tempDir('roughbook-client-');
    fs.writeFileSync(path.join(repo, 'package.json'), '{ "dependencies": { "next": "^16.3.8" } }');
    fs.mkdirSync(path.join(repo, 'src', 'app', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.gitignore'), '/node_modules\n');
    return repo;
  };

  it('links the repo to a chosen project, prepares it, and does nothing more the second time', async () => {
    const { configDir, io, run } = await setup(['2', '', '']);
    await signedIn(configDir);
    const api = backend({
      'GET /projects': projects,
      [`POST /orgs/${ORG}/links`]: request =>
        ok(
          {
            linkId: 'link-1',
            org: { id: ORG, name: 'Acme' },
            project: { slug: (request.body as { project: string }).project, name: 'Landing' }
          },
          201
        )
    });
    const repo = await nextRepo();
    // Run from a folder inside the app: init finds the package.json above it.
    assert.equal(
      await run(['init'], path.join(repo, 'src', 'app', 'nested'), api.fetch),
      0,
      io.errors.join('\n')
    );

    const link = api.requests.find(request => request.url.endsWith('/links'))!;
    assert.deepEqual(link.body, { project: 'landing', framework: 'next-16', roughCommitted: true });
    assert.ok(io.lines.some(line => line.includes('Landing (landing)')));
    // A viewer's organization is not offered.
    assert.ok(!io.lines.some(line => line.includes('Client')));
    assert.ok(io.lines.some(line => line.startsWith('  ~ .gitignore')));
    assert.ok(io.lines.some(line => line === '      + /rough/.roughbook/'));

    const written = JSON.parse(fs.readFileSync(path.join(repo, 'rough', 'roughbook.json'), 'utf8'));
    assert.deepEqual(written, {
      version: 1,
      orgId: ORG,
      project: 'landing',
      roughCommitted: true,
      appDir: 'src/app'
    });
    assert.equal((await readLocalLink(repo))?.linkId, 'link-1');
    assert.ok(
      fs.existsSync(path.join(repo, 'src', 'app', 'rough-preview', '[...slug]', 'page.tsx'))
    );

    // Again, from the repo: nothing to change, and no second link.
    const before = api.requests.length;
    assert.equal(await run(['init', '--yes'], repo, api.fetch), 0);
    assert.ok(io.lines.some(line => line.endsWith('is ready. Nothing to change.')));
    assert.ok(!api.requests.slice(before).some(request => request.url.endsWith('/links')));
  });

  it('runs unattended with flags, and writes nothing without --yes when nobody can answer', async () => {
    const { configDir, io, run } = await setup();
    await signedIn(configDir);
    const api = backend({
      'GET /projects': projects,
      [`POST /orgs/${ORG}/links`]: () =>
        ok(
          {
            linkId: 'link-2',
            org: { id: ORG, name: 'Acme' },
            project: { slug: 'site', name: 'Site' }
          },
          201
        )
    });
    const repo = await nextRepo();
    assert.equal(await run(['init', '--project', 'site', '--no-commit'], repo, api.fetch), 1);
    assert.match(io.lines.join(' '), /Nothing was written/);
    assert.ok(!fs.existsSync(path.join(repo, 'rough')));
    assert.ok(!api.requests.some(request => request.url.endsWith('/links')));

    assert.equal(
      await run(['init', '--project', 'site', '--no-commit', '--yes'], repo, api.fetch),
      0
    );
    assert.match(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), /^\/rough\/$/m);
    assert.match(io.lines.join(' '), /nothing backs up its iterations/);
  });

  it('creates a project, and refuses what it cannot do', async () => {
    const { configDir, io, run } = await setup();
    const repo = await nextRepo();
    assert.equal(await run(['init', '--yes'], repo, backend({}).fetch), 1);
    assert.match(io.errors.join(' '), /Not signed in/);

    await signedIn(configDir);
    const api = backend({
      'GET /projects': projects,
      [`POST /orgs/${ORG}/projects`]: () => ok({ slug: 'new-site' }, 201),
      [`POST /orgs/${ORG}/links`]: () =>
        ok(
          {
            linkId: 'link-3',
            org: { id: ORG, name: 'Acme' },
            project: { slug: 'new-site', name: 'New Site' }
          },
          201
        )
    });
    assert.equal(
      await run(['init', '--new', 'New Site', '--yes'], repo, api.fetch),
      0,
      io.errors.join('\n')
    );
    assert.deepEqual(
      api.requests.find(request => request.url.endsWith('/projects') && request.method === 'POST')!
        .body,
      {
        name: 'New Site'
      }
    );

    assert.equal(await run(['init', '--project', 'nowhere', '--yes'], repo, api.fetch), 1);
    assert.match(io.errors.join(' '), /No project nowhere/);
    const empty = await tempDir();
    assert.equal(await run(['init', '--project', 'site', '--yes'], empty, api.fetch), 1);
    assert.match(io.errors.join(' '), /no package\.json/);
  });

  it('starts a scratch Next.js app and prepares it', async () => {
    const { configDir, io, run } = await setup();
    await signedIn(configDir);
    const api = backend({
      'GET /projects': projects,
      [`POST /orgs/${ORG}/links`]: () =>
        ok(
          {
            linkId: 'link-4',
            org: { id: ORG, name: 'Acme' },
            project: { slug: 'site', name: 'Site' }
          },
          201
        )
    });
    const parent = await tempDir();
    assert.equal(
      await run(['init', '--scratch', 'My-Site', '--project', 'site', '--yes'], parent, api.fetch),
      0,
      io.errors.join('\n')
    );
    const repo = path.join(parent, 'My-Site');
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).name,
      'my-site'
    );
    assert.ok(
      fs.existsSync(path.join(repo, 'src', 'app', 'rough-preview', '[...slug]', 'page.tsx'))
    );
    assert.match(
      fs.readFileSync(path.join(repo, 'src', 'app', 'globals.css'), 'utf8'),
      /@source "\.\.\/\.\.\/rough";/
    );
    assert.equal(
      await run(['init', '--scratch', 'My-Site', '--project', 'site', '--yes'], parent, api.fetch),
      1
    );
    assert.match(io.errors.join(' '), /not empty/);
    assert.ok(Object.keys(scratchFiles('x')).includes('src/app/layout.tsx'));
  });
});

describe('opening a browser', () => {
  it('uses each OS opener with the URL as one argument, never a shell', () => {
    const url = 'http://localhost:3000/link?code=BCDF-GHJK&x=1';
    assert.deepEqual(openerFor(url, 'win32'), {
      command: 'rundll32',
      args: ['url.dll,FileProtocolHandler', url]
    });
    assert.deepEqual(openerFor(url, 'darwin'), { command: 'open', args: [url] });
    assert.deepEqual(openerFor(url, 'linux'), { command: 'xdg-open', args: [url] });
    assert.equal(openerFor(url, 'aix'), null);
  });
});
