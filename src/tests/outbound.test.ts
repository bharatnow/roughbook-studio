// Ground rule 2 of the split plan: no studio request carries code or a path on this machine. A
// whole session runs against a fake backend (sign-in, init, agents, runs in a terminal and
// unattended, done with a stray edit, revert, reviews, promote, status, sign-out) while the
// agent writes iterations full of lines that exist nowhere else. Every request is recorded, and
// none may contain a line of any file in the repo, the repo's path, or the home folder.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { AgentAdapter, Detection } from '../agents/types.js';
import { main } from '../commands/index.js';
import type { StartedRun } from '../runs/types.js';
import {
  assertCarriesNoRepoContent,
  fakeFetch,
  notFound,
  ok,
  recordingIo,
  refused,
  tempDir,
  type RecordedRequest
} from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'rbi_outboundtoken';
const PROJECT = `/orgs/${ORG}/projects/site`;
const PROMOTION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** What the agent writes: lines that exist only in this repo. */
const ITERATION_SOURCE = `import { motion } from 'motion/react';

const palette = ['#0b1f3a', '#f4e9d8', '#c2410c']; // studio-only palette 7f3a
const headlineTracking = 'tracking-[-0.04em] leading-[0.92]';

export default function Hero() {
  return (
    <section className="grid min-h-[88vh] grid-cols-12 bg-[#0b1f3a] text-[#f4e9d8]">
      <motion.h1 className={headlineTracking}>Design that ships</motion.h1>
      <img src="http://localhost:4000/api/files/project/site/hero.png" alt="" />
    </section>
  );
}
`;
const STRAY_EDIT = "export const strayHelper = () => 'written outside rough by the agent';\n";

function detection(found: boolean): Detection {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'terminal',
    found,
    executable: found ? { command: 'C:/tools/claude.exe', prefixArgs: [], source: 'PATH' } : null,
    version: '2.1.286',
    signedIn: true,
    signIn: 'claude.ai',
    headless: { ready: true },
    capabilities: { interactive: true, headless: true, permissions: true, usage: true }
  };
}

describe('outbound requests (ground rule 2)', () => {
  it('carry no line of any file in the repo, and no path on this machine', async () => {
    const root = await tempDir('roughbook-outbound-');
    const repo = path.join(root, 'client-app');
    const configDir = path.join(root, 'config');
    fs.mkdirSync(path.join(repo, 'src', 'app'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      '{\n  "name": "client-app-private",\n  "dependencies": { "next": "^16.3.8" }\n}\n'
    );
    fs.writeFileSync(
      path.join(repo, 'src', 'app', 'page.tsx'),
      "export default function Page() {\n  return <main className='client-secret-layout'>Client home</main>;\n}\n"
    );
    fs.writeFileSync(path.join(repo, '.gitignore'), '/node_modules\n');

    // The fake backend: it answers what each route answers, and remembers the selection.
    let next = 1;
    let selected: number | null = null;
    // The project's pictures question, unanswered until roughbook pictures on (decision 25).
    let pictures: boolean | null = null;
    const startRuns = (request: RecordedRequest) => {
      const body = request.body as { kind: string; directions?: unknown[]; parent?: string };
      const count = body.kind === 'generate' ? body.directions!.length : 1;
      const runs: StartedRun[] = Array.from({ length: count }, () => {
        const iteration = `iteration-${String(next++).padStart(2, '0')}`;
        return {
          runId: `eeeeeeee-eeee-4eee-8eee-${String(next).padStart(12, '0')}`,
          iteration,
          parent: body.parent ?? null,
          targetFolder: `rough/home/hero/${iteration}`,
          prompt: `<task>\nWrite ${iteration} of the hero.\n</task>\n`,
          checks: [{ kind: 'entry-file', file: 'index.tsx' }]
        };
      });
      return ok(runs, 201);
    };
    const routes: [string, RegExp, (request: RecordedRequest) => ReturnType<typeof ok>][] = [
      [
        'POST',
        /^\/auth\/device$/,
        () =>
          ok(
            {
              deviceCode: 'rbd_device',
              userCode: 'BCDF-GHJK',
              verificationUri: 'http://localhost:3000/link',
              verificationUriComplete: 'http://localhost:3000/link?code=BCDF-GHJK',
              expiresIn: 600,
              interval: 5
            },
            201
          )
      ],
      ['POST', /^\/auth\/token$/, () => ok({ token: TOKEN, installId: 'install-1' })],
      ['GET', /^\/me$/, () => ok({ user: { id: 'u1', email: 'dana@example.test', name: null } })],
      [
        'GET',
        /^\/projects$/,
        () =>
          ok([{ id: ORG, name: 'Acme', role: 'owner', projects: [{ slug: 'site', name: 'Site' }] }])
      ],
      [
        'POST',
        new RegExp(`^/orgs/${ORG}/links$`),
        () =>
          ok(
            {
              linkId: 'l1',
              org: { id: ORG, name: 'Acme' },
              project: { slug: 'site', name: 'Site' }
            },
            201
          )
      ],
      ['POST', /^\/heartbeat$/, () => ok({ seenAt: 'now' })],
      ['POST', new RegExp(`^${PROJECT}/runs$`), startRuns],
      ['POST', new RegExp(`^/orgs/${ORG}/runs/[0-9a-f-]+/finish$`), () => ok({ ok: true })],
      [
        'POST',
        /\/iterations\/iteration-(\d+)\/select$/,
        request => {
          selected = Number(/iteration-(\d+)/.exec(request.url)![1]);
          return ok([{ id: `iteration-0${selected}`, status: 'selected' }]);
        }
      ],
      ['POST', /\/iterations\/iteration-\d+\/(reject|reviews)$/, () => ok({ ok: true })],
      [
        'GET',
        new RegExp(`^${PROJECT}$`),
        () =>
          ok({
            slug: 'site',
            name: 'Site',
            delivery: { componentsDir: 'src/components', publicDir: 'public', devUrl: '' },
            pictures,
            pages: [
              {
                slug: 'home',
                name: 'Home',
                components: [
                  { slug: 'hero', name: 'Hero', selectedIteration: selected, iterations: [] }
                ]
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
              promotionId: PROMOTION,
              prompt: 'Write: {{roughbook:target-file}} near {{roughbook:target-dir}}/\n',
              placeholders: {
                targetFile: '{{roughbook:target-file}}',
                targetDir: '{{roughbook:target-dir}}',
                publicDir: '{{roughbook:public-dir}}'
              },
              copyMarkdown: '# Hero\n',
              componentName: 'Hero',
              defaults: { componentsDir: 'src/components', publicDir: 'public' },
              assets: [
                { scope: 'project', file: 'hero.png', publicUrl: '/rough/home/hero/hero.png' }
              ],
              missingAssets: []
            },
            201
          )
      ],
      [
        'GET',
        new RegExp(`^${PROJECT}/files/project/hero\\.png$`),
        () => ({ status: 200, text: 'PNG' })
      ],
      [
        'PUT',
        new RegExp(`^${PROJECT}/pictures$`),
        request => {
          pictures = (request.body as { on: boolean }).on;
          return ok({ pictures });
        }
      ],
      ['POST', /^\/auth\/logout$/, () => ok({ signedOut: true })],
      ['POST', /^\/events$/, () => ok({ accepted: 1, duplicates: 0 })],
      ['PUT', /^\/telemetry$/, () => ok({ analyticsConsent: true })]
    ];
    const backend = fakeFetch(request => {
      // Only the studio's API answers; anything else (the app's own dev server, which init and
      // done ask after) is an unreachable host, whatever runs on this machine. Every request is
      // recorded either way, so the check below still reads them all.
      if (!new URL(request.url).pathname.startsWith('/v1/api/studio/')) return 'offline';
      const route = new URL(request.url).pathname.replace('/v1/api/studio', '');
      const found = routes.find(
        ([method, pattern]) => method === request.method && pattern.test(route)
      );
      return found ? found[2](request) : refused('NOT_FOUND', 404);
    });

    // Yes to analytics at login, so the events go through the same check; then init's two.
    const io = recordingIo(['y', '', '']);
    const env = { ROUGHBOOK_CONFIG_DIR: configDir, ANTHROPIC_API_KEY: 'test-key' };
    const roughbook = async (argv: string[], expected = 0) => {
      const code = await main(argv, {
        cwd: repo,
        env,
        io,
        fetch: backend.fetch,
        platform: 'win32',
        sleep: async () => {},
        openUrl: async () => true,
        detect: async (adapter: AgentAdapter) =>
          adapter.id === 'claude-code' ? detection(true) : notFound(adapter),
        launchTerminal: async () => {},
        launchEditor: async () => {},
        copyText: async () => true,
        runHeadless: async (_adapter, invocation) => {
          // The unattended agent changes the refinement it was given.
          const folder = invocation.args.find(arg => arg.includes('rough/home/hero/iteration-'));
          const target = /rough\/home\/hero\/iteration-\d+/.exec(folder ?? '')![0];
          fs.writeFileSync(
            path.join(repo, ...target.split('/'), 'index.tsx'),
            ITERATION_SOURCE.replace('7f3a', '9c1d refined')
          );
          return { ok: true, exitCode: 0, cancelled: false, error: null, usage: null };
        },
        screenshot: async () => ({ files: {}, warning: null })
      });
      assert.equal(code, expected, `roughbook ${argv.join(' ')}: ${io.errors.join('\n')}`);
    };
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], {
        cwd: repo,
        stdio: 'ignore'
      });

    await roughbook(['login', '--no-browser']);
    await roughbook(['init', '--project', 'site', '--yes']);
    git('init', '--quiet');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'Prepared');
    await roughbook(['agents']);
    await roughbook(['pictures', 'on']);

    await roughbook(['run', 'home/hero', '--direction', 'Quiet editorial']);
    fs.writeFileSync(path.join(repo, 'rough/home/hero/iteration-01/index.tsx'), ITERATION_SOURCE);
    fs.writeFileSync(path.join(repo, 'src/app/stray.ts'), STRAY_EDIT);
    await roughbook(['done']);
    await roughbook(['revert', 'home/hero/iteration-01', 'src/app/stray.ts']);
    await roughbook(['review', 'home/hero/iteration-01', '--note', 'Headline wraps at 390 px']);
    await roughbook(['review', 'home/hero/iteration-01', '--reject', 'Too quiet', '--why', 'Flat']);
    await roughbook([
      'run',
      'home/hero',
      '--refine',
      'iteration-01',
      '--intent',
      'More contrast',
      '--headless'
    ]);
    await roughbook(['review', 'home/hero/iteration-02', '--select']);
    // A command the backend refuses: reported, with analytics on, as its code.
    await roughbook(['pull', 'home/hero'], 1);
    await roughbook(['promote', 'home/hero']);
    await roughbook(['status']);
    await roughbook(['logout']);

    // The session did what it should, so the requests below are the whole story.
    const sent = backend.requests.map(
      request => `${request.method} ${new URL(request.url).pathname.replace('/v1/api/studio', '')}`
    );
    for (const route of [
      '/runs',
      '/finish',
      '/reject',
      '/reviews',
      '/select',
      '/promotions',
      '/files/',
      '/events'
    ]) {
      assert.ok(
        sent.some(item => item.includes(route)),
        `no request to ${route}`
      );
    }
    // The pictures answer is one boolean, nothing else.
    const answers = backend.requests.filter(
      request => request.method === 'PUT' && request.url.endsWith(`${PROJECT}/pictures`)
    );
    assert.deepEqual(
      answers.map(request => request.body),
      [{ on: true }]
    );
    assert.ok(fs.existsSync(path.join(repo, 'public/rough/home/hero/hero.png')));
    assert.ok(!fs.existsSync(path.join(repo, 'src/app/stray.ts')));

    assertCarriesNoRepoContent(backend.requests, {
      repo,
      root,
      extraLines: [...ITERATION_SOURCE.split('\n'), STRAY_EDIT],
      minimumLines: 40
    });
  });
});

describe('outbound requests: a path typed into the words of a run', () => {
  /** A backend that stores the words and compiles them into the prompt, as `compileRun` does. */
  async function typed(words: Record<string, unknown>) {
    const { StudioApi } = await import('../api/client.js');
    const { startRuns: start } = await import('../runs/lifecycle.js');
    const root = await tempDir('roughbook-outbound-typed-');
    const repo = path.join(root, 'client-app');
    fs.mkdirSync(path.join(repo, 'rough', 'home', 'hero', 'iteration-01'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'rough', 'home', 'hero', 'iteration-01', 'index.tsx'),
      ITERATION_SOURCE
    );
    fs.writeFileSync(path.join(repo, 'stray.ts'), STRAY_EDIT);
    fs.writeFileSync(
      path.join(repo, 'package.json'),
      '{\n  "name": "client-app-private",\n  "dependencies": { "next": "^16.3.8" }\n}\n'
    );
    const backend = fakeFetch(request => {
      const { direction } = (request.body as { directions: { direction: string }[] })
        .directions[0]!;
      const runs: StartedRun[] = [
        {
          runId: 'eeeeeeee-eeee-4eee-8eee-000000000001',
          iteration: 'iteration-02',
          parent: null,
          targetFolder: 'rough/home/hero/iteration-02',
          prompt: `<task>\nDirection: ${direction}\n</task>\n`,
          checks: [{ kind: 'entry-file', file: 'index.tsx' }]
        }
      ];
      return ok(runs, 201);
    });
    const api = new StudioApi({
      server: 'https://api.example.test',
      token: TOKEN,
      userAgent: 'roughbook-studio/test',
      fetch: backend.fetch
    });
    const link = { orgId: ORG, project: 'site' } as Parameters<typeof start>[2];
    const base = { page: 'home', component: 'hero', agent: 'claude-code', mode: 'headless' };
    const [run] = await start(repo, api, link, { ...base, ...words } as never);
    const prompt = fs.readFileSync(path.join(repo, ...run!.promptFile.split('/')), 'utf8');
    return { backend, repo, root, prompt };
  }

  it('sends a stand-in, and the agent’s prompt still names the path', async () => {
    const typedPath = 'C:\\Users\\dana\\client-app\\src\\hero.tsx';
    const { backend, repo, root, prompt } = await typed({
      kind: 'generate',
      directions: [{ direction: `Match ${typedPath}`, hypothesis: 'Warm reads as trust' }]
    });
    const [request] = backend.requests;
    const sent = JSON.stringify(request!.body);
    assert.ok(!sent.includes('dana'), sent);
    assert.ok(!sent.includes('client-app'), sent);
    assert.ok(sent.includes('Match [local path 1]'), sent);
    // The prompt the agent reads came back from the server, and is what was typed.
    assert.ok(prompt.includes(`Direction: Match ${typedPath}\n`), prompt);
    assert.ok(!prompt.includes('[local path'), prompt);
    assertCarriesNoRepoContent(backend.requests, {
      repo,
      root,
      extraLines: [...ITERATION_SOURCE.split('\n'), STRAY_EDIT],
      minimumLines: 5
    });
  });

  it('sends a stand-in for a path in the instructions', async () => {
    const typedPath = 'C:\\Users\\dana\\client-app\\src\\hero.tsx';
    const { backend } = await typed({
      kind: 'generate',
      directions: [{ direction: 'Quiet' }],
      instructions: `Keep ${typedPath}`
    });
    const body = backend.requests[0]!.body as { instructions?: string };
    assert.equal(body.instructions, 'Keep [local path 1]');
  });

  it('sends the repo’s own path as a stand-in too', async () => {
    const root = await tempDir('roughbook-outbound-own-');
    const own = path.join(root, 'client-app', 'src', 'hero.tsx');
    const { backend, prompt } = await typed({
      kind: 'generate',
      directions: [{ direction: `Match ${own}` }]
    });
    const sent = JSON.stringify(backend.requests[0]!.body).toLowerCase();
    assert.ok(!sent.includes('hero.tsx'), sent);
    assert.ok(!sent.includes(path.basename(root).toLowerCase()), sent);
    assert.ok(prompt.includes(`Direction: Match ${own}\n`), prompt);
  });
});

describe('outbound requests: the understand call (I1 of the chat audit)', () => {
  it('sends only the typed words with paths as stand-ins, the mode and the slugs', async () => {
    const { StudioApi } = await import('../api/client.js');
    const { understandMessage } = await import('../server/understand.js');
    const root = await tempDir('roughbook-outbound-understand-');
    const repo = path.join(root, 'client-app');
    const file = path.join(repo, 'src-stray.ts');
    fs.mkdirSync(path.join(repo, 'rough', 'home', 'hero', 'iteration-01'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'rough', 'home', 'hero', 'iteration-01', 'index.tsx'),
      ITERATION_SOURCE
    );
    fs.writeFileSync(file, STRAY_EDIT);

    const backend = fakeFetch(() =>
      ok({
        read: true,
        intent: 'chat',
        target: null,
        targetName: null,
        directions: [],
        instructions: '',
        assumptions: [],
        confidence: 'high',
        question: null,
        reply: 'Hello.',
        requestId: 'r1',
        credits: 1,
        upToCredits: 0
      })
    );
    const api = new StudioApi({
      server: 'https://api.example.test',
      token: TOKEN,
      userAgent: 'roughbook-studio/test',
      fetch: backend.fetch
    });

    // A page that sent more than it should: the repo's path and its code.
    await understandMessage(
      { api, link: { orgId: ORG, project: 'site' } },
      {
        repoRoot: repo,
        source: ITERATION_SOURCE,
        stray: STRAY_EDIT,
        words: `like "${file}" please`,
        mode: 'new',
        page: 'home',
        component: 'hero'
      }
    );

    assert.deepEqual(
      backend.requests.map(request => request.body),
      [
        {
          words: 'like "[local path 1]" please',
          mode: 'new',
          page: 'home',
          component: 'hero'
        }
      ]
    );
    assert.equal(new URL(backend.requests[0]!.url).pathname, `/v1/api/studio${PROJECT}/understand`);
    assertCarriesNoRepoContent(backend.requests, {
      repo,
      root,
      extraLines: [...ITERATION_SOURCE.split('\n'), STRAY_EDIT],
      minimumLines: 5
    });
  });
});

describe('outbound requests: the readings call (A6 of the Apple plan)', () => {
  it('sends only the typed text, the readings kept and the one to replace', async () => {
    const { StudioApi } = await import('../api/client.js');
    const { planReadings } = await import('../server/readings.js');
    const root = await tempDir('roughbook-outbound-readings-');
    const repo = path.join(root, 'client-app');
    fs.mkdirSync(path.join(repo, 'rough', 'home', 'hero', 'iteration-01'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, 'rough', 'home', 'hero', 'iteration-01', 'index.tsx'),
      ITERATION_SOURCE
    );
    fs.writeFileSync(path.join(repo, 'src-stray.ts'), STRAY_EDIT);

    const reply = {
      readings: [
        { label: 'Hushed', hypothesis: 'Quiet type lets the offer lead.', plan: { a: 1 } },
        { label: 'Ledger', hypothesis: 'A ruled grid reads as trust.', plan: { b: 2 } },
        { label: 'Tide', hypothesis: 'Slow motion reads as calm.', plan: {} }
      ],
      question: null
    };
    const backend = fakeFetch(() => ok(reply));
    const api = new StudioApi({
      server: 'https://api.example.test',
      token: TOKEN,
      userAgent: 'roughbook-studio/test',
      fetch: backend.fetch
    });
    const source = { api, link: { orgId: ORG, project: 'site' } };

    // A page that sent more than it should: the repo's path, its code, the plans.
    const extra = {
      repoRoot: repo,
      source: ITERATION_SOURCE,
      file: path.join(repo, 'src-stray.ts'),
      stray: STRAY_EDIT
    };
    await planReadings(source, { ...extra, page: 'home', component: 'hero', text: 'calm' });
    await planReadings(source, {
      ...extra,
      page: 'home',
      component: 'hero',
      text: 'calm',
      replace: 2,
      keep: reply.readings.map(reading => ({ ...reading, ...extra }))
    });

    assert.deepEqual(
      backend.requests.map(request => request.body),
      [
        { text: 'calm' },
        {
          text: 'calm',
          replace: 2,
          keep: reply.readings.map(({ label, hypothesis }) => ({ label, hypothesis }))
        }
      ]
    );
    for (const request of backend.requests) {
      assert.equal(
        new URL(request.url).pathname,
        `/v1/api/studio${PROJECT}/pages/home/components/hero/readings`
      );
    }
    assertCarriesNoRepoContent(backend.requests, {
      repo,
      root,
      extraLines: [...ITERATION_SOURCE.split('\n'), STRAY_EDIT],
      minimumLines: 5
    });
  });
});

describe('outbound requests: the history (C6 of the composer audit)', () => {
  it('send no path, though the page shows the real one', async () => {
    const { StudioApi } = await import('../api/client.js');
    const { BadRequest } = await import('../server/studio.js');
    const { deleteRequest, readRequests } = await import('../server/requests.js');
    const { understandMessage } = await import('../server/understand.js');
    const root = await tempDir('roughbook-outbound-history-');
    const repo = path.join(root, 'client-app');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    const typed = path.join(repo, 'src', 'hero.tsx');
    fs.writeFileSync(typed, ITERATION_SOURCE);
    const line = '22222222-2222-4222-8222-222222222222';
    const standIn = '[local path 1]';
    let stored = '';

    const backend = fakeFetch(request => {
      if (request.method === 'DELETE') return ok({ deleted: true });
      if (request.method === 'GET') {
        return ok({
          requests: [{ id: line, words: stored, reply: `Read ${standIn}`, runIds: [] }],
          next: null
        });
      }
      stored = (request.body as { words: string }).words;
      return ok({
        read: true,
        intent: 'chat',
        target: null,
        targetName: null,
        directions: [],
        instructions: '',
        assumptions: [],
        confidence: 'high',
        question: null,
        reply: `Read ${standIn}`,
        rule: null,
        ruleScope: null,
        requestId: line,
        credits: 1,
        upToCredits: 0
      });
    });
    const api = new StudioApi({
      server: 'https://api.example.test',
      token: TOKEN,
      userAgent: 'roughbook-studio/test',
      fetch: backend.fetch
    });
    const source = { api, link: { orgId: ORG, project: 'site' }, repoRoot: repo };

    await understandMessage(source, { words: `like ${typed}`, mode: 'new' });
    assert.equal(stored, `like ${standIn}`);

    // The page has the real path; nothing it can send next takes it back out.
    const { requests } = await readRequests(source, null);
    assert.equal(requests[0]!.words, `like ${typed}`);
    assert.equal(requests[0]!.reply, `Read ${typed}`);
    await assert.rejects(readRequests(source, typed), BadRequest);
    await assert.rejects(deleteRequest(source, typed), BadRequest);
    await deleteRequest(source, line);

    assert.deepEqual(
      backend.requests.map(request => request.method),
      ['POST', 'GET', 'DELETE']
    );
    for (const request of backend.requests) {
      assert.equal(JSON.stringify(request).includes('client-app'), false, request.url);
    }
    assertCarriesNoRepoContent(backend.requests, { repo, root, minimumLines: 5 });
  });
});
