// The Complete features switch in the studio (A7 of ROUGHBOOK-APPLE-PLAN.md, decision 12): read
// from /studio/me through /api/state, kept in settings.json for when the server cannot be reached,
// and set through POST /api/features, which sends PUT /studio/me/features with one boolean.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import type { ProjectTree } from '../api/types.js';
import type { CommandContext } from '../commands/context.js';
import { readSettings, saveSettings } from '../config/settings.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
import { createLocalServer } from '../server/app.js';
import { LocalStudio } from '../server/studio.js';
import { fakeFetch, notFound, ok, recordingIo, refused, tempDir } from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = `/orgs/${ORG}/projects/site`;
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: 'src/app'
};

const TREE: ProjectTree = {
  slug: 'site',
  name: 'Site',
  delivery: { componentsDir: 'components', publicDir: 'public', devUrl: '' },
  pictures: true,
  pages: []
};

/** A backend holding the account's switch; undefined is a backend from before the switch. */
function backend(initial: boolean | undefined) {
  const state = { completeFeatures: initial, online: true };
  const fake = fakeFetch(request => {
    if (!state.online) return 'offline';
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname.replace('/v1/api/studio', '')}`;
    if (route === 'GET /me') {
      return ok({
        user: {
          id: 'u1',
          email: 'a@example.com',
          name: null,
          ...(state.completeFeatures === undefined
            ? {}
            : { completeFeatures: state.completeFeatures })
        },
        webUrl: 'http://localhost:3000'
      });
    }
    if (route === `GET ${PROJECT}`) return ok(TREE);
    if (route === 'PUT /me/features') {
      const body = request.body as { on: unknown };
      if (Object.keys(body).join() !== 'on' || typeof body.on !== 'boolean') {
        return refused('VALIDATION_ERROR', 400);
      }
      state.completeFeatures = body.on;
      return ok({ completeFeatures: body.on });
    }
    return refused('NOT_FOUND', 404);
  });
  const api = new StudioApi({
    server: SERVER,
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: fake.fetch
  });
  return { state, api, fetch: fake.fetch, requests: fake.requests };
}

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

/** The local server over a linked repo, and a way to call its API as the page does. */
async function localServer(fake: ReturnType<typeof backend>) {
  const repo = path.join(await tempDir('roughbook-features-'), 'app');
  fs.mkdirSync(path.join(repo, 'rough'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), '{}');
  fs.writeFileSync(path.join(repo, 'rough', 'roughbook.json'), renderRepoLink(LINK));
  const configDir = await tempDir('roughbook-config-');
  const port = await freePort();
  const context: CommandContext & { repoRoot: string } = {
    io: recordingIo(),
    cwd: repo,
    env: { ROUGHBOOK_CONFIG_DIR: configDir },
    repoRoot: repo,
    configDir,
    home: configDir,
    fetch: fake.fetch,
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
  const studio = new LocalStudio({
    context,
    api: fake.api,
    link: LINK,
    devUrl: 'http://localhost:3100',
    port,
    pty: { ok: false, reason: 'not in tests' }
  });
  const token = 'local-token-for-the-switch';
  const server = createLocalServer({
    studio,
    port,
    token,
    uiDir: null,
    devUrl: 'http://localhost:3100',
    project: 'site'
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const call = async (method: 'GET' | 'POST', pathname: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        origin: `http://127.0.0.1:${port}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, json: (await response.json()) as any };
  };
  const close = async () => {
    studio.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  return { call, close, configDir };
}

const sent = (fake: ReturnType<typeof backend>) =>
  fake.requests
    .filter(request => request.method === 'PUT' && request.url.endsWith('/me/features'))
    .map(request => request.body);

describe('/api/state and the Complete features switch', () => {
  it('carries the account’s switch from /studio/me, and keeps it in settings.json', async () => {
    for (const on of [true, false]) {
      const fake = backend(on);
      const local = await localServer(fake);
      try {
        const state = await local.call('GET', '/api/state');
        assert.equal(state.status, 200);
        assert.equal(state.json.data.completeFeatures, on);
        assert.equal(state.json.data.online, true);
        assert.equal((await readSettings(local.configDir)).completeFeatures, on);
        assert.deepEqual(sent(fake), []);
      } finally {
        await local.close();
      }
    }
  });

  it('reads a backend older than the switch as on', async () => {
    const fake = backend(undefined);
    const local = await localServer(fake);
    try {
      assert.equal((await local.call('GET', '/api/state')).json.data.completeFeatures, true);
    } finally {
      await local.close();
    }
  });

  it('answers from settings.json while offline, and on when never read', async () => {
    const fake = backend(false);
    fake.state.online = false;
    const local = await localServer(fake);
    try {
      assert.equal((await readSettings(local.configDir)).completeFeatures, null);
      const offline = (await local.call('GET', '/api/state')).json.data;
      assert.equal(offline.completeFeatures, true);
      assert.equal(offline.online, false);
      await saveSettings(local.configDir, { completeFeatures: false });
      assert.equal((await local.call('GET', '/api/state')).json.data.completeFeatures, false);
    } finally {
      await local.close();
    }
  });
});

describe('POST /api/features', () => {
  it('sends one boolean to PUT /studio/me/features, keeps it, and the state says it after', async () => {
    for (const on of [false, true]) {
      const fake = backend(!on);
      const local = await localServer(fake);
      try {
        assert.equal((await local.call('GET', '/api/state')).json.data.completeFeatures, !on);
        const set = await local.call('POST', '/api/features', { on });
        assert.equal(set.status, 200, JSON.stringify(set.json));
        assert.deepEqual(set.json.data, { completeFeatures: on });
        assert.deepEqual(sent(fake), [{ on }]);
        assert.equal((await readSettings(local.configDir)).completeFeatures, on);
        assert.equal((await local.call('GET', '/api/state')).json.data.completeFeatures, on);
      } finally {
        await local.close();
      }
    }
  });

  it('sends nothing for a malformed body', async () => {
    const fake = backend(true);
    const local = await localServer(fake);
    try {
      for (const body of [{}, { on: 'yes' }, { on: true, also: 1 }]) {
        assert.equal((await local.call('POST', '/api/features', body)).status, 400);
      }
      assert.deepEqual(sent(fake), []);
    } finally {
      await local.close();
    }
  });

  it('refuses in words while offline, and leaves the kept answer as it was', async () => {
    const fake = backend(true);
    const local = await localServer(fake);
    try {
      await local.call('GET', '/api/state');
      fake.state.online = false;
      const refusal = await local.call('POST', '/api/features', { on: false });
      assert.equal(refusal.status, 503);
      assert.equal(typeof refusal.json.message, 'string');
      assert.equal((await readSettings(local.configDir)).completeFeatures, true);
    } finally {
      await local.close();
    }
  });
});
