// The local UI's two one-time sheets (A4 of ROUGHBOOK-APPLE-PLAN.md): the project's pictures
// question while nobody has answered it (decision 25), then the privacy sheet once per install,
// apart from the CLI's (decision 26). /api/state carries both; the answer and "seen" are posted.
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
import { PRIVACY_SHEET } from '../config/privacySheet.js';
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

function tree(pictures: boolean | null | undefined): ProjectTree {
  return {
    slug: 'site',
    name: 'Site',
    delivery: { componentsDir: 'components', publicDir: 'public', devUrl: '' },
    ...(pictures === undefined ? {} : { pictures }),
    pages: []
  };
}

/** A backend holding the project's answer; `role` viewer refuses an answer as the backend does. */
function backend(initial: boolean | null | undefined, role: 'editor' | 'viewer' = 'editor') {
  const state = { pictures: initial, online: true };
  const fake = fakeFetch(request => {
    if (!state.online) return 'offline';
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname.replace('/v1/api/studio', '')}`;
    if (route === `GET ${PROJECT}`) return ok(tree(state.pictures));
    if (route === `PUT ${PROJECT}/pictures`) {
      if (role === 'viewer') return refused('FORBIDDEN', 403);
      const body = request.body as { on: unknown };
      if (Object.keys(body).join() !== 'on' || typeof body.on !== 'boolean') {
        return refused('VALIDATION_ERROR', 400);
      }
      state.pictures = body.on;
      return ok({ pictures: body.on });
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
  const repo = path.join(await tempDir('roughbook-sheets-'), 'app');
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
  const token = 'local-token-for-the-sheets';
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

const answers = (fake: ReturnType<typeof backend>) =>
  fake.requests
    .filter(request => request.method === 'PUT' && request.url.endsWith('/site/pictures'))
    .map(request => request.body);

describe('/api/state and the pictures question', () => {
  it('carries the answer before the page has read the project: null, true or false', async () => {
    for (const answer of [null, true, false] as const) {
      const fake = backend(answer);
      const local = await localServer(fake);
      try {
        const state = await local.call('GET', '/api/state');
        assert.equal(state.status, 200);
        assert.equal(state.json.data.pictures, answer);
        assert.deepEqual(answers(fake), []);
      } finally {
        await local.close();
      }
    }
  });

  it('reads a backend older than the question as on, and says nothing while offline', async () => {
    const older = backend(undefined);
    const local = await localServer(older);
    try {
      assert.equal((await local.call('GET', '/api/state')).json.data.pictures, true);
    } finally {
      await local.close();
    }
    const offline = backend(null);
    offline.state.online = false;
    const away = await localServer(offline);
    try {
      const state = await away.call('GET', '/api/state');
      assert.equal(state.status, 200);
      assert.equal('pictures' in state.json.data, false);
    } finally {
      await away.close();
    }
  });

  it('takes a yes or a no as one boolean, and the state says it after', async () => {
    for (const on of [true, false]) {
      const fake = backend(null);
      const local = await localServer(fake);
      try {
        assert.equal((await local.call('GET', '/api/state')).json.data.pictures, null);
        const answered = await local.call('POST', '/api/pictures/answer', { on });
        assert.equal(answered.status, 200, JSON.stringify(answered.json));
        assert.deepEqual(answered.json.data, { pictures: on });
        assert.deepEqual(answers(fake), [{ on }]);
        assert.equal((await local.call('GET', '/api/state')).json.data.pictures, on);
      } finally {
        await local.close();
      }
    }
  });

  it('sends nothing for a malformed answer, and says in words why a viewer cannot answer', async () => {
    const fake = backend(null, 'viewer');
    const local = await localServer(fake);
    try {
      for (const body of [{}, { on: 'yes' }, { on: true, also: 1 }]) {
        assert.equal((await local.call('POST', '/api/pictures/answer', body)).status, 400);
      }
      const refusal = await local.call('POST', '/api/pictures/answer', { on: true });
      assert.equal(refusal.status, 403);
      assert.match(refusal.json.message, /owner or an editor/);
      assert.equal((await local.call('GET', '/api/state')).json.data.pictures, null);
    } finally {
      await local.close();
    }
  });
});

describe('/api/state and the privacy sheet', () => {
  it('carries the CLI’s words until the local UI has shown them once', async () => {
    const fake = backend(true);
    const local = await localServer(fake);
    try {
      const first = await local.call('GET', '/api/state');
      assert.deepEqual(first.json.data.privacySheet, [...PRIVACY_SHEET]);
      const seen = await local.call('POST', '/api/privacy-sheet/seen');
      assert.equal(seen.status, 200);
      assert.equal((await local.call('GET', '/api/state')).json.data.privacySheet, null);
      const settings = await readSettings(local.configDir);
      assert.equal(settings.uiPrivacySheetShown, true);
      // The CLI's own flag and the analytics answer are left as they were.
      assert.equal(settings.privacySheetShown, false);
      assert.equal(settings.analyticsConsent, null);
      assert.deepEqual(answers(fake), []);
    } finally {
      await local.close();
    }
  });

  it('is shown in the local UI even when the CLI has shown its own', async () => {
    const fake = backend(true);
    const local = await localServer(fake);
    try {
      await saveSettings(local.configDir, { privacySheetShown: true });
      assert.deepEqual((await local.call('GET', '/api/state')).json.data.privacySheet, [
        ...PRIVACY_SHEET
      ]);
    } finally {
      await local.close();
    }
  });
});
