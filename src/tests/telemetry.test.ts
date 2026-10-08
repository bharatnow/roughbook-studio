import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { StudioApi } from '../api/client.js';
import { main } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import { readSettings, saveSettings } from '../config/settings.js';
import { readJson } from '../fs/json.js';
import { fitsCatalog } from '../telemetry/catalog.js';
import { eventsFile, flushEvents, recordEvent, type QueuedEvent } from '../telemetry/events.js';
import { fakeFetch, ok, recordingIo, refused, tempDir, type RecordedRequest } from './helpers.js';

const SERVER = 'http://localhost:4000';
const here = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_CATALOG = path.join(
  here,
  '..',
  '..',
  '..',
  'roughbook-backend',
  'contracts',
  'event-catalog.json'
);
const STARTED = {
  studioVersion: '0.2.0',
  os: 'linux',
  agents: [{ id: 'codex', version: '0.9.1' }]
};

type Route = (request: RecordedRequest) => ReturnType<typeof ok> | 'offline';

function backend(routes: Record<string, Route>) {
  return fakeFetch(request => {
    const url = new URL(request.url);
    const route = routes[`${request.method} ${url.pathname.replace('/v1/api/studio', '')}`];
    return route ? route(request) : refused('NOT_FOUND', 404);
  });
}

async function signedInConfig(consent: boolean | null = null) {
  const configDir = await tempDir('roughbook-telemetry-');
  await saveCredentials(configDir, {
    server: SERVER,
    installId: 'install-1',
    token: 'rbi_token',
    signedInAs: 'alice@example.test',
    savedAt: new Date(0).toISOString()
  });
  if (consent !== null) await saveSettings(configDir, { analyticsConsent: consent });
  return configDir;
}

const waiting = async (configDir: string) =>
  (await readJson<QueuedEvent[]>(eventsFile(configDir))) ?? [];

describe('the analytics catalog', () => {
  it(
    "is the backend's, byte for byte",
    { skip: existsSync(BACKEND_CATALOG) ? false : 'roughbook-backend is not beside this repo' },
    () => {
      const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      assert.equal(
        read(path.join(here, '..', 'telemetry', 'catalog.json')),
        read(BACKEND_CATALOG),
        'Copy roughbook-backend/contracts/event-catalog.json to src/telemetry/catalog.json.'
      );
    }
  );

  it('lets the studio send its own events with exactly their props', () => {
    assert.ok(fitsCatalog('studio.started', STARTED));
    assert.ok(fitsCatalog('error.reported', { code: 'RUN_NOT_FOUND', area: 'cli' }));
    for (const [type, props] of [
      ['studio.started', { ...STARTED, repo: 'C:/clients/acme' }],
      ['studio.started', { studioVersion: '0.2.0', os: 'linux' }],
      ['studio.started', { ...STARTED, agents: [{ id: 'codex', version: 'has spaces' }] }],
      ['error.reported', { code: 'Cannot read properties of undefined', area: 'cli' }],
      ['project.created', { projectId: '11111111-1111-4111-8111-111111111111' }],
      ['file.opened', {}]
    ] as const) {
      assert.equal(fitsCatalog(type, props), false, `${type} ${JSON.stringify(props)}`);
    }
  });
});

describe('studio analytics', () => {
  const env = (configDir: string, extra: Record<string, string> = {}) => ({
    ROUGHBOOK_CONFIG_DIR: configDir,
    ...extra
  });

  it('keeps nothing until the designer says yes, nor with ROUGHBOOK_TELEMETRY=off', async () => {
    const unasked = await signedInConfig();
    assert.equal(
      await recordEvent({ configDir: unasked, env: env(unasked) }, 'studio.started', STARTED),
      false
    );
    const no = await signedInConfig(false);
    assert.equal(
      await recordEvent({ configDir: no, env: env(no) }, 'studio.started', STARTED),
      false
    );
    const yes = await signedInConfig(true);
    const off = env(yes, { ROUGHBOOK_TELEMETRY: 'off' });
    assert.equal(await recordEvent({ configDir: yes, env: off }, 'studio.started', STARTED), false);
    for (const dir of [unasked, no, yes]) assert.deepEqual(await waiting(dir), []);
  });

  it('sends what waits in batches, keeps it offline, drops a refused batch, and stops at no', async () => {
    const configDir = await signedInConfig(true);
    const where = { configDir, env: env(configDir) };
    let answer: () => ReturnType<typeof ok> | 'offline' = () => 'offline';
    const fake = backend({ 'POST /events': () => answer() });
    const api = new StudioApi({
      server: SERVER,
      token: 'rbi_token',
      userAgent: 'test',
      fetch: fake.fetch
    });

    for (let i = 0; i < 60; i++)
      await recordEvent(where, 'error.reported', { code: 'OFFLINE', area: 'cli' });
    assert.deepEqual(await flushEvents(where, api), { sent: 0, left: 60 });

    answer = () => ok({ accepted: 50, duplicates: 0 });
    assert.deepEqual(await flushEvents(where, api), { sent: 60, left: 0 });
    const batches = fake.requests.filter(request => request.url.endsWith('/events')).slice(-2);
    assert.deepEqual(
      batches.map(request => (request.body as { events: QueuedEvent[] }).events.length),
      [50, 10]
    );
    const [first] = (batches[0]!.body as { events: QueuedEvent[] }).events;
    assert.deepEqual(Object.keys(first!).sort(), ['id', 'occurredAt', 'props', 'type', 'version']);
    assert.match(first!.id, /^[0-9a-f-]{36}$/);

    await recordEvent(where, 'studio.started', STARTED);
    answer = () => refused('INVALID_REQUEST', 400);
    assert.deepEqual(
      await flushEvents(where, api),
      { sent: 0, left: 0 },
      'a refused batch is dropped'
    );

    await recordEvent(where, 'studio.started', STARTED);
    answer = () => refused('ANALYTICS_NOT_CONSENTED', 403);
    assert.deepEqual(await flushEvents(where, api), { sent: 0, left: 0 });

    // A month-old event is not sent: the backend would refuse it.
    await recordEvent(where, 'studio.started', STARTED, new Date(Date.now() - 30 * 86_400_000));
    answer = () => ok({ accepted: 0, duplicates: 0 });
    const before = fake.requests.length;
    assert.deepEqual(await flushEvents(where, api), { sent: 0, left: 0 });
    assert.equal(fake.requests.length, before);
  });

  it('asks at login, saves the answer here and on the backend, and leaves it unasked without a terminal', async () => {
    for (const [answer, expected] of [
      ['y', true],
      ['', false],
      [null, null]
    ] as const) {
      const configDir = await tempDir('roughbook-login-');
      const io = recordingIo([answer]);
      const polls = [ok({ token: 'rbi_new', installId: 'install-2' })];
      const fake = backend({
        'POST /auth/device': () =>
          ok(
            {
              deviceCode: 'rbd_code',
              userCode: 'BCDF-GHJK',
              verificationUri: 'http://localhost:3000/link',
              verificationUriComplete: 'http://localhost:3000/link?code=BCDF-GHJK',
              expiresIn: 600,
              interval: 5
            },
            201
          ),
        'POST /auth/token': () => polls.shift()!,
        'GET /me': () =>
          ok({
            user: { id: 'u1', email: 'alice@example.test', name: 'Alice' },
            webUrl: 'http://localhost:3000'
          }),
        'PUT /telemetry': request =>
          ok({ analyticsConsent: (request.body as { consent: boolean }).consent })
      });
      const code = await main(['login', '--no-browser'], {
        cwd: configDir,
        env: env(configDir),
        io,
        fetch: fake.fetch,
        sleep: async () => {},
        openUrl: async () => true
      });
      assert.equal(code, 0, io.errors.join('\n'));
      assert.ok(io.lines.some(line => line.includes('http://localhost:3000/analytics')));
      const put = fake.requests.find(request => request.url.endsWith('/telemetry'));
      assert.deepEqual(put?.body ?? null, expected === null ? null : { consent: expected });
      assert.equal((await readSettings(configDir)).analyticsConsent, expected);
    }
  });

  it('turns it on and off with roughbook telemetry, and says so in status', async () => {
    const configDir = await signedInConfig();
    const io = recordingIo();
    const fake = backend({
      'PUT /telemetry': request =>
        ok({ analyticsConsent: (request.body as { consent: boolean }).consent }),
      'GET /me': () => ok({ user: { id: 'u1', email: 'alice@example.test', name: 'Alice' } }),
      'GET /projects': () => ok([])
    });
    const run = (argv: string[], extra: Record<string, string> = {}) =>
      main(argv, { cwd: configDir, env: env(configDir, extra), io, fetch: fake.fetch });

    assert.equal(await run(['telemetry']), 0);
    assert.match(io.lines.at(-1)!, /Not answered yet/);
    assert.equal(await run(['telemetry', 'on']), 0);
    assert.equal((await readSettings(configDir)).analyticsConsent, true);
    await run(['status']);
    assert.ok(io.lines.includes('Analytics:  shared'), io.lines.join('\n'));

    await recordEvent({ configDir, env: env(configDir) }, 'studio.started', STARTED);
    assert.equal(await run(['telemetry', 'off']), 0);
    assert.deepEqual(await waiting(configDir), [], 'what waited is dropped');
    assert.deepEqual(
      fake.requests
        .filter(request => request.url.endsWith('/telemetry'))
        .map(request => request.body),
      [{ consent: true }, { consent: false }]
    );
    assert.equal(await run(['telemetry', 'maybe']), 1);

    // Switched off on the machine: every request says so, and status too.
    await run(['status'], { ROUGHBOOK_TELEMETRY: 'off' });
    assert.ok(io.lines.includes('Analytics:  off on this machine (ROUGHBOOK_TELEMETRY)'));
    assert.equal(fake.requests.at(-1)!.headers['x-roughbook-telemetry'], 'off');
  });

  it('reports a failed command by its code only, and sends it when the server answers', async () => {
    const configDir = await signedInConfig(true);
    const io = recordingIo();
    const fake = backend({
      'PUT /telemetry': () => refused('SERVER_BUSY', 500),
      'POST /events': () => ok({ accepted: 1, duplicates: 0 })
    });
    assert.equal(
      await main(['telemetry', 'off'], {
        cwd: configDir,
        env: env(configDir),
        io,
        fetch: fake.fetch
      }),
      1
    );
    const sent = fake.requests.find(request => request.url.endsWith('/events'));
    assert.deepEqual(
      (sent?.body as { events: QueuedEvent[] }).events.map(event => [event.type, event.props]),
      [['error.reported', { code: 'SERVER_BUSY', area: 'cli' }]]
    );
    assert.deepEqual(await waiting(configDir), []);

    // The studio's own refusals are sentences, not failures, and are not reported.
    await main(['telemetry', 'maybe'], {
      cwd: configDir,
      env: env(configDir),
      io,
      fetch: fake.fetch
    });
    assert.equal(fake.requests.filter(request => request.url.endsWith('/events')).length, 1);
  });
});
