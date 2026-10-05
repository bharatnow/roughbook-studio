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
import type { Detection, TerminalAdapter } from '../agents/types.js';
import { main } from '../commands/index.js';
import type { StartedRun } from '../runs/types.js';
import {
  assertCarriesNoRepoContent,
  fakeFetch,
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
      ['POST', /^\/auth\/logout$/, () => ok({ signedOut: true })]
    ];
    const backend = fakeFetch(request => {
      const route = new URL(request.url).pathname.replace('/v1/api/studio', '');
      const found = routes.find(
        ([method, pattern]) => method === request.method && pattern.test(route)
      );
      return found ? found[2](request) : refused('NOT_FOUND', 404);
    });

    const io = recordingIo(['', '']);
    const env = { ROUGHBOOK_CONFIG_DIR: configDir, ANTHROPIC_API_KEY: 'test-key' };
    const roughbook = async (argv: string[]) => {
      const code = await main(argv, {
        cwd: repo,
        env,
        io,
        fetch: backend.fetch,
        platform: 'win32',
        sleep: async () => {},
        openUrl: async () => true,
        detect: async (_adapter: TerminalAdapter) => detection(true),
        launchTerminal: async () => {},
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
      assert.equal(code, 0, `roughbook ${argv.join(' ')}: ${io.errors.join('\n')}`);
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
      '/files/'
    ]) {
      assert.ok(
        sent.some(item => item.includes(route)),
        `no request to ${route}`
      );
    }
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
