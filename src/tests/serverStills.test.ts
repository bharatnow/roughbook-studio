// The canvas's full-height stills (P3 of the composite plan): the read in local addresses, the
// proxy for a web sketch's pictures, and this repo's own files with their sizes from their headers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { after, before, beforeEach, describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { ApiError, OfflineError } from '../api/errors.js';
import type { StillsRead } from '../api/types.js';
import type { CommandContext } from '../commands/context.js';
import { readEnvironment } from '../environment/read.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
import { screenshotPath } from '../screenshot/iteration.js';
import { createLocalServer } from '../server/app.js';
import { capped, imageSize, RemoteStills } from '../server/stills.js';
import { LocalStudio } from '../server/studio.js';
import { fakeFetch, notFound, ok, recordingIo, refused } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'local-token-for-the-stills-tests';
const STORAGE = 'https://storage.test';

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function riff(chunk: string): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.write('RIFF', 0, 'latin1');
  bytes.write('WEBP', 8, 'latin1');
  bytes.write(chunk, 12, 'latin1');
  return bytes;
}

function webpExtended(width: number, height: number): Buffer {
  const bytes = riff('VP8X');
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

function webpLossy(width: number, height: number): Buffer {
  const bytes = riff('VP8 ');
  bytes.set([0x9d, 0x01, 0x2a], 23);
  bytes.writeUInt16LE(width, 26);
  bytes.writeUInt16LE(height, 28);
  return bytes;
}

function webpLossless(width: number, height: number): Buffer {
  const bytes = riff('VP8L');
  bytes[20] = 0x2f;
  bytes.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 21);
  return bytes;
}

describe('a picture header', () => {
  it('gives the size of a PNG and of each kind of WebP', () => {
    assert.deepEqual(imageSize(png(1280, 3400)), { width: 1280, height: 3400 });
    assert.deepEqual(imageSize(webpExtended(1440, 10000)), { width: 1440, height: 10000 });
    assert.deepEqual(imageSize(webpLossy(390, 2100)), { width: 390, height: 2100 });
    assert.deepEqual(imageSize(webpLossless(390, 2100)), { width: 390, height: 2100 });
  });

  it('gives nothing for anything else', () => {
    assert.equal(imageSize(Buffer.from('not a picture at all, however long it may go on')), null);
    assert.equal(imageSize(Buffer.alloc(0)), null);
  });
});

function read(partial: Partial<StillsRead> = {}): StillsRead {
  return {
    expiresAt: new Date(10_000_000).toISOString(),
    pending: 0,
    items: {
      'home/hero/iteration-41': {
        desktop: {
          url: `${STORAGE}/a/desktop.webp?signature=one`,
          half: `${STORAGE}/a/half.webp?signature=one`,
          width: 1280,
          height: 2000
        },
        phone: null
      }
    },
    ...partial
  };
}

const image = (type = 'image/webp') =>
  new Response('bytes', { status: 200, headers: { 'content-type': type } });

describe('the web stills', () => {
  let now: number;
  let reads: number;
  let opened: string[];
  let answer: () => Promise<StillsRead>;
  let storage: (url: string) => Response;
  const stills = () =>
    new RemoteStills(
      () => {
        reads += 1;
        return answer();
      },
      async url => {
        opened.push(url);
        return storage(url);
      },
      () => now
    );

  beforeEach(() => {
    now = 1_000_000;
    reads = 0;
    opened = [];
    answer = async () => read();
    storage = () => image();
  });

  it('shows local addresses, never the signed links', async () => {
    const view = await stills().current();
    const entry = view.items['home/hero/iteration-41']!;
    assert.match(
      entry.desktop!.url,
      /^\/api\/stills\/remote\/home\/hero\/iteration-41\/desktop\?v=/
    );
    assert.match(entry.desktop!.half!, /^\/api\/stills\/remote\/.*\/desktop-half\?v=/);
    assert.ok(!JSON.stringify(view).includes('signature'));
    assert.ok(!JSON.stringify(view).includes(STORAGE));
  });

  it('keeps its read for a while, less while pictures are being made', async () => {
    const remote = stills();
    await remote.current();
    now += 30_000;
    await remote.current();
    assert.equal(reads, 1);
    now += 40_000;
    await remote.current();
    assert.equal(reads, 2);

    answer = async () => read({ pending: 2 });
    now += 60_000;
    await remote.current();
    assert.equal(reads, 3);
    now += 11_000;
    await remote.current();
    assert.equal(reads, 4);
  });

  it('refuses a key it was given no link for, and opens nothing', async () => {
    const remote = stills();
    await remote.current();
    assert.equal(await remote.open('home/hero/iteration-99', 'desktop'), null);
    assert.equal(await remote.open('home/hero/iteration-41', 'phone'), null);
    assert.deepEqual(opened, []);
  });

  it('drops an entry whose key or link is not one it can use', async () => {
    answer = async () =>
      read({
        items: {
          '../../etc/passwd': read().items['home/hero/iteration-41']!,
          'home/hero/iteration-42': {
            desktop: { url: 'file:///etc/passwd', half: null, width: 1, height: 1 },
            phone: { url: `${STORAGE}/p.webp`, width: 0, height: 10 }
          }
        }
      });
    assert.deepEqual((await stills().current()).items, {});
  });

  it('reads the links again once they are running out', async () => {
    const remote = stills();
    answer = async () => read({ expiresAt: new Date(now + 40_000).toISOString() });
    await remote.current();
    assert.ok(await remote.open('home/hero/iteration-41', 'desktop'));
    assert.equal(reads, 1);
    now += 15_000;
    answer = async () => {
      const next = read();
      next.items['home/hero/iteration-41']!.desktop!.url =
        `${STORAGE}/a/desktop.webp?signature=two`;
      return next;
    };
    assert.ok(await remote.open('home/hero/iteration-41', 'desktop'));
    assert.equal(reads, 2);
    assert.equal(opened.at(-1), `${STORAGE}/a/desktop.webp?signature=two`);
  });

  it('reads again once when storage refuses a link', async () => {
    const remote = stills();
    await remote.current();
    storage = url => (url.includes('signature=one') ? new Response('', { status: 403 }) : image());
    answer = async () => {
      const next = read();
      next.items['home/hero/iteration-41']!.desktop!.url =
        `${STORAGE}/a/desktop.webp?signature=two`;
      return next;
    };
    assert.ok(await remote.open('home/hero/iteration-41', 'desktop'));
    assert.equal(opened.length, 2);
  });

  it('takes only an image of a fitting size', async () => {
    const remote = stills();
    await remote.current();
    storage = () => image('text/html');
    assert.equal(await remote.open('home/hero/iteration-41', 'desktop'), null);
    storage = () => image('image/svg+xml');
    assert.equal(await remote.open('home/hero/iteration-41', 'desktop'), null);
    storage = () =>
      new Response('bytes', {
        headers: { 'content-type': 'image/webp', 'content-length': String(64 * 1024 * 1024) }
      });
    assert.equal(await remote.open('home/hero/iteration-41', 'desktop'), null);
    storage = () => image('IMAGE/WebP; x=1');
    assert.equal((await remote.open('home/hero/iteration-41', 'desktop'))?.type, 'image/webp');
  });

  it('has no stills from an older backend, or one out of reach', async () => {
    answer = async () => {
      throw new ApiError('NOT_FOUND', 404, 'No such route.');
    };
    assert.deepEqual(await stills().current(), { pending: 0, items: {} });
    answer = async () => {
      throw new OfflineError('http://localhost:4000', new Error('fetch failed'));
    };
    assert.deepEqual(await stills().current(), { pending: 0, items: {} });
  });
});

describe('the size cap', () => {
  const send = (bytes: number) =>
    pipeline(Readable.from([Buffer.alloc(bytes)]), capped(10), new PassThrough().resume());

  it('passes a picture within it and fails one past it, whatever its headers said', async () => {
    await send(10);
    await assert.rejects(send(11), /too large/);
  });
});

describe('the stills routes', () => {
  let port: number;
  let server: http.Server;
  let studio: LocalStudio;
  let repo: string;
  let backend: ReturnType<typeof fakeFetch>;
  const storageAsked: { url: string; authorization: string | null }[] = [];
  const entry = read({
    expiresAt: new Date(Date.now() + 3_600_000).toISOString()
  });
  const LOCAL = 'home/hero/iteration-01';

  const get = (pathname: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}${pathname}`, { headers });
  const withToken = { authorization: `Bearer ${TOKEN}` };
  const shotKey = async () =>
    ((await (await get('/api/state', withToken)).json()) as { data: { shotKey: string } }).data
      .shotKey;

  before(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'roughbook-stills-'));
    const write = (file: string, text: string | Buffer) => {
      const target = path.join(repo, ...file.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
    };
    write('package.json', '{ "dependencies": { "next": "16.0.0" } }\n');
    const link: RepoLink = {
      version: 1,
      orgId: ORG,
      project: 'site',
      roughCommitted: true,
      appDir: 'app'
    };
    write('rough/roughbook.json', renderRepoLink(link));
    const environment = await readEnvironment(repo, link);
    write(`rough/home/hero/iteration-01/${environment.entry}`, 'export default 1;\n');
    // Its full-length desktop picture, and a phone screenshot one screen tall.
    write(
      'rough/.screenshots/home/hero/iteration-01/pictures/desktop.webp',
      webpExtended(1440, 2600)
    );
    const phone = environment.viewports.find(item => item.mobile)!.name;
    write(screenshotPath('home', 'hero', 'iteration-01', phone), png(390, 844));

    backend = fakeFetch(request =>
      request.url.endsWith(`/orgs/${ORG}/projects/site/stills`)
        ? ok(entry)
        : refused('NOT_FOUND', 404)
    );
    const fetchAll = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith(STORAGE)) return backend.fetch(input, init);
      storageAsked.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      return new Response(Buffer.from('picture bytes'), {
        headers: { 'content-type': 'image/webp' }
      });
    }) as typeof fetch;
    const configDir = path.join(repo, '.config-for-test');
    const probe = http.createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    port = (probe.address() as AddressInfo).port;
    await new Promise(resolve => probe.close(resolve));
    const context: CommandContext & { repoRoot: string } = {
      io: recordingIo(),
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      repoRoot: repo,
      configDir,
      home: configDir,
      fetch: fetchAll,
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
        fetch: fetchAll
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
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('needs the token for the read', async () => {
    assert.equal((await get('/api/stills')).status, 401);
  });

  it('answers web and local stills at addresses on this server', async () => {
    const { data } = (await (await get('/api/stills', withToken)).json()) as {
      data: { pending: number; items: StillsRead['items'] };
    };
    assert.equal(data.pending, 0);
    assert.ok(!JSON.stringify(data).includes(STORAGE));
    const web = data.items['home/hero/iteration-41']!;
    assert.equal(web.desktop!.width, 1280);
    const local = data.items[LOCAL]!;
    assert.deepEqual(
      { ...local.desktop, url: undefined },
      { url: undefined, half: null, width: 1440, height: 2600 }
    );
    assert.match(
      local.desktop!.url,
      new RegExp(`^/api/iterations/${LOCAL}/pictures/desktop\\?at=`)
    );
    assert.equal(local.phone!.height, 844);
    assert.match(
      local.phone!.url,
      new RegExp(`^/api/iterations/${LOCAL}/screenshots/[a-z-]+\\?at=`)
    );

    const key = await shotKey();
    for (const url of [local.desktop!.url, local.phone!.url]) {
      const picture = await get(`${url}&key=${key}`);
      assert.equal(picture.status, 200, url);
      await picture.arrayBuffer();
    }
    assert.equal((await get(local.desktop!.url)).status, 401);
    // Only what is asked for here goes to the backend: no body, no path.
    for (const request of backend.requests) assert.equal(request.body, null);
  });

  it('carries a web sketch picture for the image key, without the sign-in token', async () => {
    const key = await shotKey();
    const address = `/api/stills/remote/home/hero/iteration-41/desktop?v=1&key=${key}`;
    const picture = await get(address);
    assert.equal(picture.status, 200);
    assert.equal(picture.headers.get('content-type'), 'image/webp');
    assert.equal(await picture.text(), 'picture bytes');
    assert.deepEqual(storageAsked.at(-1), {
      url: `${STORAGE}/a/desktop.webp?signature=one`,
      authorization: null
    });
  });

  it('refuses without a key, a key without a link, and any address but its own', async () => {
    const key = await shotKey();
    assert.equal((await get('/api/stills/remote/home/hero/iteration-41/desktop')).status, 401);
    const before = storageAsked.length;
    assert.equal(
      (await get(`/api/stills/remote/home/hero/iteration-99/desktop?key=${key}`)).status,
      404
    );
    assert.equal(
      (
        await get(
          `/api/stills/remote/home/hero/iteration-41/desktop?key=${key}&url=${encodeURIComponent('https://elsewhere.test/x')}`
        )
      ).status,
      200
    );
    assert.equal(storageAsked.at(-1)!.url, `${STORAGE}/a/desktop.webp?signature=one`);
    assert.equal(storageAsked.length, before + 1);
  });
});
