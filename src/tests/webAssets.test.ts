// The Assets screen's half in the studio (after T5 of ROUGHBOOK-STUDIO-PARITY-PLAN.md): the
// client's three project routes, the local server's /api/web-assets endpoints behind the same
// token and origin guard as the others, and the backend's refusals passed on in words. Only the
// asset's id and the licence the maker typed go; the backend fetches the file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import type { WebAssetView } from '../api/webAssets.js';
import type { CommandContext } from '../commands/context.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
import { createLocalServer } from '../server/app.js';
import { BadRequest, LocalStudio } from '../server/studio.js';
import {
  MAX_LICENCE,
  confirmWebAsset,
  loadWebAssets,
  parseLicence,
  rejectWebAsset,
  type WebAssetsSource
} from '../server/webAssets.js';
import { fakeFetch, notFound, ok, recordingIo, refused, tempDir } from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';
const ASSET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BASE = `/v1/api/studio/orgs/${ORG}/projects/site/web-assets`;
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: 'src/app'
};

function view(overrides: Partial<WebAssetView> = {}): WebAssetView {
  return {
    id: ASSET,
    status: 'pending',
    sourceUrl: 'https://models.example.org/chair.glb',
    licence: 'CC0',
    licenceFrom: 'model',
    reason: 'The product in the hero',
    url: null,
    fileName: null,
    contentType: null,
    size: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-11-28T00:00:00.000Z',
    ...overrides
  };
}

const CONFIRMED = view({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  status: 'confirmed',
  sourceUrl: 'https://fonts.example.org/Inter.woff2',
  licence: 'OFL-1.1',
  licenceFrom: 'maker',
  fileName: 'inter.woff2',
  contentType: 'font/woff2',
  size: 48_000
});

/** A backend for the project's asset routes: one waiting, then confirmed, declined or gone. */
function backend() {
  const state: { pending: WebAssetView[]; confirmed: WebAssetView[]; capture: boolean } = {
    pending: [view()],
    confirmed: [CONFIRMED],
    capture: true
  };
  const fake = fakeFetch(request => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === BASE) {
      return ok({ confirmed: state.confirmed, pending: state.pending });
    }
    const match = new RegExp(`^${BASE}/([^/]+)/(confirm|reject)$`).exec(url.pathname);
    if (request.method === 'POST' && match) {
      const found = state.pending.find(item => item.id === match[1]);
      if (!found) return refused('CONFLICT', 409, 'That file is no longer waiting for you.');
      if (match[2] === 'confirm' && !state.capture) {
        return refused('CAPTURE_NOT_SET_UP', 503, 'Fetching files is not set up on this server.');
      }
      state.pending = state.pending.filter(item => item !== found);
      if (match[2] === 'reject') return ok({ ...found, status: 'rejected' });
      const body = request.body as { licence?: string };
      const done = view({
        ...found,
        status: 'confirmed',
        licence: body.licence ?? found.licence,
        licenceFrom: body.licence ? 'maker' : found.licenceFrom,
        fileName: 'chair.glb',
        contentType: 'model/gltf-binary',
        size: 1_200_000
      });
      state.confirmed = [...state.confirmed, done];
      return ok(done);
    }
    return refused('NOT_FOUND', 404);
  });
  const api = new StudioApi({
    server: SERVER,
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: fake.fetch
  });
  const source: WebAssetsSource = { api, link: { orgId: ORG, project: 'site' } };
  return { state, api, source, fetch: fake.fetch, requests: fake.requests };
}

const sent = (fake: ReturnType<typeof backend>) =>
  fake.requests.map(request => [request.method, new URL(request.url).pathname, request.body]);

describe('the client’s project web asset routes', () => {
  it('lists, confirms with or without a licence, and declines, sending only ids and the licence', async () => {
    const fake = backend();
    const listed = await fake.api.projectWebAssets(ORG, 'site');
    assert.deepEqual(listed, { confirmed: [CONFIRMED], pending: [view()] });
    const done = await fake.api.confirmWebAsset(ORG, 'site', ASSET, { licence: 'CC-BY-4.0' });
    assert.equal(done.status, 'confirmed');
    assert.equal(done.licence, 'CC-BY-4.0');
    fake.state.pending = [view()];
    await fake.api.confirmWebAsset(ORG, 'site', ASSET);
    fake.state.pending = [view()];
    assert.equal((await fake.api.rejectWebAsset(ORG, 'site', ASSET)).status, 'rejected');
    assert.deepEqual(sent(fake), [
      ['GET', BASE, null],
      ['POST', `${BASE}/${ASSET}/confirm`, { licence: 'CC-BY-4.0' }],
      ['POST', `${BASE}/${ASSET}/confirm`, {}],
      ['POST', `${BASE}/${ASSET}/reject`, {}]
    ]);
    for (const request of fake.requests) {
      assert.equal(request.headers.authorization, 'Bearer rbi_token');
    }
  });
});

describe('the local server’s web asset helpers', () => {
  it('reads a missing list as empty', async () => {
    const fake = backend();
    const api = new StudioApi({
      server: SERVER,
      token: 'rbi_token',
      userAgent: 'roughbook-studio/test',
      fetch: fakeFetch(() => ok({})).fetch
    });
    assert.deepEqual(await loadWebAssets({ ...fake.source, api }), { confirmed: [], pending: [] });
  });

  it('keeps the licence typed, trimmed, and drops an empty one so the run’s stays', () => {
    assert.equal(parseLicence({ licence: '  CC0  ' }), 'CC0');
    assert.equal(parseLicence({ licence: '   ' }), undefined);
    assert.equal(parseLicence({}), undefined);
    assert.throws(() => parseLicence({ licence: 7 }), BadRequest);
    assert.throws(() => parseLicence({ licence: 'x'.repeat(MAX_LICENCE + 1) }), BadRequest);
    assert.throws(() => parseLicence({ licence: 'See C:\\client-app\\LICENSE.txt' }), BadRequest);
  });

  it('refuses an id that is not one, or a licence it would not send, before asking the backend', async () => {
    const fake = backend();
    await assert.rejects(confirmWebAsset(fake.source, '../runs/x', {}), BadRequest);
    await assert.rejects(rejectWebAsset(fake.source, ''), BadRequest);
    await assert.rejects(
      confirmWebAsset(fake.source, ASSET, { licence: 'in /home/dana/app/LICENSE' }),
      BadRequest
    );
    assert.equal(fake.requests.length, 0);
  });

  it('passes the backend’s 409 and 503 on in words', async () => {
    const fake = backend();
    fake.state.capture = false;
    await assert.rejects(confirmWebAsset(fake.source, ASSET, {}), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'CAPTURE_NOT_SET_UP');
      return true;
    });
    fake.state.pending = [];
    await assert.rejects(rejectWebAsset(fake.source, ASSET), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.match(error.message, /no longer waiting for you/);
      return true;
    });
  });
});

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

/** The local server over a linked repo, and a way to call its API as the page does. */
async function localServer(fake: ReturnType<typeof backend>) {
  const repo = path.join(await tempDir('roughbook-web-assets-'), 'app');
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
  const token = 'local-token-for-the-assets';
  const server = createLocalServer({
    studio,
    port,
    token,
    uiDir: null,
    devUrl: 'http://localhost:3100',
    project: 'site'
  });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const call = async (
    method: 'GET' | 'POST',
    pathname: string,
    body?: unknown,
    headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      origin: `http://127.0.0.1:${port}`
    }
  ) => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        ...headers,
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
  return { call, close, port, token };
}

const assetCalls = (fake: ReturnType<typeof backend>) =>
  sent(fake).filter(([, pathname]) => String(pathname).startsWith(BASE));

describe('/api/web-assets on the local server', () => {
  it('answers only with the token and from its own page', async () => {
    const fake = backend();
    const local = await localServer(fake);
    try {
      const origin = `http://127.0.0.1:${local.port}`;
      assert.equal((await local.call('GET', '/api/web-assets', undefined, { origin })).status, 401);
      const elsewhere = { authorization: `Bearer ${local.token}`, origin: 'https://evil.example' };
      assert.equal(
        (await local.call('POST', `/api/web-assets/${ASSET}/confirm`, {}, elsewhere)).status,
        403
      );
      assert.equal(
        (await local.call('POST', `/api/web-assets/${ASSET}/reject`, {}, elsewhere)).status,
        403
      );
      assert.deepEqual(assetCalls(fake), []);
    } finally {
      await local.close();
    }
  });

  it('lists, confirms with the typed licence and declines, sending only the id and the licence', async () => {
    const fake = backend();
    const local = await localServer(fake);
    try {
      const listed = await local.call('GET', '/api/web-assets');
      assert.equal(listed.status, 200);
      assert.deepEqual(listed.json.data, { confirmed: [CONFIRMED], pending: [view()] });

      // A page that sent more than the licence: only the licence goes.
      const done = await local.call('POST', `/api/web-assets/${ASSET}/confirm`, {
        licence: ' CC-BY-4.0 ',
        sourceUrl: 'https://elsewhere.example/x',
        path: 'C:\\client-app\\x'
      });
      assert.equal(done.status, 200);
      assert.equal(done.json.data.status, 'confirmed');
      assert.equal(done.json.data.licence, 'CC-BY-4.0');

      fake.state.pending = [view()];
      const declined = await local.call('POST', `/api/web-assets/${ASSET}/reject`, {
        reason: 'not sent'
      });
      assert.equal(declined.json.data.status, 'rejected');

      assert.deepEqual(assetCalls(fake), [
        ['GET', BASE, null],
        ['POST', `${BASE}/${ASSET}/confirm`, { licence: 'CC-BY-4.0' }],
        ['POST', `${BASE}/${ASSET}/reject`, {}]
      ]);
    } finally {
      await local.close();
    }
  });

  it('refuses in words: a bad id or licence here, the backend’s 409 and 503 passed on', async () => {
    const fake = backend();
    const local = await localServer(fake);
    try {
      const badId = await local.call('POST', '/api/web-assets/not%20one/confirm', {});
      assert.equal(badId.status, 400);
      assert.equal(badId.json.error, 'BAD_REQUEST');
      const long = await local.call('POST', `/api/web-assets/${ASSET}/confirm`, {
        licence: 'x'.repeat(MAX_LICENCE + 1)
      });
      assert.equal(long.status, 400);
      assert.match(long.json.message, /characters at most/);
      assert.deepEqual(assetCalls(fake), []);

      fake.state.capture = false;
      const unset = await local.call('POST', `/api/web-assets/${ASSET}/confirm`, {});
      assert.equal(unset.status, 502, 'a backend 5xx is the gateway’s');
      assert.equal(unset.json.error, 'CAPTURE_NOT_SET_UP');
      assert.ok(unset.json.message.length > 0);

      fake.state.pending = [];
      const gone = await local.call('POST', `/api/web-assets/${ASSET}/reject`, {});
      assert.equal(gone.status, 409);
      assert.match(gone.json.message, /That file is no longer waiting for you\./);
    } finally {
      await local.close();
    }
  });
});
