// The local server's side of a page's compositions (ROUGHBOOK-BROWNFIELD-PLAN.md, B6): the project
// view lists rough/'s compositions with their composed address, the editor's Save and new section
// go to the backend with slugs and names alone, a composition's thumbnail is served for its card,
// and its Promote's plan says where it writes and whether the page moved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import type { CommandContext } from '../commands/context.js';
import { createLocalServer } from '../server/app.js';
import { LocalStudio } from '../server/studio.js';
import { fakeFetch, notFound, ok, recordingIo, refused, type RecordedRequest } from './helpers.js';
import { HOME_SOURCE, LINK, ORG, homeApp, write } from './homeApp.js';

const PROJECT = `/orgs/${ORG}/projects/site`;
const TOKEN = 'local-token-for-the-composition-tests';
const TREE = {
  slug: 'site',
  name: 'Site',
  delivery: { componentsDir: 'components', publicDir: 'public', devUrl: '' },
  pictures: true,
  pages: [
    {
      slug: 'home',
      name: 'Home',
      inApp: true,
      components: [
        { slug: 'customer-logos', name: 'Customer logos', selectedIteration: null, iterations: [] }
      ]
    }
  ]
};

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

describe("the local server's compositions", () => {
  let root: string;
  let repo: string;
  let port: number;
  let studio: LocalStudio;
  let server: http.Server;
  let backend: ReturnType<typeof fakeFetch>;
  const pictured: string[] = [];

  const call = async (method: 'GET' | 'POST', pathname: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        origin: `http://127.0.0.1:${port}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const type = response.headers.get('content-type') ?? '';
    return {
      status: response.status,
      type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json: (type.includes('json') ? await response.json() : null) as any
    };
  };

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'roughbook-server-compositions-'));
    repo = await homeApp(root);
    backend = fakeFetch((request: RecordedRequest) => {
      const route = `${request.method} ${new URL(request.url).pathname.replace('/v1/api/studio', '')}`;
      if (route === `GET ${PROJECT}`) return ok(TREE);
      if (route === `POST ${PROJECT}/pages/home/compositions`) {
        return ok({ id: 'composition-01', number: 1 }, 201);
      }
      if (route === `POST ${PROJECT}/pages/home/components`) {
        return ok({ slug: 'press-quotes', name: 'Press quotes' }, 201);
      }
      if (route.startsWith(`PUT ${PROJECT}/pages/home/compositions/composition-01/pictures/`)) {
        return ok({ kind: route.split('/').at(-1), width: 1, height: 1, updatedAt: '' });
      }
      return refused('NOT_FOUND', 404);
    });
    const configDir = path.join(path.dirname(repo), 'config');
    port = await freePort();
    const context: CommandContext & { repoRoot: string } = {
      io: recordingIo(),
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      repoRoot: repo,
      configDir,
      home: configDir,
      fetch: backend.fetch,
      sleep: async () => {},
      openUrl: async () => true,
      platform: 'win32',
      detect: async adapter => notFound(adapter),
      launchTerminal: async () => {},
      launchEditor: async () => {},
      copyText: async () => true,
      runHeadless: async () => ({
        ok: true,
        exitCode: 0,
        cancelled: false,
        error: null,
        usage: null
      }),
      screenshot: async () => ({ files: {}, warning: null }),
      takePicture: async ({ url, size }) => {
        pictured.push(`${new URL(url).pathname}${new URL(url).search} ${size.width}`);
        return Buffer.from('RIFF\0\0\0\0WEBPVP8 ');
      },
      askPreview: async url => ({ status: 200, url }),
      runCommand: async () => ({ ok: false, stdout: '', stderr: 'not run', code: null }),
      waitForStop: async () => {},
      stdio: { input: new PassThrough(), output: new PassThrough(), interactive: false }
    };
    studio = new LocalStudio({
      context,
      api: new StudioApi({
        server: 'http://localhost:4000',
        token: 'rbi_token',
        userAgent: 'test',
        fetch: backend.fetch
      }),
      link: LINK,
      devUrl: 'http://localhost:3100',
      port,
      pty: { ok: false, reason: 'not in tests' }
    });
    server = createLocalServer({
      studio,
      port,
      token: TOKEN,
      uiDir: null,
      devUrl: 'http://localhost:3100',
      project: 'site'
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  });

  after(async () => {
    studio?.close();
    server?.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('saves a composition from the editor, lists it, and serves its thumbnail', async () => {
    const before = await call('GET', '/api/project');
    assert.deepEqual(before.json.data.local.compositions, []);
    assert.equal(
      before.json.data.local.composeTemplate,
      '/rough-preview/{page}?roughbook-compose='
    );

    const refusedSave = await call('POST', '/api/compositions', {
      page: 'home',
      sections: [
        { component: 'hero', iteration: 'iteration-00' },
        { component: 'hero', iteration: 'iteration-00' }
      ]
    });
    assert.equal(refusedSave.status, 400);
    assert.match(refusedSave.json.message, /hero is in it twice/);

    const sections = [
      { component: 'customer-logos', iteration: 'iteration-01' },
      { component: 'hero', iteration: 'iteration-00' },
      { component: 'features', iteration: 'iteration-00' },
      { component: 'testimonials', iteration: 'iteration-00' }
    ];
    const saved = await call('POST', '/api/compositions', {
      page: 'home',
      name: 'Logos first',
      parent: null,
      sections
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.data.id, 'composition-01');
    assert.ok(saved.json.data.lines.includes('  1. customer-logos (iteration-01): added'));
    const create = backend.requests.find(request => request.url.endsWith('/compositions'))!;
    assert.deepEqual(create.body, { sections, name: 'Logos first' });

    // The pictures are taken after the answer.
    for (let wait = 0; wait < 50 && pictured.length < 3; wait++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(pictured.length, 3);
    const listed = (await call('GET', '/api/project')).json.data.local.compositions;
    assert.equal(listed.length, 1);
    assert.deepEqual(
      { ...listed[0], savedAt: typeof listed[0].savedAt },
      {
        page: 'home',
        id: 'composition-01',
        number: 1,
        name: 'Logos first',
        parent: null,
        sections,
        savedAt: 'string',
        address:
          '/rough-preview/home?roughbook-compose=customer-logos:iteration-01,hero:iteration-00,features:iteration-00,testimonials:iteration-00',
        pictures: ['thumbnail', 'desktop', 'phone']
      }
    );
    const thumbnail = await call('GET', '/api/compositions/home/composition-01/pictures/thumbnail');
    assert.equal(thumbnail.status, 200);
    assert.equal(thumbnail.type, 'image/webp');
    assert.equal(
      (await call('GET', '/api/compositions/home/composition-09/pictures/thumbnail')).status,
      404
    );
  });

  it('makes a new section from the editor', async () => {
    const made = await call('POST', '/api/sections', { page: 'home', name: 'Press quotes' });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.deepEqual(made.json.data, { slug: 'press-quotes', name: 'Press quotes' });
    assert.ok(fs.existsSync(path.join(repo, 'rough/home/press-quotes')));
  });

  it("plans a composition's promote: its files, the new section's, and the page's drift", async () => {
    const plan = await call('GET', '/api/promote/home/compositions/composition-01');
    assert.equal(plan.status, 200, JSON.stringify(plan.json));
    assert.deepEqual(plan.json.data.drift, { state: 'in-place' });
    assert.equal(plan.json.data.problem, null);
    assert.deepEqual(plan.json.data.targets, [
      { path: 'app/page.tsx', section: null, drifted: false },
      {
        path: 'components/customer-logos.tsx',
        section: { component: 'customer-logos', iteration: 'iteration-01', name: 'Customer logos' },
        drifted: false
      }
    ]);
    assert.equal(plan.json.data.branchChoice.defaultName, 'roughbook/home-composition-01');
    assert.deepEqual(plan.json.data.counts, { kept: 3, moved: 0, added: 1, removed: 0 });

    write(repo, 'app/page.tsx', HOME_SOURCE.replace('home-page-layout', 'home-page-wide'));
    const moved = await call('GET', '/api/promote/home/compositions/composition-01');
    assert.deepEqual(moved.json.data.drift, { state: 'merge', files: ['app/page.tsx'] });
    assert.equal((await call('GET', '/api/promote/home/compositions/notes')).status, 400);
  });
});
