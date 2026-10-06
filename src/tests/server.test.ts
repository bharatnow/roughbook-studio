// The local server (S1 step 6): who it answers, what it serves, and the local UI's actions done
// with the CLI's own parts, against a fake backend and a fake pseudo-terminal.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WebSocket } from 'ws';
import type { Detection } from '../agents/types.js';
import { StudioApi } from '../api/client.js';
import type { CommandContext } from '../commands/context.js';
import { saveCredentials } from '../config/credentials.js';
import type { PtyModule } from '../launch/pty.js';
import { renderRepoLink, type RepoLink } from '../repo/link.js';
import type { StartedRun } from '../runs/types.js';
import { createLocalServer } from '../server/app.js';
import { LocalStudio } from '../server/studio.js';
import { Terminals } from '../server/terminals.js';
import {
  assertCarriesNoRepoContent,
  fakeFetch,
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
      ['POST', new RegExp(`^${PROJECT}/runs$`), startRuns],
      ['POST', new RegExp(`^/orgs/${ORG}/runs/[0-9a-f-]+/finish$`), () => ok({ ok: true })],
      [
        'POST',
        /\/iterations\/iteration-\d+\/(select|reject|feedback|status)$/,
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
      fetch: backend.fetch,
      sleep: async () => {},
      openUrl: async () => true,
      platform: 'win32',
      detect: async () => detection(),
      launchTerminal: async () => {},
      runHeadless: async () => ({
        ok: true,
        exitCode: 0,
        cancelled: false,
        error: null,
        usage: null
      }),
      screenshot: async () => ({ files: {}, warning: null }),
      waitForStop: async () => {}
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
    assert.equal(session.args.at(-1), `Follow the instructions in ${run.promptFile}`);

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
    fs.writeFileSync(
      path.join(repo, 'src/app/stray.ts'),
      "export const stray = 'written by the agent';\n"
    );

    const done = await api('POST', `/api/runs/${run.runId}/done`, {});
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.deepEqual(done.json.data.run.outOfScope, ['src/app/stray.ts']);
    assert.equal(done.json.data.run.outcome, 'completed_with_warnings');

    assert.equal(
      (await api('POST', `/api/runs/${run.runId}/revert`, { file: 'src/app/page.tsx' })).status,
      400
    );
    const reverted = await api('POST', `/api/runs/${run.runId}/revert`, {
      file: 'src/app/stray.ts'
    });
    assert.equal(reverted.json.data.result, 'removed');
    assert.ok(!fs.existsSync(path.join(repo, 'src/app/stray.ts')));

    // The agent quits; Stop ends a session that is still going.
    pty.spawned.at(-1)!.exit(0);
    const [info] = (await api('GET', '/api/terminals')).json.data;
    assert.deepEqual([info.status, info.exitCode, info.stopped], ['exited', 0, false]);
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

    for (const bad of [
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
