// The local server (S1 step 6): who it answers, what it serves, and the local UI's actions done
// with the CLI's own parts, against a fake backend and a fake pseudo-terminal.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { WebSocket } from 'ws';
import type { Detection } from '../agents/types.js';
import { StudioApi } from '../api/client.js';
import { outboxFor } from '../api/outbox.js';
import type { CommandContext } from '../commands/context.js';
import { main } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import { saveSettings } from '../config/settings.js';
import type { PtyModule } from '../launch/pty.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
import { handoffLine } from '../runs/slots.js';
import { listRuns, saveRun } from '../runs/store.js';
import type { StartedRun } from '../runs/types.js';
import { createLocalServer } from '../server/app.js';
import {
  FIRST_WAIT_MS,
  FRESH_ENOUGH_MS,
  LONGEST_WAIT_MS,
  ProjectCache
} from '../server/projectCache.js';
import { defaultEnvironment } from '../environment/read.js';
import { LocalStudio } from '../server/studio.js';
import { Terminals } from '../server/terminals.js';
import { STUDIO_VERSION } from '../version.js';
import {
  assertCarriesNoRepoContent,
  fakeFetch,
  notFound,
  ok,
  recordingIo,
  refused,
  type RecordedRequest
} from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const BACKEND = 'http://localhost:4000';
const PROJECT = `/orgs/${ORG}/projects/site`;
const LOCAL_TOKEN = 'local-token-for-the-tests-only';
const DEV_URL = 'http://localhost:3100';
const AGENT = 'C:/tools/claude.exe';

/** A web sketch's entry file, as the backend sends it to pull. */
const SKETCH_INDEX = {
  path: 'index.tsx',
  encoding: 'utf8',
  content:
    'import { motion } from "motion/react";\n\nexport default function Hero() {\n  return <motion.img className="w-full" src="/api/files/project/site/hero.png" alt="" />;\n}\n'
};

const ITERATION_SOURCE = `export default function Hero() {
  const lockup = 'server-test lockup 41b7, only in this repo';
  return <section className="grid min-h-[90vh] place-items-center">{lockup}</section>;
}
`;

type Spawned = {
  file: string;
  args: string[];
  cwd: string;
  written: string[];
  sizes: [number, number][];
  killed: boolean;
  emit(data: string): void;
  exit(code: number): void;
};

/** A pseudo-terminal that runs nothing: it records what it was asked and says what it is told. */
function fakePty(): { module: PtyModule; spawned: Spawned[] } {
  const spawned: Spawned[] = [];
  const module: PtyModule = {
    spawn(file, args, options) {
      const onData: ((data: string) => void)[] = [];
      const onExit: ((event: { exitCode: number }) => void)[] = [];
      const record: Spawned = {
        file,
        args,
        cwd: options.cwd,
        written: [],
        sizes: [],
        killed: false,
        emit: data => onData.forEach(listener => listener(data)),
        exit: exitCode => onExit.forEach(listener => listener({ exitCode }))
      };
      spawned.push(record);
      return {
        pid: spawned.length,
        onData: listener => (onData.push(listener), { dispose() {} }),
        onExit: listener => (onExit.push(listener), { dispose() {} }),
        write: data => void record.written.push(data),
        resize: (columns, rows) => void record.sizes.push([columns, rows]),
        kill: () => {
          record.killed = true;
          record.exit(1);
        }
      };
    }
  };
  return { module, spawned };
}

function detection(): Detection {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'terminal',
    found: true,
    executable: { command: AGENT, prefixArgs: [], source: 'PATH' },
    version: '2.1.286',
    signedIn: true,
    signIn: 'claude.ai',
    headless: { ready: false, reason: 'Set ANTHROPIC_API_KEY.' },
    capabilities: { interactive: true, headless: true, permissions: true, usage: true }
  };
}

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

type Answer = { status: number; headers: IncomingHttpHeaders; body: Buffer };

/** A request with any Host and Origin, which fetch would not let a test choose. */
function raw(
  port: number,
  method: string,
  pathname: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, method, path: pathname, headers },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk as Buffer));
        response.on('end', () =>
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            body: Buffer.concat(chunks)
          })
        );
      }
    );
    request.on('error', reject);
    if (body !== undefined) request.end(JSON.stringify(body));
    else request.end();
  });
}

describe('the local server', () => {
  let root: string;
  let repo: string;
  let port: number;
  let origin: string;
  let studio: LocalStudio;
  let backend: ReturnType<typeof fakeFetch>;
  let pty: ReturnType<typeof fakePty>;
  let server: http.Server | undefined;
  let next = 1;
  /** Screenshots asked for, as "<dev url> <page>/<component>/<iteration>". */
  const shots: string[] = [];
  /** What editors were started with, and what went on the clipboard. */
  const editorLaunches: { command: string; args: string[]; env?: Record<string, string> }[] = [];
  const copied: string[] = [];

  /** A call as the local UI makes it: this server's Host and Origin, and the token. */
  const api = async (method: 'GET' | 'POST', pathname: string, body?: unknown) => {
    const answer = await raw(
      port,
      method,
      pathname,
      {
        host: `127.0.0.1:${port}`,
        origin,
        authorization: `Bearer ${LOCAL_TOKEN}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body
    );
    return { status: answer.status, json: JSON.parse(answer.body.toString('utf8') || 'null') };
  };

  before(async () => {
    // Made here rather than with tempDir(), whose cleanup would run when this hook ends.
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'roughbook-server-'));
    repo = path.join(root, 'client-app');
    const configDir = path.join(root, 'config');
    fs.mkdirSync(path.join(repo, 'src', 'app'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'rough'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      '{\n  "name": "client-app-private",\n  "dependencies": { "next": "^16.3.8" }\n}\n'
    );
    fs.writeFileSync(
      path.join(repo, 'src', 'app', 'page.tsx'),
      "export default function Page() {\n  return <main className='client-private-layout'>Client home page</main>;\n}\n"
    );
    fs.writeFileSync(
      path.join(repo, '.gitignore'),
      '/node_modules\n/rough/.roughbook/\n/rough/.screenshots/\n'
    );
    const link: RepoLink = {
      version: 1,
      orgId: ORG,
      project: 'site',
      roughCommitted: true,
      appDir: 'src/app'
    };
    fs.writeFileSync(path.join(repo, 'rough', 'roughbook.json'), renderRepoLink(link));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], {
        cwd: repo,
        stdio: 'ignore'
      });
    git('init', '--quiet');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'Prepared');
    await saveCredentials(configDir, {
      server: BACKEND,
      installId: 'install-1',
      token: 'rbi_servertoken',
      signedInAs: null,
      savedAt: new Date().toISOString()
    });

    const startRuns = (request: RecordedRequest) => {
      const body = request.body as { kind: string; directions?: unknown[]; parent?: string };
      const count = body.kind === 'generate' ? body.directions!.length : 1;
      const runs: StartedRun[] = Array.from({ length: count }, () => {
        const iteration = `iteration-${String(next).padStart(2, '0')}`;
        next += 1;
        return {
          runId: `eeeeeeee-eeee-4eee-8eee-${String(next).padStart(12, '0')}`,
          iteration,
          parent: body.parent ?? null,
          targetFolder: `rough/home/hero/${iteration}`,
          prompt: `Write ${iteration}.\nUse them as {{roughbook:asset-origin}}/api/files/... in this iteration.\n`,
          placeholders: { assetOrigin: '{{roughbook:asset-origin}}' },
          checks: [{ kind: 'entry-file', file: 'index.tsx' }]
        };
      });
      return ok(runs, 201);
    };
    const routes: [string, RegExp, (request: RecordedRequest) => ReturnType<typeof ok>][] = [
      [
        'GET',
        /^\/me$/,
        () =>
          ok({
            user: { id: 'u1', email: 'dana@example.test', name: null },
            webUrl: 'http://localhost:3000'
          })
      ],
      ['POST', /^\/heartbeat$/, () => ok({ seenAt: 'now' })],
      ['POST', /^\/events$/, () => ok({ accepted: 1, duplicates: 0 })],
      ['POST', new RegExp(`^${PROJECT}/runs$`), startRuns],
      ['POST', new RegExp(`^/orgs/${ORG}/runs/[0-9a-f-]+/finish$`), () => ok({ ok: true })],
      [
        'POST',
        /\/iterations\/iteration-\d+\/(select|reject|rating|feedback|status)$/,
        () => ok({ ok: true })
      ],
      ['POST', /\/iterations\/iteration-\d+\/reviews$/, () => ok({ id: 'review-01' }, 201)],
      ['GET', /\/iterations\/iteration-\d+\/reviews$/, () => ok([])],
      [
        'GET',
        new RegExp(`^${PROJECT}$`),
        () =>
          ok({
            slug: 'site',
            name: 'Site',
            delivery: { componentsDir: 'src/components', publicDir: 'public', devUrl: '' },
            pages: [
              {
                slug: 'home',
                name: 'Home',
                components: [{ slug: 'hero', name: 'Hero', selectedIteration: 1, iterations: [] }]
              }
            ]
          })
      ],
      [
        'POST',
        new RegExp(`^${PROJECT}/promotions$`),
        () =>
          ok(
            {
              promotionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              prompt: 'Write: {{roughbook:target-file}}\n',
              placeholders: {
                targetFile: '{{roughbook:target-file}}',
                targetDir: '{{roughbook:target-dir}}',
                publicDir: '{{roughbook:public-dir}}'
              },
              copyMarkdown: null,
              componentName: 'Hero',
              defaults: { componentsDir: 'src/components', publicDir: 'public' },
              assets: [],
              missingAssets: []
            },
            201
          )
      ],
      [
        'GET',
        new RegExp(`^${PROJECT}/pages/home/components/hero/ratings$`),
        () => ok({ 'iteration-01': { mine: 4, average: 3.5, count: 2 } })
      ],
      [
        'GET',
        new RegExp(`^${PROJECT}/pages/home/components/hero/sketches$`),
        () =>
          ok([
            {
              id: 'iteration-40',
              number: 40,
              name: 'Quiet editorial',
              direction: 'Quiet editorial',
              status: 'exploring',
              parent: null,
              created: null
            }
          ])
      ],
      [
        'POST',
        new RegExp(`^${PROJECT}/pages/home/components/hero/sketches/iteration-40/pull$`),
        () => {
          const iteration = `iteration-${String(next).padStart(2, '0')}`;
          next += 1;
          return ok({ iteration, parent: 'iteration-40', files: [SKETCH_INDEX] }, 201);
        }
      ],
      [
        'POST',
        new RegExp(`^${PROJECT}/pages/home/components/hero/sketches/iteration-41/pull$`),
        () => refused('SKETCH_RUNNING', 409)
      ],
      [
        'GET',
        new RegExp(`^${PROJECT}/files/project/hero\\.png$`),
        () => ({ status: 200, text: 'PNG-BYTES' })
      ],
      [
        'GET',
        new RegExp(`^${PROJECT}/files/library/mark\\.svg$`),
        () => ({ status: 200, text: '<svg/>' })
      ]
    ];
    backend = fakeFetch(request => {
      const route = new URL(request.url).pathname.replace('/v1/api/studio', '');
      const found = routes.find(
        ([method, pattern]) => method === request.method && pattern.test(route)
      );
      return found ? found[2](request) : refused('NOT_FOUND', 404);
    });

    pty = fakePty();
    port = await freePort();
    origin = `http://127.0.0.1:${port}`;
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
      detect: async adapter =>
        adapter.id === 'claude-code'
          ? detection()
          : adapter.id === 'cursor'
            ? {
                ...notFound(adapter),
                found: true,
                version: '3.24.9',
                executable: {
                  command: 'C:/cursor/Cursor.exe',
                  prefixArgs: ['C:/cursor/resources/app/out/cli.js'],
                  env: { ELECTRON_RUN_AS_NODE: '1' },
                  source: 'PATH'
                }
              }
            : notFound(adapter),
      launchTerminal: async () => {},
      launchEditor: async launch => void editorLaunches.push(launch),
      copyText: async text => {
        copied.push(text);
        return true;
      },
      runHeadless: async () => ({
        ok: true,
        exitCode: 0,
        cancelled: false,
        error: null,
        usage: null
      }),
      screenshot: async (_repo, devUrl, target) => {
        shots.push(`${devUrl} ${target.page}/${target.component}/${target.iteration}`);
        return { files: {}, warning: null };
      },
      runCommand: async () => ({ ok: false, stdout: '', stderr: 'not run', code: null }),
      waitForStop: async () => {},
      stdio: { input: new PassThrough(), output: new PassThrough(), interactive: false }
    };
    studio = new LocalStudio({
      context,
      api: new StudioApi({
        server: BACKEND,
        token: 'rbi_servertoken',
        userAgent: 'test',
        fetch: backend.fetch
      }),
      link,
      devUrl: DEV_URL,
      port,
      environment: defaultEnvironment(),
      pty: { ok: true, pty: pty.module }
    });
    const created = createLocalServer({
      studio,
      port,
      token: LOCAL_TOKEN,
      uiDir: null,
      devUrl: DEV_URL,
      project: 'site'
    });
    server = created;
    await new Promise<void>(resolve => created.listen(port, '127.0.0.1', resolve));
  });

  after(async () => {
    studio?.close();
    server?.closeAllConnections();
    await new Promise(resolve => (server ? server.close(resolve) : resolve(undefined)));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('answers only its own host and page, and only with the token', async () => {
    const as = (headers: Record<string, string>) => raw(port, 'GET', '/api/state', headers);
    const host = `127.0.0.1:${port}`;
    // A page whose own domain points at 127.0.0.1 still names that domain.
    assert.equal(
      (await as({ host: `evil.example:${port}`, authorization: `Bearer ${LOCAL_TOKEN}` })).status,
      403
    );
    assert.equal((await as({ host })).status, 401);
    assert.equal((await as({ host, authorization: 'Bearer nearly-the-token' })).status, 401);
    assert.equal(
      (await as({ host, authorization: `Bearer ${LOCAL_TOKEN}`, origin: 'https://evil.example' }))
        .status,
      403
    );
    const state = await api('GET', '/api/state');
    assert.equal(state.status, 200);
    assert.equal(state.json.data.project.slug, 'site');
    assert.deepEqual(state.json.data.terminal, { builtin: true });
    assert.equal(state.json.data.webUrl, 'http://localhost:3000');
    // Agents are listed without the paths they were found at.
    assert.ok(!JSON.stringify(state.json.data.agents).includes(AGENT));

    const page = await raw(port, 'GET', '/', { host: `localhost:${port}` });
    assert.equal(page.status, 503, 'no UI is built in the tests');
  });

  it("serves the linked project's and library's asset files to the dev server, once each", async () => {
    const before = backend.requests.length;
    const asset = (pathname: string) => raw(port, 'GET', pathname, { host: `127.0.0.1:${port}` });
    const png = await asset('/api/files/project/site/hero.png');
    assert.equal(png.status, 200);
    assert.equal(png.headers['content-type'], 'image/png');
    assert.equal(png.body.toString(), 'PNG-BYTES');
    assert.equal((await asset('/api/files/project/site/hero.png')).status, 200);
    const svg = await asset('/api/files/library/mark.svg');
    assert.match(String(svg.headers['content-security-policy']), /sandbox/);
    assert.equal(backend.requests.length - before, 2, 'the second fetch of hero.png was kept');

    assert.equal((await asset('/api/files/project/another-project/hero.png')).status, 404);
    assert.equal((await asset('/api/files/project/site/..%2F.env')).status, 404);
    assert.equal((await asset('/api/files/project/site/missing.png')).status, 404);
    assert.equal(
      (await raw(port, 'GET', '/api/files/project/site/hero.png', { host: `evil.example:${port}` }))
        .status,
      403
    );
  });

  it("starts a run in the built-in terminal with the agent's own command, naming this server for assets", async () => {
    const started = await api('POST', '/api/runs', {
      page: 'home',
      component: 'hero',
      mode: 'interactive',
      terminal: 'builtin',
      kind: 'generate',
      directions: [{ direction: 'Quiet editorial' }],
      cols: 100,
      rows: 30
    });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    const [run] = started.json.data.runs;
    assert.equal(run.iteration, 'iteration-01');
    assert.equal(started.json.data.launched.kind, 'builtin');

    // The agent itself, never a shell, in the repo, with the one-line instruction.
    const session = pty.spawned.at(-1)!;
    assert.equal(session.file, AGENT);
    assert.equal(session.cwd, repo);
    assert.equal(session.args.at(-1), handoffLine(run.promptFile, true));

    const prompt = fs.readFileSync(path.join(repo, ...run.promptFile.split('/')), 'utf8');
    assert.ok(prompt.includes(`Use them as http://127.0.0.1:${port}/api/files/...`));
    assert.ok(!prompt.includes('{{roughbook:'));
    assert.ok(fs.existsSync(path.join(repo, 'rough/home/hero/iteration-01/index.tsx')));

    const runs = await api('GET', '/api/runs');
    assert.equal(runs.json.data[0].terminal.status, 'running');
    assert.equal((await api('GET', `/api/runs/${run.runId}/prompt`)).json.data.prompt, prompt);

    const refusedRun = await api('POST', '/api/runs', {
      page: 'home',
      component: 'hero',
      mode: 'interactive',
      kind: 'generate',
      directions: []
    });
    assert.equal(refusedRun.status, 400);
    const unattended = await api('POST', '/api/runs', {
      page: 'home',
      component: 'hero',
      mode: 'headless',
      kind: 'generate',
      directions: [{ direction: 'Loud' }]
    });
    assert.equal(unattended.status, 400);
    assert.match(unattended.json.message, /ANTHROPIC_API_KEY/);
  });

  it("joins a run's terminal over a socket with the token, scrollback first", async () => {
    const session = pty.spawned.at(-1)!;
    session.emit('Welcome to the agent\r\n');
    const [info] = (await api('GET', '/api/terminals')).json.data;
    const url = `ws://127.0.0.1:${port}/api/terminals/${info.id}`;

    const refusedSocket = await new Promise<number>(resolve => {
      const socket = new WebSocket(url, ['roughbook.wrong'], { origin });
      socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
      socket.on('open', () => resolve(101));
    });
    assert.equal(refusedSocket, 403);
    const foreignPage = await new Promise<number>(resolve => {
      const socket = new WebSocket(url, [`roughbook.${LOCAL_TOKEN}`], {
        origin: 'https://evil.example'
      });
      socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
      socket.on('open', () => resolve(101));
    });
    assert.equal(foreignPage, 403);

    const socket = new WebSocket(url, [`roughbook.${LOCAL_TOKEN}`], { origin });
    const messages: { type: string; data?: string; exitCode?: number }[] = [];
    socket.on('message', raw => messages.push(JSON.parse(String(raw))));
    await new Promise(resolve => socket.on('open', resolve));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(messages[0]!.type, 'snapshot');
    assert.match(messages[0]!.data!, /Welcome to the agent/);

    socket.send(JSON.stringify({ type: 'input', data: 'y' }));
    socket.send(JSON.stringify({ type: 'resize', cols: 140, rows: 40 }));
    socket.send('not json');
    session.emit('Writing the iteration\r\n');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(session.written, ['y']);
    assert.deepEqual(session.sizes.at(-1), [140, 40]);
    assert.ok(messages.some(message => message.type === 'data' && /Writing/.test(message.data!)));

    // Closing the page leaves the session running; it belongs to the run.
    socket.close();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(session.killed, false);
  });

  it('finishes a run, flags a write outside it, and puts it back', async () => {
    const [run] = (await api('GET', '/api/runs')).json.data;
    fs.writeFileSync(path.join(repo, 'rough/home/hero/iteration-01/index.tsx'), ITERATION_SOURCE);
    for (const name of ['stray', 'other']) {
      fs.writeFileSync(
        path.join(repo, 'src', 'app', `${name}.ts`),
        `export const ${name} = 'written by the agent';\n`
      );
    }
    const strays = ['src/app/other.ts', 'src/app/stray.ts'];

    // Before Done, the local UI asks what changed outside the iteration, to say whose it was.
    const checks = await api('GET', `/api/runs/${run.runId}/checks`);
    assert.deepEqual(checks.json.data.outOfScope, strays);
    assert.equal((await api('POST', `/api/runs/${run.runId}/done`, { mine: 'src' })).status, 400);
    const done = await api('POST', `/api/runs/${run.runId}/done`, {});
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.deepEqual(done.json.data.run.outOfScope, strays);
    assert.equal(done.json.data.run.outcome, 'completed_with_warnings');
    assert.equal(done.json.data.run.finishedBy, 'local-ui');

    // The run card reads each run's putBack, so it stops offering Put it back for those files.
    const putBack = async () =>
      (await api('GET', '/api/runs')).json.data.find(
        (item: { runId: string }) => item.runId === run.runId
      ).putBack;
    assert.equal(await putBack(), undefined);
    assert.equal(
      (await api('POST', `/api/runs/${run.runId}/revert`, { file: 'src/app/page.tsx' })).status,
      400
    );
    const reverted = await api('POST', `/api/runs/${run.runId}/revert`, {
      file: 'src/app/stray.ts'
    });
    assert.equal(reverted.json.data.result, 'removed');
    assert.ok(!fs.existsSync(path.join(repo, 'src/app/stray.ts')));
    assert.deepEqual(await putBack(), ['src/app/stray.ts']);

    // Put back with roughbook revert instead, while the local UI is open.
    const io = recordingIo();
    const cli = ['revert', 'home/hero/iteration-01', 'src/app/other.ts'];
    const env = { ROUGHBOOK_CONFIG_DIR: path.join(root, 'config') };
    assert.equal(await main(cli, { cwd: repo, env, io }), 0, io.errors.join('\n'));
    assert.deepEqual(io.lines, ['src/app/other.ts: Removed: the run created it.']);
    assert.deepEqual(await putBack(), strays);

    // The agent quits; Stop ends a session that is still going.
    pty.spawned.at(-1)!.exit(0);
    const [info] = (await api('GET', '/api/terminals')).json.data;
    assert.deepEqual([info.status, info.exitCode, info.stopped], ['exited', 0, false]);
  });

  it("takes an iteration's screenshots again, only for one in this repo", async () => {
    const before = shots.length;
    const taken = await api('POST', '/api/iterations/home/hero/iteration-01/screenshots');
    assert.equal(taken.status, 200, JSON.stringify(taken.json));
    assert.deepEqual(taken.json.data, { files: {}, warning: null });
    assert.deepEqual(shots.slice(before), [`${DEV_URL} home/hero/iteration-01`]);
    const missing = await api('POST', '/api/iterations/home/hero/iteration-90/screenshots');
    assert.equal(missing.status, 400);
    assert.match(JSON.stringify(missing.json), /not in this repo/);
    assert.equal(shots.length, before + 1);
  });

  it("serves a screenshot to the page's own <img> with the image key, and to no one else", async () => {
    const file = path.join(repo, 'rough', '.screenshots', 'home', 'hero', 'iteration-01');
    fs.mkdirSync(file, { recursive: true });
    fs.writeFileSync(path.join(file, 'desktop.png'), 'PNG-SHOT');
    const shot = '/api/iterations/home/hero/iteration-01/screenshots/desktop';
    const host = `127.0.0.1:${port}`;
    const { shotKey } = (await api('GET', '/api/state')).json.data;
    assert.match(shotKey, /^[\w-]{32}$/);
    assert.notEqual(shotKey, LOCAL_TOKEN);

    const withToken = await raw(port, 'GET', shot, {
      host,
      authorization: `Bearer ${LOCAL_TOKEN}`
    });
    assert.equal(withToken.status, 200);
    assert.equal(withToken.body.toString(), 'PNG-SHOT');
    // An <img> cannot send a header, so the page puts the key in its address.
    const keyed = await raw(port, 'GET', `${shot}?key=${shotKey}`, { host });
    assert.equal(keyed.status, 200);
    assert.equal(keyed.headers['content-type'], 'image/png');
    assert.equal(keyed.headers['cache-control'], 'private, no-cache');
    // Unchanged since the card last drew it.
    const again = await raw(port, 'GET', `${shot}?key=${shotKey}`, {
      host,
      'if-none-match': String(keyed.headers.etag)
    });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);

    assert.equal((await raw(port, 'GET', shot, { host })).status, 401);
    assert.equal((await raw(port, 'GET', `${shot}?key=nearly-the-key`, { host })).status, 401);
    // The key reads screenshots and nothing else.
    assert.equal((await raw(port, 'GET', `/api/state?key=${shotKey}`, { host })).status, 401);
    assert.equal(
      (await raw(port, 'GET', `${shot}?key=${shotKey}`, { host: `evil.example:${port}` })).status,
      403
    );
  });

  it("sends the local UI's decisions through the outbox in the backend's shapes", async () => {
    const decide = (body: unknown) =>
      api('POST', '/api/iterations/home/hero/iteration-01/decisions', body);
    const sentTo = (route: string) =>
      backend.requests
        .filter(request => request.method === 'POST' && request.url.endsWith(route))
        .at(-1)?.body;

    assert.equal(
      (await decide({ kind: 'reject', reason: 'Too quiet', why: 'Flat' })).json.data.status,
      'sent'
    );
    assert.deepEqual(sentTo('/iteration-01/reject'), { reason: 'Too quiet', why: 'Flat' });
    await decide({ kind: 'notes', likes: ['The type scale'], dislikes: [] });
    assert.deepEqual(sentTo('/iteration-01/feedback'), { likes: ['The type scale'], dislikes: [] });
    await decide({ kind: 'status', status: 'promising' });
    assert.deepEqual(sentTo('/iteration-01/status'), { status: 'promising' });
    await decide({
      kind: 'review',
      decision: 'refine',
      observations: ['Headline wraps at 390 px'],
      fields: { clarity: 'Clear enough', craft: 7 },
      checklist: { mobile: true, desktop: 'yes' }
    });
    assert.deepEqual(sentTo('/iteration-01/reviews'), {
      decision: 'refine',
      observations: ['Headline wraps at 390 px'],
      fields: { clarity: 'Clear enough' },
      checklist: { mobile: true }
    });
    await decide({ kind: 'select', reason: 'Calmest' });
    assert.deepEqual(sentTo('/iteration-01/select'), { reason: 'Calmest' });

    // Ratings: on their own, or with a selection or a rejection; null takes one back.
    await decide({ kind: 'rate', rating: 4 });
    assert.deepEqual(sentTo('/iteration-01/rating'), { rating: 4 });
    await decide({ kind: 'rate', rating: null });
    assert.deepEqual(sentTo('/iteration-01/rating'), { rating: null });
    await decide({ kind: 'select', reason: 'Calmest', rating: 5 });
    assert.deepEqual(sentTo('/iteration-01/select'), { reason: 'Calmest', rating: 5 });
    await decide({ kind: 'reject', reason: 'Too quiet', rating: '' });
    assert.deepEqual(sentTo('/iteration-01/reject'), { reason: 'Too quiet', rating: null });
    const ratings = await api('GET', '/api/ratings/home/hero');
    assert.deepEqual(ratings.json.data, {
      'iteration-01': { mine: 4, average: 3.5, count: 2 }
    });
    assert.equal((await api('GET', '/api/ratings/home/..%2Fsecrets')).status, 400);

    for (const bad of [
      { kind: 'rate' },
      { kind: 'rate', rating: 0 },
      { kind: 'rate', rating: 2.5 },
      { kind: 'select', rating: '4' },
      { kind: 'reject', reason: '' },
      { kind: 'status', status: 'selected' },
      { kind: 'notes' },
      { kind: 'delete' }
    ]) {
      assert.equal((await decide(bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal(
      (
        await api('POST', '/api/iterations/home/hero/..%2F..%2Fsecrets/decisions', {
          kind: 'select'
        })
      ).status,
      400
    );
  });

  it('says it started and counts a failed request by its code, once the designer agreed', async () => {
    const configDir = path.join(root, 'config');
    const events = () =>
      backend.requests
        .filter(request => request.url.endsWith('/events'))
        .flatMap(
          request => (request.body as { events: { type: string; props: unknown }[] }).events
        );
    await studio.reportStarted();
    assert.deepEqual(events(), [], 'not without a yes');

    await saveSettings(configDir, { analyticsConsent: true });
    try {
      await studio.reportStarted();
      // A request the backend refuses: the code goes up, not the words.
      assert.equal((await api('GET', '/api/sketches/home/missing')).status, 404);
      // One the page made wrong is the page's own mistake, not counted.
      assert.equal(
        (await api('POST', '/api/iterations/home/hero/iteration-01/decisions', { kind: 'delete' }))
          .status,
        400
      );
      await studio.flushEvents();
      assert.deepEqual(
        events().map(event => [event.type, event.props]),
        [
          [
            'studio.started',
            {
              studioVersion: STUDIO_VERSION,
              os: 'windows',
              agents: [
                { id: 'claude-code', version: '2.1.286' },
                { id: 'cursor', version: '3.24.9' }
              ]
            }
          ],
          ['error.reported', { code: 'NOT_FOUND', area: 'local-ui' }]
        ]
      );
    } finally {
      await saveSettings(configDir, { analyticsConsent: null });
    }
  });

  it('lists the web sketches and pulls one into rough/, its asset URLs on this server', async () => {
    const listed = await api('GET', '/api/sketches/home/hero');
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    assert.deepEqual(
      (listed.json.data as { id: string }[]).map(item => item.id),
      ['iteration-40']
    );

    const pulled = await api('POST', '/api/sketches/home/hero/iteration-40/pull');
    assert.equal(pulled.status, 200, JSON.stringify(pulled.json));
    const { iteration, folder, advice } = pulled.json.data as {
      iteration: string;
      folder: string;
      advice: string[];
    };
    assert.equal(folder, `rough/home/hero/${iteration}`);
    assert.ok(
      fs
        .readFileSync(path.join(repo, ...folder.split('/'), 'index.tsx'), 'utf8')
        .includes(`src="${origin}/api/files/project/site/hero.png"`)
    );
    assert.deepEqual(advice, [
      'It imports motion, which this app does not list. Add it with: npm install motion',
      'It is styled with Tailwind classes, and this app does not list tailwindcss, so it will render unstyled here.'
    ]);
    assert.deepEqual(
      backend.requests.filter(request => request.url.endsWith('/pull')).map(item => item.body),
      [{}]
    );

    const running = await api('POST', '/api/sketches/home/hero/iteration-41/pull');
    assert.equal(running.status, 400);
    assert.match(running.json.message, /still being made on the web/);
    assert.equal((await api('GET', '/api/sketches/Home/hero')).status, 400);
    assert.equal((await api('POST', '/api/sketches/home/hero/latest/pull')).status, 400);
  });

  it('promotes in the built-in terminal, and no request carries code or a path', async () => {
    const promoted = await api('POST', '/api/promote', {
      page: 'home',
      component: 'hero',
      iteration: 'iteration-01',
      targetFile: 'src/components/Hero.tsx'
    });
    assert.equal(promoted.status, 200, JSON.stringify(promoted.json));
    assert.equal(promoted.json.data.launched, true);
    assert.equal(promoted.json.data.terminal.title, 'Promote Hero');
    assert.match(
      pty.spawned.at(-1)!.args.at(-1)!,
      /^Follow the instructions in rough\/home\/hero\/prompts\/promote-/
    );

    assertCarriesNoRepoContent(backend.requests, {
      repo,
      root,
      extraLines: ITERATION_SOURCE.split('\n'),
      // A small repo: its page, its package and one iteration.
      minimumLines: 8
    });
  });

  it('lists editors, and starts an editor run by opening the prompt and copying the instruction', async () => {
    const state = (await api('GET', '/api/state')).json.data;
    const kinds = Object.fromEntries(
      state.agents.map((item: { id: string; kind: string }) => [item.id, item.kind])
    );
    assert.equal(kinds['claude-code'], 'terminal');
    assert.equal(kinds.cursor, 'editor');
    assert.equal(kinds.other, 'editor');

    const before = { launches: editorLaunches.length, copied: copied.length };
    const unattended = await api('POST', '/api/runs', {
      page: 'home',
      component: 'hero',
      agent: 'cursor',
      mode: 'headless',
      kind: 'generate',
      directions: [{ direction: 'Quiet editorial' }]
    });
    assert.equal(unattended.status, 400, 'an editor is never unattended');
    assert.equal(editorLaunches.length, before.launches);
    const opened = await api('POST', '/api/runs', {
      page: 'home',
      component: 'hero',
      agent: 'cursor',
      mode: 'editor',
      kind: 'generate',
      directions: [{ direction: 'Quiet editorial' }, { direction: 'Loud poster' }]
    });
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    const runs = opened.json.data.runs as { promptFile: string; mode: string }[];
    assert.deepEqual(
      runs.map(run => run.mode),
      ['editor', 'editor']
    );
    const startBody = backend.requests.filter(request => request.url.endsWith('/runs')).at(-1)!
      .body as { agent: string; mode: string };
    assert.deepEqual([startBody.agent, startBody.mode], ['cursor', 'editor']);

    const launched = opened.json.data.launched;
    assert.equal(launched.kind, 'editor');
    assert.equal(launched.opened, 'editor');
    assert.equal(launched.copied, true);
    assert.deepEqual(
      launched.instructions,
      runs.map(run => handoffLine(run.promptFile, true))
    );
    // Cursor's exe as Node with its cli.js, the repo, then each prompt; no shell.
    const launch = editorLaunches.slice(before.launches);
    assert.equal(launch.length, 1);
    assert.equal(launch[0]!.command, 'C:/cursor/Cursor.exe');
    assert.deepEqual(launch[0]!.args, [
      'C:/cursor/resources/app/out/cli.js',
      repo,
      ...runs.map(run => path.join(repo, ...run.promptFile.split('/')))
    ]);
    assert.deepEqual(launch[0]!.env, { ELECTRON_RUN_AS_NODE: '1' });
    assert.deepEqual(copied.slice(before.copied), [launched.instructions[0]]);
  });

  it('asks the backend for the project and its ratings only when they may have changed', async () => {
    const reads = (ending: string) =>
      backend.requests.filter(request => request.method === 'GET' && request.url.endsWith(ending))
        .length;
    const projectReads = () => reads(PROJECT);
    const ratingsReads = () => reads('/components/hero/ratings');
    const ask = async (pathname: string) => {
      const answer = await api('GET', pathname);
      assert.equal(answer.status, 200, JSON.stringify(answer.json));
      return answer.json.data;
    };
    await ask('/api/runs');

    // The page's own action may have changed it; then one read serves every ask.
    await api('POST', '/api/agents/default', { agent: null });
    const before = { project: projectReads(), ratings: ratingsReads() };
    const asks = await Promise.all([1, 2, 3].map(() => ask('/api/project')));
    assert.equal(asks[0].tree.slug, 'site');
    for (let index = 0; index < 5; index += 1) await ask('/api/project');
    await ask('/api/project?fresh');
    assert.equal(projectReads() - before.project, 1);
    await ask('/api/ratings/home/hero');
    await ask('/api/ratings/home/hero');
    assert.equal(ratingsReads() - before.ratings, 1);

    // A run finished by the CLI or by an agent through MCP, seen in the run list.
    const [newest] = await listRuns(repo);
    const finished = { ...newest!, runId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
    await saveRun(repo, { ...finished, status: 'finished', finishedAt: new Date().toISOString() });
    await ask('/api/runs');
    await ask('/api/project');
    await ask('/api/project');
    assert.equal(projectReads() - before.project, 2);
    await ask('/api/ratings/home/hero');
    assert.equal(ratingsReads() - before.ratings, 2);

    // An iteration pulled or started from the CLI, seen on disk.
    const pulled = path.join(repo, 'rough', 'home', 'hero', 'iteration-77');
    fs.mkdirSync(pulled, { recursive: true });
    fs.writeFileSync(path.join(pulled, 'index.tsx'), ITERATION_SOURCE);
    assert.ok((await ask('/api/project')).local.iterations.includes('home/hero/iteration-77'));
    assert.equal(projectReads() - before.project, 3);

    // A decision that waited in the outbox, offline, reaching the backend.
    const offline = new StudioApi({
      server: BACKEND,
      token: 'rbi_token',
      userAgent: 'test',
      fetch: async () => {
        throw new TypeError('fetch failed');
      }
    });
    const status = `${PROJECT}/pages/home/components/hero/iterations/iteration-01/status`;
    const queued = await outboxFor(repo).send(offline, status, { status: 'promising' });
    assert.equal(queued.status, 'queued');
    await ask('/api/project');
    assert.equal(projectReads() - before.project, 3);
    await studio.flushOutbox();
    await ask('/api/project');
    assert.equal(projectReads() - before.project, 4);
    fs.rmSync(pulled, { recursive: true });
    fs.rmSync(path.join(repo, 'rough', '.roughbook', 'runs', `${finished.runId}.json`));
  });
});

describe("the local server's copy of the project", () => {
  type Tree = { version: number };
  function setup() {
    const clock = { now: 0 };
    const cache = new ProjectCache<Tree, string>(() => clock.now);
    const backend = { tree: { version: 1 } as Tree, reads: 0 };
    const read = async () => {
      backend.reads += 1;
      return backend.tree;
    };
    return { clock, cache, backend, read };
  }

  it('asks again after 30 seconds, twice as long after each read that found nothing new', async () => {
    const { clock, cache, backend, read } = setup();
    assert.equal(FIRST_WAIT_MS, 30_000);
    assert.equal(LONGEST_WAIT_MS, 120_000);
    // When each read happens, from the first: the wait goes 30 s, 60 s, 120 s, then stays.
    const readsAt: number[] = [];
    for (clock.now = 0; clock.now <= 600_000; clock.now += 1000) {
      const before = backend.reads;
      await cache.project(read);
      if (backend.reads > before) readsAt.push(clock.now);
    }
    assert.deepEqual(readsAt, [0, 30_000, 90_000, 210_000, 330_000, 450_000, 570_000]);

    // Something new: back to 30 seconds.
    backend.tree = { version: 2 };
    clock.now = 690_000;
    assert.deepEqual(await cache.project(read), { version: 2 });
    clock.now = 719_999;
    await cache.project(read);
    assert.equal(backend.reads, 8);
    clock.now = 720_000;
    await cache.project(read);
    assert.equal(backend.reads, 9);
  });

  it('asks at once when something may have changed, and when the designer comes back', async () => {
    const { clock, cache, backend, read } = setup();
    await cache.project(read);
    cache.invalidate();
    await cache.project(read);
    assert.equal(backend.reads, 2);

    // The same runs as before change nothing; different ones do.
    cache.notice('runs', 'a');
    cache.notice('runs', 'a');
    await cache.project(read);
    assert.equal(backend.reads, 2);
    cache.notice('runs', 'b');
    await cache.project(read);
    assert.equal(backend.reads, 3);

    // Coming back to the page: read again, unless it was read in the last five seconds.
    clock.now = FRESH_ENOUGH_MS - 1;
    await cache.project(read, true);
    assert.equal(backend.reads, 3);
    clock.now = FRESH_ENOUGH_MS;
    await cache.project(read, true);
    assert.equal(backend.reads, 4);
  });

  it('shares one read among every ask, and never lets an older read replace a newer one', async () => {
    const { cache } = setup();
    const answers: ((tree: Tree) => void)[] = [];
    let reads = 0;
    const slow = () => {
      reads += 1;
      return new Promise<Tree>(resolve => answers.push(resolve));
    };
    const first = [cache.project(slow), cache.project(slow), cache.project(slow, true)];
    assert.equal(reads, 1);
    // Changed while the first read was under way: that read may have missed it.
    cache.invalidate();
    const second = cache.project(slow);
    assert.equal(reads, 2);
    answers[1]!({ version: 2 });
    answers[0]!({ version: 1 });
    assert.deepEqual(await Promise.all(first), [{ version: 1 }, { version: 1 }, { version: 1 }]);
    assert.deepEqual(await second, { version: 2 });
    assert.deepEqual(await cache.project(slow), { version: 2 });
    assert.equal(reads, 2);
  });

  it('asks again after a failed read, rather than answering with the last project', async () => {
    const { cache, backend, read } = setup();
    await cache.project(read);
    cache.invalidate();
    await assert.rejects(
      cache.project(() => Promise.reject(new Error('offline'))),
      /offline/
    );
    assert.deepEqual(await cache.project(read), { version: 1 });
    assert.equal(backend.reads, 2);
  });

  it("reads a component's ratings once per read of the project, and again after a failure", async () => {
    const { cache, read } = setup();
    let reads = 0;
    const ratings = async () => `ratings ${++reads}`;
    await cache.project(read);
    assert.equal(await cache.ratings('home/hero', ratings), 'ratings 1');
    assert.equal(await cache.ratings('home/hero', ratings), 'ratings 1');
    assert.equal(await cache.ratings('home/footer', ratings), 'ratings 2');
    cache.invalidate();
    await cache.project(read);
    assert.equal(await cache.ratings('home/hero', ratings), 'ratings 3');

    await assert.rejects(cache.ratings('home/cta', () => Promise.reject(new Error('offline'))));
    assert.equal(await cache.ratings('home/cta', ratings), 'ratings 4');
  });
});

describe('built-in terminal sessions', () => {
  it('keep a bounded scrollback, ignore what is not a message, and say when they were stopped', () => {
    const pty = fakePty();
    const terminals = new Terminals(pty.module);
    const info = terminals.start({
      title: 't',
      command: AGENT,
      args: [],
      cwd: '.',
      env: {},
      runId: null,
      cols: 5,
      rows: 9999
    });
    const session = pty.spawned[0]!;
    session.emit('x'.repeat(2_500_000));
    const received: string[] = [];
    terminals.attach(info.id, { send: text => received.push(text) });
    const snapshot = JSON.parse(received[0]!) as { data: string };
    assert.equal(snapshot.data.length, 2_000_000);

    terminals.receive(info.id, '{"type":"input","data":42}');
    terminals.receive(info.id, '{"type":"resize","cols":"wide","rows":3}');
    terminals.receive(info.id, '[');
    assert.deepEqual(session.written, []);
    assert.deepEqual(session.sizes, [[120, 32]]);

    assert.equal(terminals.remove(info.id), false, 'a running session is kept');
    terminals.stop(info.id);
    assert.deepEqual(
      [terminals.get(info.id)!.status, terminals.get(info.id)!.stopped],
      ['exited', true]
    );
    assert.equal(terminals.remove(info.id), true);
    assert.equal(terminals.get(info.id), null);
  });
});
