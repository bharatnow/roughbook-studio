import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { ApiError, OfflineError, describeError } from '../api/errors.js';
import { normalizeServer, resolveServer } from '../config/server.js';
import { userConfigDir } from '../config/userDir.js';
import {
  clearCredentials,
  credentialsFile,
  readCredentials,
  saveCredentials
} from '../config/credentials.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { withLock } from '../fs/lock.js';
import { findRepoRoot, isHomeOrAbove } from '../repo/root.js';
import { fakeFetch, ok, refused, tempDir } from './helpers.js';

describe('the repo root', () => {
  it('is the nearest folder upwards with rough/roughbook.json, and null outside one', async () => {
    const root = await tempDir();
    await mkdir(path.join(root, 'rough'), { recursive: true });
    await writeFile(path.join(root, 'rough', 'roughbook.json'), '{}\n');
    const deep = path.join(root, 'src', 'app', 'deep');
    await mkdir(deep, { recursive: true });
    assert.equal(findRepoRoot(deep), root);
    assert.equal(findRepoRoot(root), root);

    const elsewhere = await tempDir();
    assert.equal(findRepoRoot(elsewhere), null);
  });

  it('never searches above the top of a git repo, nor into the home folder', async () => {
    const outer = await tempDir();
    await mkdir(path.join(outer, 'rough'), { recursive: true });
    await writeFile(path.join(outer, 'rough', 'roughbook.json'), '{}\n');
    const inner = path.join(outer, 'client', 'src');
    await mkdir(path.join(outer, 'client', '.git'), { recursive: true });
    await mkdir(inner, { recursive: true });
    assert.equal(findRepoRoot(inner), null);

    // With no .git between them, a link file in the home folder is still never found.
    await rm(path.join(outer, 'client', '.git'), { recursive: true });
    await rm(path.join(outer, '.git'), { recursive: true });
    assert.equal(findRepoRoot(inner, outer), null);
    assert.equal(findRepoRoot(inner, path.join(path.parse(outer).root, 'no-such-home')), outer);
    assert.equal(isHomeOrAbove(outer, outer), true);
    assert.equal(isHomeOrAbove(path.dirname(outer), outer), true);
    assert.equal(isHomeOrAbove(inner, outer), false);
  });
});

describe('state files', () => {
  it('writes JSON whole, with LF endings and a final newline, and reads a missing file as null', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'nested', 'state.json');
    assert.equal(await readJson(file), null);
    await writeJsonAtomic(file, { a: 1, list: ['x'] });
    const text = await readFile(file, 'utf8');
    assert.equal(text, '{\n  "a": 1,\n  "list": [\n    "x"\n  ]\n}\n');
    assert.deepEqual(await readJson(file), { a: 1, list: ['x'] });
    assert.deepEqual(await readdir(path.dirname(file)), ['state.json']);
  });

  it('lets one process at a time hold a lock, and breaks a stale one', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'runs.json');
    const order: string[] = [];
    await Promise.all(
      ['a', 'b', 'c'].map(name =>
        withLock(file, async () => {
          order.push(`${name}:in`);
          await new Promise(resolve => setTimeout(resolve, 10));
          order.push(`${name}:out`);
        })
      )
    );
    for (let i = 0; i < order.length; i += 2) {
      assert.equal(order[i]!.split(':')[0], order[i + 1]!.split(':')[0]);
    }

    await writeFile(`${file}.lock`, '999999');
    let ran = false;
    await withLock(
      file,
      async () => {
        ran = true;
      },
      { staleMs: 0 }
    );
    assert.equal(ran, true);
  });
});

describe('configuration', () => {
  it("keeps the install token in each OS's own settings folder", () => {
    assert.equal(
      userConfigDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a'),
      'C:\\Users\\a\\AppData\\Roaming\\Roughbook'
    );
    assert.equal(
      userConfigDir({}, 'darwin', '/Users/a'),
      '/Users/a/Library/Application Support/Roughbook'
    );
    assert.equal(userConfigDir({}, 'linux', '/home/a'), '/home/a/.config/roughbook');
    assert.equal(userConfigDir({ XDG_CONFIG_HOME: '/xdg' }, 'linux', '/home/a'), '/xdg/roughbook');
    assert.equal(
      userConfigDir({ ROUGHBOOK_CONFIG_DIR: path.resolve('custom') }, 'linux', '/home/a'),
      path.resolve('custom')
    );
  });

  it('talks to https servers, and plain http only on this machine', () => {
    assert.equal(normalizeServer('https://api.example.com/some/path'), 'https://api.example.com');
    assert.equal(normalizeServer('http://localhost:4000/'), 'http://localhost:4000');
    assert.equal(normalizeServer('http://127.0.0.1:4000'), 'http://127.0.0.1:4000');
    assert.throws(() => normalizeServer('http://api.example.com'), /https/);
    assert.throws(() => normalizeServer('not a url'), /Not a server address/);
    assert.equal(
      resolveServer(undefined, { ROUGHBOOK_SERVER: 'https://env.example.com' }, undefined),
      'https://env.example.com'
    );
    assert.equal(
      resolveServer(
        'https://flag.example.com',
        { ROUGHBOOK_SERVER: 'https://env.example.com' },
        undefined
      ),
      'https://flag.example.com'
    );
    assert.equal(
      resolveServer(undefined, {}, 'https://saved.example.com'),
      'https://saved.example.com'
    );
  });

  it('saves the sign-in for this user only, and forgets it', async () => {
    const dir = await tempDir();
    assert.equal(await readCredentials(dir), null);
    const credentials = {
      server: 'http://localhost:4000',
      installId: 'install-1',
      token: 'rbi_secret',
      signedInAs: null,
      savedAt: new Date(0).toISOString()
    };
    await saveCredentials(dir, credentials);
    assert.deepEqual(await readCredentials(dir), credentials);
    await clearCredentials(dir);
    assert.equal(await readCredentials(dir), null);
    await clearCredentials(dir);
    assert.ok(credentialsFile(dir).startsWith(dir));
  });
});

describe('the API client', () => {
  const api = (fetchImpl: typeof fetch, token: string | null = 'rbi_token') =>
    new StudioApi({
      server: 'http://localhost:4000',
      token,
      userAgent: 'roughbook-studio/test',
      fetch: fetchImpl
    });

  it('sends JSON with the install token to /v1/api/studio and returns the data', async () => {
    const fake = fakeFetch(() => ok({ id: 'run-1' }, 201));
    const data = await api(fake.fetch).request('POST', '/runs', { kind: 'generate' });
    assert.deepEqual(data, { id: 'run-1' });
    const [request] = fake.requests;
    assert.equal(request!.url, 'http://localhost:4000/v1/api/studio/runs');
    assert.equal(request!.method, 'POST');
    assert.equal(request!.headers.authorization, 'Bearer rbi_token');
    assert.equal(request!.headers['content-type'], 'application/json');
    assert.deepEqual(request!.body, { kind: 'generate' });
  });

  it('sends no token before sign-in', async () => {
    const fake = fakeFetch(() => ok(null));
    await api(fake.fetch, null).request('GET', '/projects');
    assert.equal(fake.requests[0]!.headers.authorization, undefined);
  });

  it("turns the backend's refusals into coded errors, with its message when it has one", async () => {
    await assert.rejects(
      api(fakeFetch(() => refused('RUN_NOT_FOUND', 404)).fetch).request('GET', '/runs/x'),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === 'RUN_NOT_FOUND' &&
        error.status === 404 &&
        !error.retryable
    );
    await assert.rejects(
      api(
        fakeFetch(() => refused('QUOTA_REACHED', 429, 'You reached today’s limit.')).fetch
      ).request('POST', '/runs', {}),
      (error: unknown) =>
        error instanceof ApiError &&
        error.message === 'You reached today’s limit.' &&
        error.retryable
    );
    await assert.rejects(
      api(fakeFetch(() => refused([{ path: ['kind'] }], 400)).fetch).request('POST', '/runs', {}),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === 'INVALID_REQUEST' &&
        error.issues?.length === 1 &&
        describeError(error) === 'The server did not accept that request.'
    );
    await assert.rejects(
      api(fakeFetch(() => ({ status: 502, text: '<html>Bad gateway</html>' })).fetch).request(
        'GET',
        '/projects'
      ),
      (error: unknown) => error instanceof ApiError && error.code === 'HTTP_502' && error.retryable
    );
  });

  it('reports an unreachable server as offline', async () => {
    await assert.rejects(
      api(fakeFetch(() => 'offline').fetch).request('GET', '/projects'),
      (error: unknown) =>
        error instanceof OfflineError &&
        describeError(error) ===
          'Could not reach http://localhost:4000. Check your connection, or set ROUGHBOOK_SERVER. To use a Roughbook site, sign in with the command on its Install page: roughbook login --server <url>.'
    );
    // A server someone chose is the right one; only the default points at the Install page.
    assert.equal(
      describeError(new OfflineError('https://api.roughbook.example')),
      'Could not reach https://api.roughbook.example. Check your connection, or set ROUGHBOOK_SERVER.'
    );
  });
});
