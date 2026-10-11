import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { HeadlessResult } from '../agents/process.js';
import { ownEditor } from '../agents/editors.js';
import { hostLookup } from '../agents/index.js';
import type { Detection, HeadlessInvocation } from '../agents/types.js';
import { StudioApi } from '../api/client.js';
import type { Promotion } from '../api/types.js';
import { outboxFor } from '../api/outbox.js';
import { main, type MainOptions } from '../commands/index.js';
import { parseComponent, parseIteration } from '../commands/shared.js';
import { saveCredentials } from '../config/credentials.js';
import { readSettings } from '../config/settings.js';
import type { Launch } from '../launch/open.js';
import type { Executable } from '../launch/which.js';
import { serverCommand, thisStudio } from '../mcp/install.js';
import type { TerminalPlan } from '../launch/terminal.js';
import type { RepoLink } from '../repo/link.js';
import { checkTargetFile, fillInPrompt, referencedAssets } from '../runs/promote.js';
import { importedPackages } from '../runs/pull.js';
import { handoffLine } from '../runs/slots.js';
import { listRuns, saveRun } from '../runs/store.js';
import type { RunRecord, StartedRun } from '../runs/types.js';
import type { Shots } from '../screenshot/iteration.js';
import {
  fakeFetch,
  notFound,
  ok,
  recordingIo,
  refused,
  tempDir,
  type RecordedRequest
} from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';
const RUN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROMOTION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: 'src/app'
};
const PROJECT = `/orgs/${ORG}/projects/site`;
const HERO = `${PROJECT}/pages/home/components/hero/iterations`;
const AGENT_BIN = 'C:/tools/claude.exe';

const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');
const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

function detection(id: 'claude-code' | 'codex', found: boolean, headless = false): Detection {
  return {
    id,
    name: id === 'codex' ? 'Codex' : 'Claude Code',
    kind: 'terminal',
    found,
    executable: found ? { command: AGENT_BIN, prefixArgs: [], source: 'PATH' } : null,
    version: found ? '2.1.286' : null,
    signedIn: found ? true : null,
    signIn: found ? 'claude.ai' : null,
    headless: headless ? { ready: true } : { ready: false, reason: 'Set ANTHROPIC_API_KEY.' },
    capabilities: { interactive: true, headless: true, permissions: true, usage: true }
  };
}

function started(iteration: string, runId: string): StartedRun {
  return {
    runId,
    iteration,
    parent: null,
    targetFolder: `rough/home/hero/${iteration}`,
    prompt: `<task>\nGenerate ${iteration}.\n</task>\n`,
    checks: [
      { kind: 'entry-file', file: 'index.tsx' },
      { kind: 'approved-headline', version: 1, headline: 'Design that ships' }
    ]
  };
}

type Route = (request: RecordedRequest) => ReturnType<typeof ok> | 'offline';

/**
 * A linked, committed repo, a signed-in studio, and a fake backend answering by
 * "METHOD /path" under /v1/api/studio. Agents, terminals and screenshots are recorded, never run.
 */
async function setup(routes: Record<string, Route>, options: { headless?: boolean } = {}) {
  const repo = path.join(await tempDir('roughbook-flow-'), 'app');
  write(repo, 'package.json', '{}');
  write(repo, 'src/app/page.tsx', 'export default function Page() { return null; }\n');
  write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
  write(repo, '.gitignore', '/rough/.roughbook/\n/rough/.screenshots/\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], {
      cwd: repo,
      stdio: 'ignore'
    });
  git('init', '--quiet');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'start');

  const configDir = await tempDir('roughbook-config-');
  // Editors' user settings live here, never in the real home folder.
  const home = await tempDir('roughbook-home-');
  await saveCredentials(configDir, {
    server: SERVER,
    installId: 'install-1',
    token: 'rbi_token',
    signedInAs: 'dana@example.test',
    savedAt: new Date(0).toISOString()
  });
  let online = true;
  const fake = fakeFetch(request => {
    if (!online) return 'offline';
    const url = new URL(request.url);
    const route = routes[`${request.method} ${url.pathname.replace('/v1/api/studio', '')}`];
    return route ? route(request) : refused('NOT_FOUND', 404);
  });

  const io = recordingIo();
  const plans: TerminalPlan[] = [];
  const shots: string[] = [];
  const headless: HeadlessInvocation[] = [];
  const detections: Record<string, Detection> = {
    'claude-code': detection('claude-code', true, options.headless),
    codex: detection('codex', false)
  };
  /** What editors and the OS's opener were started with; a command in `failing` cannot start. */
  const editorLaunches: Launch[] = [];
  const failing = new Set<string>();
  const copied: string[] = [];
  let agentWrites: (invocation: HeadlessInvocation) => void = () => {};
  const env = {
    ROUGHBOOK_CONFIG_DIR: configDir,
    ...(options.headless ? { ANTHROPIC_API_KEY: 'test-key' } : {})
  };
  const commands: { executable: Executable; args: string[] }[] = [];
  const overrides: Partial<MainOptions> = {
    fetch: fake.fetch,
    platform: 'win32',
    home,
    runCommand: async (executable, args) => {
      commands.push({ executable, args });
      return { ok: true, stdout: '', stderr: '', code: 0 };
    },
    detect: async adapter => detections[adapter.id] ?? notFound(adapter),
    launchTerminal: async plan => void plans.push(plan),
    launchEditor: async launch => {
      if (failing.has(launch.command)) throw new Error(`spawn ${launch.command} ENOENT`);
      editorLaunches.push(launch);
    },
    copyText: async text => {
      copied.push(text);
      return true;
    },
    runHeadless: async (_adapter, invocation, runOptions): Promise<HeadlessResult> => {
      headless.push(invocation);
      agentWrites(invocation);
      runOptions.onEvent?.({ kind: 'file', name: 'index.tsx' });
      return {
        ok: true,
        exitCode: 0,
        cancelled: false,
        error: null,
        usage: {
          model: 'claude-sonnet-5-5',
          inputTokens: 1200,
          outputTokens: 3400,
          cacheReadTokens: 0,
          cacheWriteTokens: 100
        }
      };
    },
    screenshot: async (_repo, devUrl, target): Promise<Shots> => {
      shots.push(`${devUrl} ${target.iteration}`);
      return {
        files: { desktop: `rough/.screenshots/home/hero/${target.iteration}/desktop.png` },
        warning: null
      };
    }
  };
  const run = (argv: string[]) => main(argv, { cwd: repo, env, io, ...overrides });
  return {
    repo,
    io,
    run,
    plans,
    shots,
    headless,
    detections,
    editorLaunches,
    failing,
    copied,
    configDir,
    home,
    env,
    overrides,
    commands,
    requests: fake.requests,
    setOnline: (value: boolean) => (online = value),
    onAgent: (write: (invocation: HeadlessInvocation) => void) => (agentWrites = write),
    api: new StudioApi({ server: SERVER, token: 'rbi_token', userAgent: 'test', fetch: fake.fetch })
  };
}

const paths = (requests: RecordedRequest[]) =>
  requests.map(
    request => `${request.method} ${new URL(request.url).pathname.replace('/v1/api/studio', '')}`
  );

describe('targets and promotion helpers', () => {
  it('reads a component or an iteration, and nothing else', () => {
    assert.deepEqual(parseComponent('home/hero'), { page: 'home', component: 'hero' });
    assert.deepEqual(parseIteration('home/hero/iteration-02'), {
      page: 'home',
      component: 'hero',
      iteration: 'iteration-02'
    });
    for (const bad of ['home', 'home/hero/iteration-02', '../hero', 'Home/hero', '']) {
      assert.throws(() => parseComponent(bad), /Name the component/);
    }
    for (const bad of ['home/hero', 'home/hero/02', 'home/../iteration-02']) {
      assert.throws(() => parseIteration(bad), /Name the iteration/);
    }
  });

  it("finds the project's and library's asset files an iteration uses", () => {
    const sources = [
      'src="http://localhost:4000/api/files/project/site/hero%20shot.png" /api/files/library/mark.svg',
      '/api/files/project/other/theirs.png /api/files/project/site/hero%20shot.png /api/files/project/site/..%2Fx'
    ];
    assert.deepEqual(referencedAssets(sources, 'site'), [{ scope: 'library', file: 'mark.svg' }]);
    assert.deepEqual(referencedAssets(['/api/files/project/site/hero-shot.png'], 'site'), [
      { scope: 'project', file: 'hero-shot.png' }
    ]);
  });

  it('keeps the component file inside the repo and out of rough/ and public/', () => {
    assert.equal(checkTargetFile('src/components/Hero.tsx', 'public'), null);
    assert.match(checkTargetFile('../Hero.tsx', 'public')!, /relative path/);
    assert.match(checkTargetFile('C:/x/Hero.tsx', 'public')!, /relative path|\.tsx/);
    assert.match(checkTargetFile('rough/Hero.tsx', 'public')!, /rough/);
    assert.match(checkTargetFile('public/Hero.tsx', 'public')!, /public folder/);
    assert.match(checkTargetFile('src/Hero.ts', 'public')!, /\.tsx or \.jsx/);
  });

  it('fills in the stand-ins literally, even a path with a dollar sign', () => {
    const promotion = {
      prompt:
        'Write {{roughbook:target-file}} near {{roughbook:target-dir}}/ into {{roughbook:public-dir}}',
      placeholders: {
        targetFile: '{{roughbook:target-file}}',
        targetDir: '{{roughbook:target-dir}}',
        publicDir: '{{roughbook:public-dir}}'
      }
    } as Promotion;
    assert.equal(
      fillInPrompt(promotion, 'src/ui/Hero.tsx', 'web/$&public'),
      'Write src/ui/Hero.tsx near src/ui/ into web/$&public'
    );
  });
});

describe('roughbook agents', () => {
  it('lists the agents, saves a default, and tells the server versions only', async () => {
    const studio = await setup({ 'POST /heartbeat': () => ok({ seenAt: 'now' }) });
    assert.equal(await studio.run(['agents', '--default', 'claude-code']), 0);
    assert.equal((await readSettings(studio.configDir)).defaultAgent, 'claude-code');
    assert.ok(studio.io.lines.includes('* Claude Code (claude-code): 2.1.286, from PATH'));
    assert.ok(studio.io.lines.includes('  Codex (codex): not found'));
    const beat = studio.requests.find(request => request.url.endsWith('/heartbeat'))!;
    assert.deepEqual(beat.body, {
      studioVersion: (beat.body as { studioVersion: string }).studioVersion,
      os: 'windows',
      agents: [{ id: 'claude-code', version: '2.1.286', signedIn: true, headless: false }]
    });
    assert.doesNotMatch(JSON.stringify(beat.body), /tools|claude\.exe/);

    assert.equal(await studio.run(['agents', '--default', 'codex']), 1);
    assert.match(studio.io.errors.at(-1)!, /Codex/);
    assert.equal(await studio.run(['agents', '--default', 'vim']), 1);
    assert.match(studio.io.errors.at(-1)!, /Unknown agent vim/);
  });
});

describe('roughbook run, done and revert', () => {
  it('sends what waited in the outbox, then opens a session per direction', async () => {
    const studio = await setup({
      [`POST ${HERO}/iteration-04/reject`]: () => ok({ id: 'iteration-04' }),
      [`POST ${PROJECT}/runs`]: () =>
        ok([started('iteration-07', RUN_A), started('iteration-08', RUN_B)], 201)
    });
    studio.setOnline(false);
    const queued = await outboxFor(studio.repo).send(studio.api, `${HERO}/iteration-04/reject`, {
      reason: 'Too busy'
    });
    assert.equal(queued.status, 'queued');
    studio.setOnline(true);

    const code = await studio.run([
      'run',
      'home/hero',
      '--direction',
      'Quiet editorial',
      '--direction',
      'Loud poster'
    ]);
    assert.equal(code, 0, studio.io.errors.join('\n'));
    // The rejection reached the server before the prompts were compiled.
    assert.deepEqual(paths(studio.requests).slice(-2), [
      `POST ${HERO}/iteration-04/reject`,
      `POST ${PROJECT}/runs`
    ]);
    assert.deepEqual(studio.requests.at(-1)!.body, {
      page: 'home',
      component: 'hero',
      agent: 'claude-code',
      mode: 'interactive',
      kind: 'generate',
      directions: [{ direction: 'Quiet editorial' }, { direction: 'Loud poster' }]
    });
    assert.equal(studio.plans.length, 1);
    const plan = studio.plans[0]!;
    assert.equal(plan.kind, 'spawn');
    const launches = plan.kind === 'spawn' ? plan.launches : [];
    assert.equal(launches.length, 2);
    assert.match(
      launches[0]!.args.join(' '),
      new RegExp(`Follow the instructions in rough/home/hero/prompts/${RUN_A}\\.md`)
    );
    assert.match(read(studio.repo, `rough/home/hero/prompts/${RUN_B}.md`), /iteration-08/);
    assert.ok(fs.existsSync(path.join(studio.repo, 'rough/home/hero/iteration-07/index.tsx')));
    assert.ok(studio.io.lines.includes('When the agent has finished, run roughbook done.'));
  });

  it('refuses to start without saying what to run, or unattended without a key', async () => {
    const studio = await setup({});
    assert.equal(await studio.run(['run', 'home/hero']), 1);
    assert.match(studio.io.errors.at(-1)!, /Say what to run/);
    assert.equal(await studio.run(['run', 'home/hero', '--refine', 'iteration-02']), 1);
    assert.match(studio.io.errors.at(-1)!, /--intent/);
    assert.equal(await studio.run(['run', 'home/hero', '--direction', 'x', '--headless']), 1);
    assert.match(studio.io.errors.at(-1)!, /ANTHROPIC_API_KEY/);
    assert.equal(studio.requests.length, 0);
  });

  it('done flags a write outside the iteration, and revert puts it back', async () => {
    const studio = await setup({
      [`POST ${PROJECT}/runs`]: () => ok([started('iteration-07', RUN_A)], 201),
      [`POST /orgs/${ORG}/runs/${RUN_A}/finish`]: request =>
        ok({ status: (request.body as { outcome: string }).outcome })
    });
    assert.equal(await studio.run(['run', 'home/hero', '--direction', 'Quiet']), 0);
    // The agent writes its iteration, and strays into the app.
    write(
      studio.repo,
      'rough/home/hero/iteration-07/index.tsx',
      'export default function Hero() { return <h1>Design that ships</h1>; }\n'
    );
    const page = read(studio.repo, 'src/app/page.tsx');
    write(studio.repo, 'src/app/page.tsx', 'export default function Page() { return 1; }\n');

    assert.equal(await studio.run(['done', '--dev-url', 'http://localhost:3001']), 0);
    const finish = studio.requests.at(-1)!;
    assert.deepEqual(
      { ...(finish.body as object), durationMs: 0 },
      {
        outcome: 'completed_with_warnings',
        durationMs: 0,
        warnings: ['OUT_OF_SCOPE_WRITE'],
        outOfScopeWrites: 1,
        usage: null
      }
    );
    assert.deepEqual(studio.shots, ['http://localhost:3001 iteration-07']);
    assert.ok(studio.io.lines.includes('home/hero/iteration-07: completed, 1 warning'));
    assert.ok(
      studio.io.lines.includes('    roughbook revert home/hero/iteration-07 src/app/page.tsx')
    );

    assert.equal(await studio.run(['revert', 'home/hero/iteration-07', 'package.json']), 1);
    assert.match(studio.io.errors.at(-1)!, /not among the files/);
    assert.equal(
      await studio.run(['revert', 'home/hero/iteration-07', 'src/app/page.tsx']),
      0,
      studio.io.errors.join('\n')
    );
    assert.equal(read(studio.repo, 'src/app/page.tsx'), page);

    assert.equal(await studio.run(['done']), 0);
    assert.equal(studio.io.lines.at(-1), 'No run is open in this repo.');
  });

  it('done asks which run when several are open', async () => {
    const studio = await setup({
      [`POST ${PROJECT}/runs`]: () =>
        ok([started('iteration-07', RUN_A), started('iteration-08', RUN_B)], 201),
      [`POST /orgs/${ORG}/runs/${RUN_B}/finish`]: () => ok({ status: 'failed' })
    });
    await studio.run(['run', 'home/hero', '--direction', 'A', '--direction', 'B']);
    assert.equal(await studio.run(['done']), 1);
    assert.match(studio.io.errors.at(-1)!, /--all/);
    assert.equal(await studio.run(['done', 'iteration-08', '--failed', '--no-screenshots']), 0);
    const open = (await listRuns(studio.repo)).filter(item => item.status === 'started');
    assert.deepEqual(
      open.map(item => item.iteration),
      ['iteration-07']
    );
    assert.deepEqual(studio.shots, []);
  });

  it('run --headless runs the agent unattended and reports its tokens', async () => {
    const studio = await setup(
      {
        [`POST ${PROJECT}/runs`]: () => ok([started('iteration-07', RUN_A)], 201),
        [`POST /orgs/${ORG}/runs/${RUN_A}/finish`]: request =>
          ok({ status: (request.body as { outcome: string }).outcome })
      },
      { headless: true }
    );
    studio.onAgent(() =>
      write(
        studio.repo,
        'rough/home/hero/iteration-07/index.tsx',
        'export default function Hero() { return <h1>Design that ships</h1>; }\n'
      )
    );
    const code = await studio.run(['run', 'home/hero', '--direction', 'Quiet', '--headless']);
    assert.equal(code, 0, studio.io.errors.join('\n'));
    const invocation = studio.headless[0]!;
    assert.equal(invocation.command, AGENT_BIN);
    assert.ok(invocation.args.includes('--bare'));
    assert.equal(invocation.args[invocation.args.indexOf('--session-id') + 1], RUN_A);
    assert.equal(
      (studio.requests.find(request => request.url.endsWith('/runs'))!.body as { mode: string })
        .mode,
      'headless'
    );
    const finish = studio.requests.at(-1)!.body as { outcome: string; usage: unknown };
    assert.equal(finish.outcome, 'completed');
    assert.deepEqual(finish.usage, {
      model: 'claude-sonnet-5-5',
      inputTokens: 1200,
      outputTokens: 3400,
      cacheReadTokens: 0,
      cacheWriteTokens: 100
    });
    assert.ok(studio.io.lines.includes('  iteration-07: wrote index.tsx'));
    assert.ok(studio.io.lines.includes('home/hero/iteration-07: completed'));
    assert.equal(studio.shots.length, 1);
    assert.equal((await listRuns(studio.repo))[0]!.finishedBy, 'headless');
    // It ends when the agent exits, so its prompt does not tell it to finish through MCP.
    assert.equal(
      read(studio.repo, `rough/home/hero/prompts/${RUN_A}.md`),
      '<task>\nGenerate iteration-07.\n</task>\n'
    );
  });

  it('does not count what init rewrote while the run was going', async () => {
    const studio = await setup({
      [`POST ${PROJECT}/runs`]: () => ok([started('iteration-07', RUN_A)], 201),
      'GET /projects': () =>
        ok([{ id: ORG, name: 'Acme', role: 'owner', projects: [{ slug: 'site', name: 'Site' }] }]),
      [`POST /orgs/${ORG}/links`]: () =>
        ok(
          {
            linkId: 'link-1',
            org: { id: ORG, name: 'Acme' },
            project: { slug: 'site', name: 'Site' }
          },
          201
        ),
      [`POST /orgs/${ORG}/runs/${RUN_A}/finish`]: request =>
        ok({ status: (request.body as { outcome: string }).outcome })
    });
    // Prepared by an older studio: the rules file is the studio's own, and out of date.
    write(
      studio.repo,
      'rough/AGENTS.md',
      'Old rules.\n\nWritten by `roughbook init`; it rewrites this file.\n'
    );
    assert.equal(await studio.run(['run', 'home/hero', '--direction', 'Quiet']), 0);
    assert.equal(
      await studio.run(['init', '--project', 'site', '--yes']),
      0,
      studio.io.errors.join('\n')
    );
    assert.match(read(studio.repo, 'rough/AGENTS.md'), /Never edit an existing iteration/);
    write(
      studio.repo,
      'rough/home/hero/iteration-07/index.tsx',
      'export default function Hero() { return <h1>Design that ships</h1>; }\n'
    );
    assert.equal(await studio.run(['done']), 0, studio.io.errors.join('\n'));
    const finish = studio.requests.at(-1)!.body as { outcome: string; outOfScopeWrites: number };
    assert.equal(finish.outcome, 'completed', studio.io.lines.join('\n'));
    assert.equal(finish.outOfScopeWrites, 0);
  });
});

describe('whose changes', () => {
  const strayRoutes = () => ({
    [`POST ${PROJECT}/runs`]: () => ok([started('iteration-07', RUN_A)], 201),
    [`POST /orgs/${ORG}/runs/${RUN_A}/finish`]: (request: RecordedRequest) =>
      ok({ status: (request.body as { outcome: string }).outcome })
  });
  /** The agent writes its iteration; the designer edits the app meanwhile. */
  const agentAndDesignerWrite = (studio: Studio) => {
    write(
      studio.repo,
      'rough/home/hero/iteration-07/index.tsx',
      'export default function Hero() { return <h1>Design that ships</h1>; }\n'
    );
    write(studio.repo, 'src/app/page.tsx', 'export default function Page() { return 1; }\n');
  };

  it('leaves out what the designer says was their own, by file or folder', async () => {
    const studio = await setup(strayRoutes());
    assert.equal(await studio.run(['run', 'home/hero', '--direction', 'Quiet']), 0);
    // The prompt says whose the dev server is, and where the iteration renders.
    const text = read(studio.repo, `rough/home/hero/prompts/${RUN_A}.md`);
    assert.match(text, /never start, restart or stop it, or\nany other process/);
    assert.ok(text.includes('http://localhost:3000/rough-preview/home/hero/iteration-07'));

    agentAndDesignerWrite(studio);
    write(studio.repo, 'docs/notes.md', 'mine\n');
    assert.equal(
      await studio.run(['done', '--mine', 'docs', '--mine', 'src/app/page.tsx']),
      0,
      studio.io.errors.join('\n')
    );
    const finish = studio.requests.at(-1)!.body as {
      outcome: string;
      warnings: string[];
      outOfScopeWrites: number;
    };
    assert.deepEqual(
      [finish.outcome, finish.warnings, finish.outOfScopeWrites],
      ['completed', [], 0]
    );
    const record = (await listRuns(studio.repo))[0]!;
    assert.equal(record.finishedBy, 'done');
    assert.deepEqual(record.outOfScope, []);
    assert.deepEqual([...record.mine!].sort(), ['docs/notes.md', 'src/app/page.tsx']);
    assert.ok(
      studio.io.lines.includes('  2 files changed outside the iteration were yours, not counted.')
    );
  });

  it('asks whose the changes are, and counts them when nobody answers', async () => {
    const asked = await setup(strayRoutes());
    assert.equal(await asked.run(['run', 'home/hero', '--direction', 'Quiet']), 0);
    agentAndDesignerWrite(asked);
    asked.io.answers.push('y');
    assert.equal(await asked.run(['done']), 0, asked.io.errors.join('\n'));
    assert.ok(
      asked.io.lines.includes(
        '1 file changed outside rough/home/hero/iteration-07 since the run started:'
      )
    );
    assert.ok(asked.io.lines.includes('  src/app/page.tsx'));
    const claimed = (await listRuns(asked.repo))[0]!;
    assert.deepEqual(
      [claimed.outcome, claimed.outOfScope, claimed.mine],
      ['completed', [], ['src/app/page.tsx']]
    );

    const unanswered = await setup(strayRoutes());
    assert.equal(await unanswered.run(['run', 'home/hero', '--direction', 'Quiet']), 0);
    agentAndDesignerWrite(unanswered);
    assert.equal(await unanswered.run(['done']), 0);
    const counted = (await listRuns(unanswered.repo))[0]!;
    assert.deepEqual(
      [counted.outcome, counted.outOfScope, counted.mine],
      ['completed_with_warnings', ['src/app/page.tsx'], []]
    );
  });
});

describe('roughbook screenshot', () => {
  it("takes the last finished run's screenshots again, or a named iteration's", async () => {
    const studio = await setup({
      [`POST ${PROJECT}/runs`]: () => ok([started('iteration-07', RUN_A)], 201),
      [`POST /orgs/${ORG}/runs/${RUN_A}/finish`]: request =>
        ok({ status: (request.body as { outcome: string }).outcome })
    });
    assert.equal(await studio.run(['screenshot']), 1);
    assert.match(studio.io.errors.at(-1)!, /Name the iteration/);

    assert.equal(await studio.run(['run', 'home/hero', '--direction', 'Quiet']), 0);
    write(
      studio.repo,
      'rough/home/hero/iteration-07/index.tsx',
      'export default function Hero() { return <h1>Design that ships</h1>; }\n'
    );
    assert.equal(await studio.run(['done']), 0, studio.io.errors.join('\n'));
    assert.deepEqual(studio.shots, ['http://localhost:3000 iteration-07']);

    assert.equal(await studio.run(['screenshot']), 0, studio.io.errors.join('\n'));
    assert.equal(
      await studio.run([
        'screenshot',
        'home/hero/iteration-07',
        '--dev-url',
        'http://localhost:3123'
      ]),
      0
    );
    assert.deepEqual(studio.shots.slice(1), [
      'http://localhost:3000 iteration-07',
      'http://localhost:3123 iteration-07'
    ]);
    assert.ok(
      studio.io.lines.includes(
        'home/hero/iteration-07: rough/.screenshots/home/hero/iteration-07/desktop.png'
      )
    );
    // The preview route can render it: the registry lists it.
    assert.match(read(studio.repo, 'rough/preview-registry.ts'), /"home\/hero\/iteration-07"/);

    assert.equal(await studio.run(['screenshot', 'home/hero/iteration-09']), 1);
    assert.match(studio.io.errors.at(-1)!, /home\/hero\/iteration-09 is not in this repo/);
    assert.equal(await studio.run(['screenshot', 'x', '--dev-url', 'http://example.com']), 1);
    assert.equal(studio.shots.length, 3);
  });
});

const CURSOR = 'C:/cursor/Cursor.exe';
const CURSOR_CLI = 'C:/cursor/resources/app/out/cli.js';
const cursorFound = (): Detection => ({
  id: 'cursor',
  name: 'Cursor',
  kind: 'editor',
  found: true,
  executable: {
    command: CURSOR,
    prefixArgs: [CURSOR_CLI],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    source: 'PATH'
  },
  version: '3.24.9',
  signedIn: null,
  signIn: null,
  headless: { ready: false, reason: 'Cursor runs with you in it, never unattended.' },
  capabilities: { interactive: true, headless: false, permissions: false, usage: false }
});
const runNumber = (number: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, '0')}`;
/** A backend handing out a new iteration for each run asked for, from iteration-07. */
const handingOut = () => {
  let next = 7;
  return {
    [`POST ${PROJECT}/runs`]: (request: RecordedRequest) => {
      const body = request.body as { directions: { direction: string }[] };
      return ok(
        body.directions.map(({ direction }) => {
          const number = next++;
          const iteration = `iteration-${String(number).padStart(2, '0')}`;
          return {
            ...started(iteration, runNumber(number)),
            prompt: `<task>\nGenerate ${iteration}.\nDirection: ${direction}\n</task>\n`
          };
        }),
        201
      );
    },
    [`POST /orgs/${ORG}/runs/${runNumber(7)}/finish`]: (request: RecordedRequest) =>
      ok({ status: (request.body as { outcome: string }).outcome })
  };
};
const prompt = (number: number) => `rough/home/hero/prompts/${runNumber(number)}.md`;

describe('roughbook run in an editor', () => {
  const lookupHere = () => hostLookup({});

  it('opens the repo and the prompts in the editor, copies the first instruction, and finishes with done', async () => {
    const studio = await setup(handingOut());
    studio.detections.cursor = cursorFound();
    const code = await studio.run([
      'run',
      'home/hero',
      '--direction',
      'Quiet',
      '--direction',
      'Loud',
      '--agent',
      'cursor'
    ]);
    assert.equal(code, 0, studio.io.errors.join('\n'));
    const body = studio.requests.at(-1)!.body as { agent: string; mode: string };
    assert.deepEqual([body.agent, body.mode], ['cursor', 'editor']);
    const prompts = [prompt(7), prompt(8)];
    assert.deepEqual(studio.editorLaunches, [
      {
        command: CURSOR,
        args: [
          CURSOR_CLI,
          studio.repo,
          ...prompts.map(file => path.join(studio.repo, ...file.split('/')))
        ],
        env: { ELECTRON_RUN_AS_NODE: '1' }
      }
    ]);
    assert.deepEqual(studio.copied, [handoffLine(prompts[0]!, true)]);
    assert.match(
      studio.copied[0]!,
      /finish the run with the roughbook MCP tools: get_checks, then finish_run\.$/
    );
    assert.equal(studio.plans.length, 0, 'no terminal is opened for an editor');
    const said = studio.io.lines.join('\n');
    assert.match(said, /Opened the repo and the prompts in Cursor\./);
    assert.match(said, /On the clipboard, to paste into a new chat with Cursor's agent:/);
    assert.ok(studio.io.lines.includes(`  ${handoffLine(prompts[1]!, true)}`));

    // Done is the same as after a terminal run.
    write(
      studio.repo,
      'rough/home/hero/iteration-07/index.tsx',
      'export default function Hero() { return <h1>Design that ships</h1>; }\n'
    );
    assert.equal(await studio.run(['done', 'iteration-07']), 0, studio.io.errors.join('\n'));
    assert.ok(studio.io.lines.includes('home/hero/iteration-07: completed'));
  });

  it('opens the prompt in the default app when the editor cannot start, and is never unattended', async () => {
    const studio = await setup(handingOut());
    studio.detections.cursor = cursorFound();
    studio.failing.add(CURSOR);
    assert.equal(
      await studio.run(['run', 'home/hero', '--direction', 'Quiet', '--agent', 'cursor']),
      0,
      studio.io.errors.join('\n')
    );
    assert.deepEqual(studio.editorLaunches, [
      {
        command: 'rundll32',
        args: ['url.dll,FileProtocolHandler', path.join(studio.repo, ...prompt(7).split('/'))]
      }
    ]);
    assert.ok(studio.io.lines.includes(`Opened ${prompt(7)} with your default app.`));

    const asked = studio.requests.length;
    assert.equal(
      await studio.run([
        'run',
        'home/hero',
        '--direction',
        'Loud',
        '--agent',
        'cursor',
        '--headless'
      ]),
      1
    );
    assert.match(studio.io.errors.at(-1)!, /never unattended/);
    assert.equal(studio.requests.length, asked, 'no run was started');
  });

  it('uses an editor when no terminal agent is here, and your own editor through the default app', async () => {
    const studio = await setup(handingOut());
    studio.detections['claude-code'] = detection('claude-code', false);
    studio.detections.cursor = cursorFound();
    studio.detections.other = await ownEditor.detect(lookupHere());
    assert.equal(await studio.run(['run', 'home/hero', '--direction', 'Quiet']), 0);
    const first = studio.requests.at(-1)!.body as { agent: string; mode: string };
    assert.deepEqual([first.agent, first.mode], ['cursor', 'editor']);

    assert.equal(
      await studio.run(['run', 'home/hero', '--direction', 'Loud', '--agent', 'other']),
      0,
      studio.io.errors.join('\n')
    );
    const second = studio.requests.at(-1)!.body as { agent: string; mode: string };
    assert.deepEqual([second.agent, second.mode], ['other', 'editor']);
    assert.deepEqual(studio.editorLaunches.at(-1), {
      command: 'rundll32',
      args: ['url.dll,FileProtocolHandler', path.join(studio.repo, ...prompt(8).split('/'))]
    });
    assert.match(studio.io.lines.join('\n'), /a new chat with your agent/);

    delete studio.detections.cursor;
    assert.equal(await studio.run(['run', 'home/hero', '--direction', 'Third']), 1);
    assert.match(studio.io.errors.at(-1)!, /No coding agent or editor was found/);
  });
});

type Studio = Awaited<ReturnType<typeof setup>>;
/** Parsed JSON, read as freely as the server tests read the local server's answers. */
type Parsed = ReturnType<typeof JSON.parse>;
type ToolAnswer = { error: boolean; text: string; json: Parsed };

/**
 * An MCP client on `roughbook mcp`, run as the CLI runs it from `cwd`, answering roots/list with
 * `roots` when it has any.
 */
function mcpSession(studio: Studio, options: { cwd?: string; roots?: string[] } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const exited = main(['mcp'], {
    cwd: options.cwd ?? studio.repo,
    env: studio.env,
    io: studio.io,
    ...studio.overrides,
    waitForStop: () => new Promise(() => {}),
    stdio: { input, output, interactive: false }
  });
  const waiting = new Map<unknown, (message: Parsed) => void>();
  const lines: string[] = [];
  let buffer = '';
  output.on('data', chunk => {
    buffer += String(chunk);
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      lines.push(line);
      const message = JSON.parse(line);
      if (message.method === 'roots/list') {
        const roots = (options.roots ?? []).map(folder => ({ uri: pathToFileURL(folder).href }));
        input.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { roots } })}\n`);
      } else if (!message.method) {
        waiting.get(message.id)?.(message);
      }
    }
  });
  let next = 1;
  const request = (method: string, params: unknown) =>
    new Promise<Parsed>(resolve => {
      const id = next++;
      waiting.set(id, resolve);
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  return {
    lines,
    start: () =>
      request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: options.roots ? { roots: { listChanged: true } } : {},
        clientInfo: { name: 'test-editor', version: '1.0.0' }
      }),
    async call(name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer> {
      const answer = await request('tools/call', { name, arguments: args });
      const text: string = answer.result.content[0].text;
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        // A prompt, read as text.
      }
      return { error: answer.result.isError === true, text, json };
    },
    async close(): Promise<number> {
      input.end();
      return exited;
    }
  };
}

describe('roughbook mcp', () => {
  it("lets an editor's agent read, check and finish its run, as Done does", async () => {
    const studio = await setup(handingOut());
    studio.detections.cursor = cursorFound();
    assert.equal(
      await studio.run(['run', 'home/hero', '--direction', 'Quiet', '--agent', 'cursor']),
      0,
      studio.io.errors.join('\n')
    );
    assert.ok(
      studio.io.lines.includes(
        "Run roughbook mcp install cursor once, so Cursor's agent can check and finish runs itself."
      )
    );
    const runId = runNumber(7);
    assert.match(read(studio.repo, prompt(7)), new RegExp(`<finishing>\\nRoughbook run: ${runId}`));

    const mcp = mcpSession(studio);
    const init = await mcp.start();
    assert.equal(init.result.serverInfo.name, 'roughbook');
    const listed = await mcp.call('list_runs');
    assert.deepEqual(listed.json.runs, [
      {
        run: runId,
        iteration: 'home/hero/iteration-07',
        kind: 'generate',
        direction: 'Quiet',
        parent: null,
        agent: 'cursor',
        mode: 'editor',
        prompt: prompt(7),
        folder: 'rough/home/hero/iteration-07',
        startedAt: listed.json.runs[0].startedAt,
        repo: studio.repo
      }
    ]);

    // With one run open it need not be named.
    const read7 = await mcp.call('get_prompt');
    assert.equal(read7.text, read(studio.repo, prompt(7)));

    const before = await mcp.call('get_checks', { run: 'iteration-07' });
    assert.equal(before.json.now.passes, false);
    // Named by its folder, as an agent with the folder in front of it does.
    const byFolder = await mcp.call('get_checks', { run: 'rough/home/hero/iteration-07' });
    assert.equal(byFolder.json.run, runId);
    assert.equal(
      before.json.now.failure,
      'index.tsx is still the placeholder. Is the session finished?'
    );
    assert.deepEqual(before.json.checks, [
      'index.tsx exists in rough/home/hero/iteration-07, is not empty, and is no longer the placeholder.',
      'The approved headline (Version 1) appears in the source: "Design that ships"',
      'Nothing outside rough/home/hero/iteration-07/ changes.',
      'No file outside rough/ imports from rough/.'
    ]);

    // The agent writes the iteration, and one file it should not have.
    write(
      studio.repo,
      'rough/home/hero/iteration-07/index.tsx',
      'export default function Hero() { return <h1>Design that ships</h1>; }\n'
    );
    write(studio.repo, 'src/app/stray.ts', 'export const stray = true;\n');
    const after = await mcp.call('get_checks', { run: runId });
    assert.equal(after.json.now.failure, null);
    assert.deepEqual(after.json.now.changedOutsideFolder, ['src/app/stray.ts']);
    assert.match(after.json.next, /the designer decides at review/);
    const finishes = () =>
      paths(studio.requests).filter(item => item.endsWith(`/runs/${runId}/finish`)).length;
    assert.equal(finishes(), 0, 'get_checks finishes nothing');

    const finished = await mcp.call('finish_run', { run: runId.slice(0, 8) });
    assert.equal(finished.error, false, finished.text);
    assert.equal(finished.json.outcome, 'completed_with_warnings');
    assert.deepEqual(finished.json.changedOutsideFolder, ['src/app/stray.ts']);
    assert.deepEqual(finished.json.screenshots, [
      'rough/.screenshots/home/hero/iteration-07/desktop.png'
    ]);
    assert.equal(finished.json.reported, 'sent');
    assert.equal(finished.json.finishedBy, 'agent');
    assert.match(finished.json.next, /roughbook revert home\/hero\/iteration-07 <file>/);
    assert.deepEqual(studio.shots, ['http://localhost:3000 iteration-07']);
    const report = studio.requests.at(-1)!;
    assert.deepEqual(report.body, {
      outcome: 'completed_with_warnings',
      durationMs: (report.body as { durationMs: number }).durationMs,
      warnings: ['OUT_OF_SCOPE_WRITE'],
      outOfScopeWrites: 1,
      usage: null
    });
    assert.equal((await listRuns(studio.repo))[0]!.status, 'finished');

    // Finishing again changes nothing; the run is no longer listed.
    const again = await mcp.call('finish_run', { run: runId });
    assert.equal(again.json.alreadyFinished, true);
    assert.equal(finishes(), 1);
    // A finished run's checks are what Done found, not what changed since.
    write(studio.repo, 'src/app/later.ts', 'export const later = true;\n');
    const recorded = await mcp.call('get_checks', { run: runId });
    assert.deepEqual(recorded.json.now.changedOutsideFolder, ['src/app/stray.ts']);
    assert.match(recorded.json.next, /already finished; this is what Done found/);
    assert.deepEqual((await mcp.call('list_runs')).json.runs, []);
    assert.equal(await mcp.close(), 0);
    // Stdout carried protocol messages only.
    for (const line of mcp.lines) assert.equal(JSON.parse(line).jsonrpc, '2.0');
  });

  it("finds the repo from the client's folders or a path, and leaves unattended runs alone", async () => {
    const studio = await setup(handingOut());
    studio.detections.cursor = cursorFound();
    assert.equal(
      await studio.run(['run', 'home/hero', '--direction', 'Quiet', '--agent', 'cursor']),
      0
    );

    // Started outside any repo, with a client that does not say what it has open.
    const lost = mcpSession(studio, { cwd: studio.home });
    await lost.start();
    const refusedList = await lost.call('list_runs');
    assert.equal(refusedList.error, true);
    assert.match(refusedList.text, /Pass repo: the absolute path of the folder you have open/);
    for (const named of [
      studio.repo,
      pathToFileURL(studio.repo).href,
      path.join(studio.repo, 'src', 'app')
    ]) {
      const found = await lost.call('list_runs', { repo: named });
      assert.equal(found.json.runs.length, 1, named);
    }
    const notRepo = await lost.call('get_checks', { repo: studio.home });
    assert.match(notRepo.text, /is not in a Roughbook repo/);
    await lost.close();

    // A client saying it has a folder of the repo open.
    const rooted = mcpSession(studio, { cwd: studio.home, roots: [path.join(studio.repo, 'src')] });
    await rooted.start();
    assert.equal((await rooted.call('list_runs')).json.runs.length, 1);

    // An unattended run finishes when its agent exits, never through MCP.
    const unattended: RunRecord = {
      ...(await listRuns(studio.repo))[0]!,
      runId: runNumber(9),
      iteration: 'iteration-09',
      targetFolder: 'rough/home/hero/iteration-09',
      promptFile: prompt(9),
      mode: 'headless',
      agent: 'claude-code'
    };
    await saveRun(studio.repo, unattended);
    const several = await rooted.call('finish_run');
    assert.match(several.text, /^2 runs are open; name one with run:/);
    const headlessRefused = await rooted.call('finish_run', { run: 'iteration-09' });
    assert.equal(headlessRefused.error, true);
    assert.match(
      headlessRefused.text,
      /unattended run: the studio finishes it when its agent exits/
    );
    const badOutcome = await rooted.call('finish_run', { run: 'iteration-07', outcome: 'done' });
    assert.match(badOutcome.text, /outcome is failed or cancelled/);
    assert.equal(await rooted.close(), 0);
  });

  it('finishes with the files the designer said were theirs left out', async () => {
    const studio = await setup(handingOut());
    studio.detections.cursor = cursorFound();
    assert.equal(
      await studio.run(['run', 'home/hero', '--direction', 'Quiet', '--agent', 'cursor']),
      0
    );
    write(
      studio.repo,
      'rough/home/hero/iteration-07/index.tsx',
      'export default function Hero() { return <h1>Design that ships</h1>; }\n'
    );
    write(studio.repo, 'src/app/stray.ts', 'export const stray = true;\n');
    const mcp = mcpSession(studio);
    await mcp.start();
    const checks = await mcp.call('get_checks');
    assert.match(checks.json.next, /pass them to finish_run as mine/);
    assert.doesNotMatch(checks.json.next, /Fix what fails/);
    const bad = await mcp.call('finish_run', { mine: 'src' });
    assert.match(bad.text, /mine must be a list of paths/);
    const finished = await mcp.call('finish_run', { mine: ['src/app'] });
    assert.equal(finished.error, false, finished.text);
    assert.deepEqual(
      [finished.json.outcome, finished.json.changedOutsideFolder, finished.json.mine],
      ['completed', [], ['src/app/stray.ts']]
    );
    assert.equal(await mcp.close(), 0);
  });

  it('says how to add it when run in a terminal by a person', async () => {
    const studio = await setup({});
    const code = await main(['mcp'], {
      cwd: studio.repo,
      env: studio.env,
      io: studio.io,
      ...studio.overrides,
      stdio: { input: new PassThrough(), output: new PassThrough(), interactive: true }
    });
    assert.equal(code, 0);
    assert.match(studio.io.errors.at(-1)!, /To add it to your editors, run roughbook mcp install/);
  });

  it("adds itself to each editor's user settings and through each agent's own mcp add", async () => {
    const studio = await setup({});
    const server = serverCommand({ platform: 'win32', node: process.execPath, ...thisStudio() });
    const home = (...parts: string[]) => path.join(studio.home, ...parts);
    const readJsonFile = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
    const cursorFile = home('.cursor', 'mcp.json');
    const vscodeFile = home('AppData', 'Roaming', 'Code', 'User', 'mcp.json');
    const antigravityFile = home('.gemini', 'config', 'mcp_config.json');
    const olderAntigravity = home('.gemini', 'antigravity', 'mcp_config.json');
    const windsurfFile = home('.codeium', 'windsurf', 'mcp_config.json');
    // What was there stays; Antigravity's older, empty file is filled in.
    write(studio.home, '.cursor/mcp.json', '{ "mcpServers": { "other": { "command": "x" } } }');
    write(studio.home, '.gemini/antigravity/mcp_config.json', '');

    const editors = ['cursor', 'vscode', 'antigravity', 'windsurf'];
    assert.equal(await studio.run(['mcp', 'install', ...editors]), 0, studio.io.errors.join('\n'));
    const entry = { command: server.command, args: server.args };
    assert.deepEqual(readJsonFile(cursorFile), {
      mcpServers: { other: { command: 'x' }, roughbook: entry }
    });
    assert.deepEqual(readJsonFile(vscodeFile), {
      servers: { roughbook: { type: 'stdio', ...entry } }
    });
    for (const file of [antigravityFile, olderAntigravity, windsurfFile]) {
      assert.deepEqual(readJsonFile(file), { mcpServers: { roughbook: entry } }, file);
    }
    assert.ok(studio.io.lines.includes(`Cursor: roughbook added to ${cursorFile}`));
    assert.ok(server.args.includes('mcp'));

    studio.io.lines.length = 0;
    assert.equal(await studio.run(['mcp', 'install', 'cursor']), 0);
    assert.ok(studio.io.lines.includes(`Cursor: roughbook already in ${cursorFile}`));

    // --print shows the entry and writes nothing.
    fs.rmSync(windsurfFile);
    assert.equal(await studio.run(['mcp', 'install', 'windsurf', '--print']), 0);
    assert.ok(!fs.existsSync(windsurfFile));
    assert.ok(studio.io.lines.includes(`Windsurf: in ${windsurfFile}`));

    // A file with comments is left alone, with the entry to paste.
    const commented = '// mine\n{ "servers": {} }\n';
    write(studio.home, 'AppData/Roaming/Code/User/mcp.json', commented);
    assert.equal(await studio.run(['mcp', 'install', 'vscode']), 1);
    assert.equal(fs.readFileSync(vscodeFile, 'utf8'), commented);
    assert.ok(
      studio.io.lines.includes(
        `VS Code: ${vscodeFile} is not plain JSON, so it was left alone. Add this to it:`
      )
    );

    // Claude Code is told with its own command; Codex, not here, gets the line to run.
    studio.io.lines.length = 0;
    assert.equal(await studio.run(['mcp', 'install', 'claude-code', 'codex']), 1);
    assert.deepEqual(
      studio.commands.map(item => [item.executable.command, ...item.args]),
      [
        [AGENT_BIN, 'mcp', 'remove', '--scope', 'user', 'roughbook'],
        [
          AGENT_BIN,
          'mcp',
          'add',
          '--scope',
          'user',
          'roughbook',
          '--',
          server.command,
          ...server.args
        ]
      ]
    );
    assert.ok(studio.io.lines.includes('Claude Code: added roughbook with claude mcp add.'));
    assert.ok(studio.io.lines.includes('Codex was not found here. Once it is installed, run:'));

    assert.equal(await studio.run(['mcp', 'install', 'other']), 1);
    assert.match(studio.io.errors.at(-1)!, /Unknown editor other\. Choose one of: claude-code/);

    // With none named, each one found here: Claude Code and Cursor in this test.
    studio.detections.cursor = cursorFound();
    studio.commands.length = 0;
    fs.rmSync(cursorFile);
    assert.equal(await studio.run(['mcp', 'install']), 0, studio.io.lines.join('\n'));
    assert.equal(studio.commands.length, 2);
    assert.ok(fs.existsSync(cursorFile));
    assert.match(studio.io.lines.at(-1)!, /^Restart each one, or reload its window/);
  });

  it('no longer suggests installing once the editor has it', async () => {
    const studio = await setup(handingOut());
    studio.detections.cursor = cursorFound();
    assert.equal(await studio.run(['mcp', 'install', 'cursor']), 0);
    assert.equal(
      await studio.run(['run', 'home/hero', '--direction', 'Quiet', '--agent', 'cursor']),
      0
    );
    assert.ok(!studio.io.lines.some(line => line.includes('mcp install cursor once')));
  });
});

describe('roughbook review', () => {
  it('selects, rejects and notes, and says what the server did', async () => {
    const studio = await setup({
      [`POST ${HERO}/iteration-02/select`]: () =>
        ok([
          { id: 'iteration-02', status: 'selected' },
          { id: 'iteration-03', status: 'promising' }
        ]),
      [`POST ${HERO}/iteration-04/reject`]: () => ok({ id: 'iteration-04', status: 'rejected' }),
      [`POST ${HERO}/iteration-05/reviews`]: () => ok({ id: 'review-01' }, 201),
      [`POST ${HERO}/iteration-03/rating`]: () => ok({ mine: 4, average: 3.5, count: 2 })
    });
    assert.equal(
      await studio.run(['review', 'home/hero/iteration-02', '--select', '--reason', 'Calm']),
      0
    );
    assert.equal(studio.io.lines.at(-1), 'iteration-02 is selected.');
    assert.deepEqual(studio.requests.at(-1)!.body, { reason: 'Calm' });
    assert.match(studio.requests.at(-1)!.headers['idempotency-key']!, /^[0-9a-f-]{36}$/);

    assert.equal(
      await studio.run([
        'review',
        'home/hero/iteration-04',
        '--reject',
        'Too busy',
        '--why',
        'The grid fights the headline.'
      ]),
      0
    );
    assert.deepEqual(studio.requests.at(-1)!.body, {
      reason: 'Too busy',
      why: 'The grid fights the headline.'
    });

    // A rating on its own, or with a decision; none takes it back.
    assert.equal(await studio.run(['review', 'home/hero/iteration-03', '--rating', '4']), 0);
    assert.equal(studio.io.lines.at(-1), "Rated 4. The team's average is 3.5 from 2.");
    assert.deepEqual(studio.requests.at(-1)!.body, { rating: 4 });
    assert.equal(await studio.run(['review', 'home/hero/iteration-03', '--rating', 'none']), 0);
    assert.deepEqual(studio.requests.at(-1)!.body, { rating: null });
    assert.equal(
      await studio.run([
        'review',
        'home/hero/iteration-04',
        '--reject',
        'Too busy',
        '--rating',
        '2'
      ]),
      0
    );
    assert.deepEqual(studio.requests.at(-1)!.body, { reason: 'Too busy', rating: 2 });
    for (const bad of [
      ['--rating', '6'],
      ['--rating', '2.5'],
      ['--note', 'x', '--rating', '3']
    ]) {
      assert.equal(
        await studio.run(['review', 'home/hero/iteration-03', ...bad]),
        1,
        bad.join(' ')
      );
    }

    assert.equal(
      await studio.run([
        'review',
        'home/hero/iteration-05',
        '--note',
        'Headline wraps at 390 px',
        '--note',
        'CTA too quiet',
        '--decision',
        'refine'
      ]),
      0
    );
    assert.deepEqual(studio.requests.at(-1)!.body, {
      observations: ['Headline wraps at 390 px', 'CTA too quiet'],
      decision: 'refine'
    });

    studio.setOnline(false);
    assert.equal(await studio.run(['review', 'home/hero/iteration-05', '--note', 'Later']), 0);
    assert.match(studio.io.lines.at(-1)!, /outbox/);
    assert.equal(
      await studio.run(['review', 'home/hero/iteration-05', '--select', '--note', 'x']),
      1
    );
    assert.equal(await studio.run(['review', 'home/hero/iteration-05', '--reject', ' ']), 1);
  });
});

describe('roughbook pull', () => {
  const SKETCHES = `${PROJECT}/pages/home/components/hero/sketches`;
  const SKETCH_FILES = [
    {
      path: 'index.tsx',
      encoding: 'utf8',
      content:
        'import { motion } from "motion/react";\nimport { ArrowRight } from "lucide-react";\nimport "./styles.css";\n\nexport default function Hero() {\n  return (\n    <motion.section className="min-h-[100dvh]">\n      <img src="/api/files/project/site/hero.png" alt="" />\n      <ArrowRight />\n    </motion.section>\n  );\n}\n'
    },
    {
      path: 'styles.css',
      encoding: 'utf8',
      content: '.mark { background: url(/api/files/library/mark.svg); }\n'
    },
    {
      path: 'parts/badge.png',
      encoding: 'base64',
      content: Buffer.from([137, 80, 78, 71]).toString('base64')
    }
  ];
  const pulled = (iteration: string, files: unknown[] = SKETCH_FILES) =>
    ok({ iteration, parent: 'iteration-03', files }, 201);

  it('names the packages code imports, each once', () => {
    assert.deepEqual(
      importedPackages([
        'import { motion } from "motion/react";\nimport "./a.css";\nimport x from "@google/model-viewer/lib/x";',
        "const Three = await import('three');\nimport clsx from 'clsx';\nimport y from '/abs';\nimport { motion as m } from 'motion';"
      ]),
      ['motion', '@google/model-viewer', 'clsx', 'three']
    );
  });

  it('lists the sketches, pulls one as the next iteration, and says what the app lacks', async () => {
    const studio = await setup({
      [`GET ${SKETCHES}`]: () =>
        ok([
          {
            id: 'iteration-03',
            number: 3,
            name: 'Quiet editorial',
            direction: 'Quiet editorial',
            status: 'exploring',
            parent: null,
            created: null
          },
          {
            id: 'iteration-01',
            number: 1,
            name: 'Loud poster',
            direction: 'Loud poster',
            status: 'rejected',
            parent: null,
            created: null
          }
        ]),
      [`POST ${SKETCHES}/iteration-03/pull`]: () => pulled('iteration-08')
    });
    write(
      studio.repo,
      'package.json',
      JSON.stringify({
        dependencies: { next: '16.0.0', react: '19.2.0', 'lucide-react': '1.0.0' }
      })
    );
    write(studio.repo, 'pnpm-lock.yaml', '');

    assert.equal(await studio.run(['pull', 'home/hero']), 0, studio.io.errors.join('\n'));
    assert.deepEqual(studio.io.lines, [
      'Web sketches of home/hero, newest first:',
      '  iteration-03  Quiet editorial',
      '  iteration-01  Loud poster (rejected)',
      'Pull one with roughbook pull home/hero/<sketch>.'
    ]);

    assert.equal(
      await studio.run(['pull', 'home/hero/iteration-03']),
      0,
      studio.io.errors.join('\n')
    );
    // The request names the sketch, and carries nothing of the repo.
    const asked = studio.requests.at(-1)!;
    assert.equal(asked.method, 'POST');
    assert.deepEqual(asked.body, {});
    const folder = 'rough/home/hero/iteration-08';
    assert.ok(
      read(studio.repo, `${folder}/index.tsx`).includes(
        'src="http://127.0.0.1:4848/api/files/project/site/hero.png"'
      )
    );
    assert.equal(
      read(studio.repo, `${folder}/styles.css`),
      '.mark { background: url(http://127.0.0.1:4848/api/files/library/mark.svg); }\n'
    );
    assert.deepEqual(
      [...fs.readFileSync(path.join(studio.repo, folder, 'parts', 'badge.png'))],
      [137, 80, 78, 71]
    );
    assert.match(read(studio.repo, 'rough/preview-registry.ts'), /iteration-08/);
    assert.deepEqual(studio.io.lines.slice(4), [
      `home/hero/iteration-08: ${folder}, from the web sketch iteration-03 (3 files)`,
      'It imports motion, which this app does not list. Add it with: pnpm add motion',
      'It is styled with Tailwind classes, and this app does not list tailwindcss, so it will render unstyled here.',
      'Review it in roughbook start, or refine it: roughbook run home/hero --refine iteration-08 --intent "<what to change>"'
    ]);
  });

  it('writes nothing outside the new folder, never over an iteration, and says why it cannot', async () => {
    let files: unknown[] = [];
    const studio = await setup({
      [`POST ${SKETCHES}/iteration-03/pull`]: () => pulled('iteration-08', files),
      [`POST ${SKETCHES}/iteration-04/pull`]: () => refused('SKETCH_RUNNING', 409)
    });
    const page = read(studio.repo, 'src/app/page.tsx');
    for (const name of [
      '../../../src/app/page.tsx',
      'C:/evil.tsx',
      'parts\\evil.tsx',
      '.env.js',
      'index.html',
      'a/b/c/d/e.tsx'
    ]) {
      files = [SKETCH_FILES[0], { path: name, encoding: 'utf8', content: 'export default 1;\n' }];
      assert.equal(await studio.run(['pull', 'home/hero/iteration-03']), 1, name);
      assert.match(studio.io.errors.at(-1)!, /will not write/);
    }
    assert.equal(read(studio.repo, 'src/app/page.tsx'), page);
    assert.ok(!fs.existsSync(path.join(studio.repo, 'rough/home/hero/iteration-08')));

    files = SKETCH_FILES;
    write(studio.repo, 'rough/home/hero/iteration-08/index.tsx', 'export default () => null;\n');
    assert.equal(await studio.run(['pull', 'home/hero/iteration-03']), 1);
    assert.match(studio.io.errors.at(-1)!, /already exists/);
    assert.equal(
      read(studio.repo, 'rough/home/hero/iteration-08/index.tsx'),
      'export default () => null;\n'
    );

    assert.equal(await studio.run(['pull', 'home/hero/iteration-04']), 1);
    assert.match(studio.io.errors.at(-1)!, /still being made on the web/);
  });

  it('is not counted against a run that was going while it was pulled', async () => {
    const studio = await setup({
      [`POST ${PROJECT}/runs`]: () => ok([started('iteration-07', RUN_A)], 201),
      [`POST ${SKETCHES}/iteration-03/pull`]: () => pulled('iteration-08'),
      [`POST /orgs/${ORG}/runs/${RUN_A}/finish`]: request =>
        ok({ status: (request.body as { outcome: string }).outcome })
    });
    assert.equal(await studio.run(['run', 'home/hero', '--direction', 'Quiet']), 0);
    assert.equal(await studio.run(['pull', 'home/hero/iteration-03']), 0);
    write(
      studio.repo,
      'rough/home/hero/iteration-07/index.tsx',
      'export default function Hero() { return <h1>Design that ships</h1>; }\n'
    );
    assert.equal(await studio.run(['done']), 0, studio.io.errors.join('\n'));
    const finish = studio.requests.at(-1)!.body as { outcome: string; outOfScopeWrites: number };
    assert.equal(finish.outcome, 'completed');
    assert.equal(finish.outOfScopeWrites, 0);
  });
});

describe('roughbook promote', () => {
  const tree = (selectedIteration: number | null) => ({
    slug: 'site',
    name: 'Site',
    delivery: { componentsDir: 'src/components', publicDir: 'public', devUrl: '' },
    pages: [
      {
        slug: 'home',
        name: 'Home',
        components: [{ slug: 'hero', name: 'Hero', selectedIteration, iterations: [] }]
      }
    ]
  });
  const promotion: Promotion = {
    promotionId: PROMOTION,
    prompt:
      'Write: {{roughbook:target-file}}\nRead components near {{roughbook:target-dir}}/\n- /api/files/project/site/hero.png -> /rough/home/hero/hero.png (already copied to {{roughbook:public-dir}}/rough/home/hero/hero.png)\n',
    placeholders: {
      targetFile: '{{roughbook:target-file}}',
      targetDir: '{{roughbook:target-dir}}',
      publicDir: '{{roughbook:public-dir}}'
    },
    copyMarkdown: '# Hero\n\nDesign that ships\n',
    componentName: 'Hero',
    defaults: { componentsDir: 'src/components', publicDir: 'public' },
    assets: [{ scope: 'project', file: 'hero.png', publicUrl: '/rough/home/hero/hero.png' }],
    missingAssets: [{ scope: 'library', file: 'mark.svg' }]
  };

  it('copies the assets and the copy, fills in the paths, and opens the agent', async () => {
    const studio = await setup({
      [`GET ${PROJECT}`]: () => ok(tree(2)),
      [`POST ${PROJECT}/promotions`]: () => ok(promotion, 201),
      [`GET ${PROJECT}/files/project/hero.png`]: () => ({ status: 200, text: 'PNG-BYTES' })
    });
    write(
      studio.repo,
      'rough/home/hero/iteration-02/index.tsx',
      'export default () => <img src="http://localhost:4000/api/files/project/site/hero.png" style={{ mask: "url(/api/files/library/mark.svg)" }} />;\n'
    );
    const code = await studio.run(['promote', 'home/hero']);
    assert.equal(code, 0, studio.io.errors.join('\n'));

    // The server hears which asset files, never where anything goes in the repo.
    const asked = studio.requests.find(request => request.url.endsWith('/promotions'))!;
    assert.deepEqual(asked.body, {
      page: 'home',
      component: 'hero',
      iteration: 'iteration-02',
      assets: [
        { scope: 'project', file: 'hero.png' },
        { scope: 'library', file: 'mark.svg' }
      ]
    });
    assert.equal(read(studio.repo, 'public/rough/home/hero/hero.png'), 'PNG-BYTES');
    assert.equal(read(studio.repo, 'rough/home/hero/copy.md'), promotion.copyMarkdown);
    const promptFile = `rough/home/hero/prompts/promote-${PROMOTION}.md`;
    assert.equal(
      read(studio.repo, promptFile),
      'Write: src/components/Hero.tsx\nRead components near src/components/\n- /api/files/project/site/hero.png -> /rough/home/hero/hero.png (already copied to public/rough/home/hero/hero.png)\n'
    );
    const plan = studio.plans[0]!;
    assert.equal(plan.kind, 'spawn');
    assert.match(
      plan.kind === 'spawn' ? plan.launches[0]!.args.join(' ') : '',
      new RegExp(`Promote Hero.*Follow the instructions in ${promptFile}`)
    );
    assert.ok(studio.io.lines.some(line => /mark\.svg is not in the library/.test(line)));
  });

  it('never overwrites the app, and needs a selected iteration or a named one', async () => {
    const studio = await setup({
      [`GET ${PROJECT}`]: () => ok(tree(null)),
      [`POST ${PROJECT}/promotions`]: () => ok(promotion, 201)
    });
    write(studio.repo, 'rough/home/hero/iteration-02/index.tsx', 'export default () => null;\n');
    assert.equal(await studio.run(['promote', 'home/hero']), 1);
    assert.match(studio.io.errors.at(-1)!, /No iteration of Hero is selected/);
    assert.equal(
      await studio.run([
        'promote',
        'home/hero',
        '--iteration',
        'iteration-02',
        '--to',
        'src/app/page.tsx'
      ]),
      1
    );
    assert.match(studio.io.errors.at(-1)!, /already exists/);
    assert.equal(await studio.run(['promote', 'home/hero', '--iteration', 'iteration-09']), 1);
    assert.match(studio.io.errors.at(-1)!, /no index\.tsx/);
    assert.ok(!studio.requests.some(request => request.url.endsWith('/promotions')));
  });
});
