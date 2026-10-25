// The local server's side of adoption (ROUGHBOOK-BROWNFIELD-PLAN.md, B2): the project view carries
// the map for the canvas's "In the app" cards, doctor's pictures of them are served like
// screenshots, and the canvas's Adopt and Adopt all post names only, "Adopt all" asking first
// past 50 components (decision 29).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import type { AdoptBody } from '../api/types.js';
import type { CommandContext } from '../commands/context.js';
import { writeMap } from '../map/file.js';
import type { MapComponent, RepoMap } from '../map/types.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
import { mapScreenshotPath } from '../screenshot/iteration.js';
import { createLocalServer } from '../server/app.js';
import { LocalStudio } from '../server/studio.js';
import { fakeFetch, notFound, ok, recordingIo, refused } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = `/orgs/${ORG}/projects/site`;
const TOKEN = 'local-token-for-the-adopt-tests';

function component(slug: string, kind: MapComponent['kind'] = 'section'): MapComponent {
  return {
    slug,
    name: slug,
    kind,
    files: [`components/${slug}.tsx`],
    export: 'default',
    fixture: null,
    alone: 'yes',
    why: null,
    byAgent: false
  };
}

const PARTS = Array.from({ length: 51 }, (_, index) => component(`part-${index}`));
const MAP: RepoMap = {
  version: 1,
  by: ['next'],
  pages: [
    {
      slug: 'home',
      name: 'Home',
      address: '/',
      example: null,
      signIn: 'no',
      files: ['app/page.tsx'],
      sections: ['hero', ...PARTS.slice(0, 20).map(item => item.slug)],
      byAgent: false
    },
    {
      slug: 'about',
      name: 'About',
      address: '/about',
      example: null,
      signIn: 'no',
      files: ['app/about/page.tsx'],
      sections: PARTS.slice(20).map(item => item.slug),
      byAgent: false
    }
  ],
  components: [component('hero'), ...PARTS, component('button', 'atom')],
  missed: [],
  unplaced: []
};

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

describe("the local server's adoption", () => {
  let root: string;
  let repo: string;
  let port: number;
  let studio: LocalStudio;
  let server: http.Server;
  let backend: ReturnType<typeof fakeFetch>;

  const call = async (method: 'GET' | 'POST', pathname: string, body?: unknown, key?: string) => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        ...(key ? {} : { authorization: `Bearer ${TOKEN}` }),
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
    // Not tempDir: its clean-up would run as soon as this hook ends.
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'roughbook-server-adopt-'));
    repo = path.join(root, 'app');
    fs.mkdirSync(path.join(repo, 'rough'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), '{ "dependencies": { "next": "16.0.0" } }\n');
    for (const item of MAP.components) {
      fs.mkdirSync(path.join(repo, 'components'), { recursive: true });
      fs.writeFileSync(
        path.join(repo, item.files[0]!),
        'export default function X() { return <div />; }\n'
      );
    }
    const link: RepoLink = {
      version: 1,
      orgId: ORG,
      project: 'site',
      roughCommitted: true,
      appDir: 'app'
    };
    fs.writeFileSync(path.join(repo, 'rough', 'roughbook.json'), renderRepoLink(link));
    writeMap(repo, MAP);
    // Doctor's picture of the hero, for its card before adoption.
    const shot = path.join(repo, ...mapScreenshotPath('component', 'hero', 'desktop').split('/'));
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    fs.writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'ignore' });

    backend = fakeFetch(request => {
      const route = `${request.method} ${new URL(request.url).pathname.replace('/v1/api/studio', '')}`;
      if (route === `POST ${PROJECT}/adopt`) {
        const body = request.body as AdoptBody;
        return ok({
          pages: body.pages.map(page => ({
            slug: page.slug,
            created: true,
            components: page.components.map(item => ({
              slug: item.slug,
              created: true,
              baseline: 'iteration-00'
            }))
          }))
        });
      }
      if (route === `GET ${PROJECT}`) {
        return ok({
          slug: 'site',
          name: 'Site',
          delivery: { componentsDir: 'components', publicDir: 'public', devUrl: '' },
          pictures: true,
          pages: []
        });
      }
      return refused('NOT_FOUND', 404);
    });
    const configDir = path.join(root, 'config');
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
      askPreview: async () => null,
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
      link,
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

  it('gives the canvas the map, with no path, and serves doctor’s pictures of it', async () => {
    const project = await call('GET', '/api/project');
    assert.equal(project.status, 200);
    const map = project.json.data.local.map;
    assert.deepEqual(
      map.pages.map((page: { slug: string }) => page.slug),
      ['home', 'about']
    );
    assert.deepEqual(map.components[0], {
      slug: 'hero',
      name: 'hero',
      kind: 'section',
      alone: 'yes',
      why: null,
      shots: ['desktop']
    });
    assert.ok(!JSON.stringify(map).includes('components/'), 'no file of the app');
    const picture = await call('GET', '/api/map/component/hero/screenshots/desktop');
    assert.equal(picture.status, 200);
    assert.equal(picture.type, 'image/png');
    assert.equal((await call('GET', '/api/map/component/hero/screenshots/huge')).status, 404);
    assert.equal(
      (await call('GET', '/api/map/component/..%2Fsecret/screenshots/desktop')).status,
      404
    );
    assert.equal(
      (await call('GET', '/api/map/component/hero/screenshots/desktop', undefined, 'none')).status,
      401
    );
  });

  it('adopts a component or a page by name, and asks before adopting all past 50', async () => {
    const one = await call('POST', '/api/adopt', { page: 'home', component: 'hero' });
    assert.equal(one.status, 200, JSON.stringify(one.json));
    assert.deepEqual(one.json.data.written, ['home/hero']);
    assert.ok(fs.existsSync(path.join(repo, 'rough/home/hero/iteration-00/index.tsx')));
    const adopts = () => backend.requests.filter(request => request.url.endsWith('/adopt'));
    assert.deepEqual(adopts()[0]!.body, {
      pages: [
        {
          slug: 'home',
          name: 'Home',
          components: [{ slug: 'hero', name: 'hero', kind: 'section' }]
        }
      ]
    });

    const ask = await call('POST', '/api/adopt', { all: true });
    assert.deepEqual(ask.json.data, {
      ask: {
        question:
          'Adopt all 2 pages and 52 components? Each becomes a record on the project, with its name and pictures, for its team and client reviewers.',
        count: 52
      }
    });
    assert.equal(adopts().length, 1, 'nothing sent before the answer');
    const all = await call('POST', '/api/adopt', { all: true, yes: true });
    assert.equal(all.status, 200);
    assert.equal(adopts().length, 2);
    assert.deepEqual(all.json.data.written.length, 51, 'the hero’s baseline was already here');

    assert.equal((await call('POST', '/api/adopt', { page: 'contact' })).status, 400);
    assert.equal((await call('POST', '/api/adopt', { page: '../home' })).status, 400);
    assert.equal((await call('POST', '/api/adopt', {})).status, 400);
  });
});
