import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { exitCodeFor, redactedReport, renderReport, runDoctor } from '../doctor/run.js';
import type { DoctorReport, DoctorTools, Probe } from '../doctor/types.js';
import { findSentinel } from '../doctor/sentinel.js';
import { readEnvironmentSync } from '../environment/read.js';
import { parseCommandLine, resolveCommandLine } from '../launch/processes.js';
import { next } from '../recipes/next/index.js';
import { approveCommands, environmentCommands } from '../repo/approvals.js';
import { applyPrep, planPrep } from '../repo/prep.js';
import { pageSetup } from '../screenshot/browser.js';
import { tempDir } from './helpers.js';

const LINK = {
  version: 1 as const,
  orgId: 'org-1',
  project: 'site',
  roughCommitted: true,
  appDir: 'src/app'
};
const DEV = 'http://localhost:3000';

/**
 * A repo prepared as init prepares a Next.js one (the route files in place, so the setup-files
 * check has them to compare), with its environment's commands approved on this machine, unless a
 * test says otherwise.
 */
async function tempRepo(
  files: Record<string, string> = {},
  options: { approve?: boolean } = {}
): Promise<string> {
  const repo = await tempDir('roughbook-doctor-');
  fs.mkdirSync(path.join(repo, 'src', 'app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"app"}\n');
  applyPrep(planPrep(repo, { link: LINK, recipe: next }));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  if (options.approve !== false) {
    try {
      await approveCommands(repo, environmentCommands(readEnvironmentSync(repo, LINK)));
    } catch {
      // An environment made to fail its own check has nothing to approve.
    }
  }
  return repo;
}

/** Doctor's own page under rough/, while it runs; null once it has cleaned up. */
function doctorPage(repo: string): string | null {
  const rough = path.join(repo, 'rough');
  if (!fs.existsSync(rough)) return null;
  return fs.readdirSync(rough).find(entry => entry.startsWith('doctor-check')) ?? null;
}

/** The sample iterations as doctor writes them, read back from the repo while a check runs. */
function sample(repo: string, which: 'iteration-01' | 'iteration-02' | 'iteration-03'): string {
  const page = doctorPage(repo);
  const dir = page ? path.join(repo, 'rough', page, 'sample', which) : '';
  return page && fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .map(file => fs.readFileSync(path.join(dir, file), 'utf8'))
        .join('\n')
    : '';
}

/**
 * A dev server that behaves: the good iteration renders its marker and fixture, the broken one
 * answers 500, a missing key 404, and a request from the network is refused. Each piece can be
 * broken by the test.
 */
function fakeTools(
  repo: string,
  faults: Partial<{
    down: boolean;
    neverReady: boolean;
    hidden: boolean;
    brokenRenders: boolean;
    missingRenders: boolean;
    noShot: boolean;
    stale: boolean;
    leaks: boolean;
    exposed: boolean;
    overlay: boolean;
    noFixture: boolean;
    missingTool: string;
    /**
     * The app in production mode: 404 for the preview (ok), the sample shown (leaks), a page of
     * its own without the sample (elsewhere, as a store or a CMS answers an address it does not
     * know), or nothing at all (down).
     */
    production: 'ok' | 'leaks' | 'elsewhere' | 'down';
    /** Every look at the clock is ten seconds later, so every budget is over. */
    slow: boolean;
    /** Nothing answers until the start command was served, as before roughbook start. */
    downUntilServed: boolean;
  }> = {}
): DoctorTools & { built: string[]; served: string[]; stopped: string[]; shots: string[] } {
  const built: string[] = [];
  const served: string[] = [];
  const stopped: string[] = [];
  const shots: string[] = [];
  let clock = 0;
  let appServed = false;
  const pageFor = (url: URL): { status: number; body: string } => {
    // Doctor's page is named anew each run: /rough-preview/doctor-check-<id>/sample/<iteration>.
    const key = url.pathname.replace(/^\/rough-preview\/doctor-check(-[a-z0-9]+)?\//, '');
    const isLan = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
    if (isLan && !faults.exposed) return { status: 404, body: 'not for the network' };
    // Doctor's third sample, for the speed check, renders like the first.
    if (key === 'sample/iteration-01' || key === 'sample/iteration-03') {
      const files = sample(repo, key === 'sample/iteration-01' ? 'iteration-01' : 'iteration-03');
      // A stale server keeps showing the first marker, never the change to it.
      const marker = faults.stale
        ? (/roughbook-doctor-[a-z0-9]+/.exec(files)?.[0] ?? '')
        : (/roughbook-doctor-[a-z0-9-]+/.exec(files)?.[0] ?? '');
      const fixture = faults.noFixture ? '' : (/"note": "([^"]+)"/.exec(files)?.[1] ?? '');
      return { status: 200, body: `<main>${marker} ${fixture}</main>` };
    }
    if (key === 'sample/iteration-02') {
      return faults.brokenRenders
        ? { status: 200, body: '<main>fine</main>' }
        : { status: 500, body: 'boom' };
    }
    return faults.missingRenders
      ? { status: 200, body: '<main>?</main>' }
      : { status: 404, body: 'none' };
  };
  return {
    built,
    served,
    stopped,
    shots,
    browser: '/fake/chrome',
    which: program => (faults.missingTool === program ? null : `/fake/bin/${program}`),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input : input.url
      );
      if (faults.down && url.port === '3000') throw new Error('ECONNREFUSED');
      if (faults.downUntilServed && !appServed && url.port === '3000') {
        throw new Error('ECONNREFUSED');
      }
      if (url.port === '3999') {
        // The app in production mode, for the runtime gate.
        if (faults.production === 'down') throw new Error('ECONNREFUSED');
        if (url.pathname.startsWith('/rough-preview/')) {
          if (faults.production === 'leaks') {
            const page = pageFor(new URL(url.pathname, 'http://localhost:3000'));
            return new Response(page.body, { status: page.status });
          }
          if (faults.production === 'elsewhere') return new Response('home', { status: 200 });
          return new Response('x', { status: 404 });
        }
        return new Response('home', { status: 200 });
      }
      void init;
      const page = pageFor(url);
      return new Response(page.body, { status: page.status });
    }) as typeof fetch,
    async probe({ url, overlays }) {
      // The app in production mode shows its own page, unless the preview leaks there.
      const page =
        new URL(url).port === '3999' && faults.production !== 'leaks'
          ? { status: 200, body: 'home' }
          : pageFor(new URL(url));
      const good = url.endsWith('/sample/iteration-01') || url.endsWith('/sample/iteration-03');
      const probe: Probe = {
        // A hiding layout shows its own view: the iteration is in the page's data, not on screen.
        shows: good ? !faults.hidden && page.status === 200 : true,
        ready: good && !faults.neverReady && !faults.hidden && page.status === 200,
        error: page.status >= 400 ? `HTTP ${page.status}` : null,
        visibleOverlays: faults.overlay && overlays.length ? 1 : 0,
        exceptions: [],
        text: faults.hidden ? 'Not found' : page.body.replace(/<[^>]+>/g, ' ')
      };
      return probe;
    },
    async screenshot({ file }) {
      if (faults.noShot) return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'png');
      shots.push(file);
      return true;
    },
    async exec(command, cwd) {
      built.push(command);
      // A build that writes the iteration's marker into its output has leaked rough/.
      const out = path.join(cwd, '.next', 'server', 'chunk.js');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const marker =
        /roughbook-doctor-[a-z0-9-]+/.exec(sample(repo, 'iteration-01'))?.[0] ?? 'none';
      fs.writeFileSync(out, faults.leaks ? `console.log("${marker}")` : 'console.log("app")');
      return { code: 0 };
    },
    async serve(command, _cwd, url) {
      served.push(`${command} @ ${url}`);
      if (url.includes(':3000')) appServed = true;
      return faults.production === 'down'
        ? null
        : {
            stop: async () => {
              stopped.push(command);
            }
          };
    },
    // A live repo has no snapshot command for doctor to run.
    snapshot: async () => ({ code: 1, output: '' }),
    addresses: () => ['192.168.1.20'],
    // No real waiting: each look at the clock is a second later.
    sleep: async () => {},
    now: () => (clock += faults.slow ? 10_000 : 1000)
  };
}

function statuses(report: DoctorReport): Record<string, string> {
  return Object.fromEntries(report.checks.map(check => [check.id, check.status]));
}

function failing(report: DoctorReport): string[] {
  return report.checks.filter(check => check.status === 'fail').map(check => check.id);
}

describe('the state messages', () => {
  it('notes ready and error from the preview, in the page setup script', () => {
    const handlers: ((event: unknown) => void)[] = [];
    const window: Record<string, unknown> = {};
    const context = vm.createContext({
      window,
      addEventListener: (name: string, handler: (event: unknown) => void) => {
        if (name === 'message') handlers.push(handler);
      },
      document: { createElement: () => ({}), head: { appendChild() {} } }
    });
    vm.runInContext(pageSetup(['nextjs-portal']), context);
    for (const handler of handlers)
      handler({ data: { roughbook: 'ready', id: 'a/b/iteration-01' } });
    assert.equal(window.__roughbookReady, true);
    for (const handler of handlers) {
      handler({ data: { roughbook: 'error', id: 'a/b/iteration-02', message: 'It threw.' } });
    }
    assert.equal(window.__roughbookError, 'It threw.');
    // Other messages, and other shapes, are nobody's business.
    for (const handler of handlers) handler({ data: 'hello' });
    for (const handler of handlers) handler({ data: { roughbook: 'error' } });
    assert.equal(window.__roughbookError, 'error');
  });
});

describe('roughbook doctor', () => {
  it('passes a repo whose preview keeps the contract, and leaves the repo as it was', async () => {
    const repo = await tempRepo();
    const tools = fakeTools(repo);
    const report = await runDoctor(repo, { devUrl: DEV, tools });
    assert.deepEqual(failing(report), [], JSON.stringify(report.checks, null, 2));
    assert.equal(report.outcome, 'pass');
    assert.equal(exitCodeFor(report.outcome), 0);
    assert.deepEqual(statuses(report), {
      prerequisites: 'pass',
      environment: 'pass',
      app: 'pass',
      renders: 'pass',
      fixture: 'pass',
      'reports-broken': 'pass',
      'reports-missing': 'pass',
      screenshots: 'pass',
      fresh: 'pass',
      gate: 'pass',
      loopback: 'pass',
      'setup-files': 'pass',
      speed: 'skip'
    });
    assert.deepEqual(tools.built, ['npm run build']);
    assert.deepEqual(tools.served, []);
    assert.equal(tools.shots.length, next.environment(LINK).viewports.length);
    // The sample iterations are gone, the screenshots were never in rough/, the build output is.
    assert.equal(doctorPage(repo), null);
    assert.ok(tools.shots.every(file => !file.startsWith(path.join(repo, 'rough'))));
    assert.deepEqual(report.environment, {
      contract: 1,
      recipe: 'next',
      stack: [],
      family: 'react-like',
      mode: 'live',
      gate: 'build'
    });
  });

  it('names the check that failed and what to fix, for each way a setup can fail', async () => {
    const cases: [Partial<Parameters<typeof fakeTools>[1]>, string, RegExp][] = [
      [{ down: true }, 'app', /start the app|dev server/i],
      [{ neverReady: true }, 'renders', /ready/],
      [{ hidden: true }, 'renders', /shows something else.*decides what to show by path/s],
      [{ noFixture: true }, 'fixture', /preview\.json/],
      [{ brokenRenders: true }, 'reports-broken', /broken|500|error/i],
      [{ missingRenders: true }, 'reports-missing', /missing|404/i],
      [{ noShot: true }, 'screenshots', /screenshot/i],
      [{ overlay: true }, 'screenshots', /overlay/i],
      [{ stale: true }, 'fresh', /change|reload/i],
      [{ leaks: true }, 'gate', /production build|rough\//i],
      [{ exposed: true }, 'loopback', /192\.168\.1\.20|network|loopback/i]
    ];
    for (const [faults, id, fix] of cases) {
      const repo = await tempRepo();
      const report = await runDoctor(repo, { devUrl: DEV, tools: fakeTools(repo, faults) });
      assert.deepEqual(failing(report), [id], `${id}: ${JSON.stringify(report.checks)}`);
      const check = report.checks.find(item => item.id === id)!;
      assert.match(`${check.detail} ${check.fix}`, fix, id);
      assert.equal(report.outcome, 'fail');
      assert.equal(exitCodeFor(report.outcome), 1);
      assert.equal(doctorPage(repo), null, `${id} cleaned up`);
    }
  });

  it('names a layout that hides the route as the one failure, and skips what depends on it', async () => {
    const repo = await tempRepo();
    const report = await runDoctor(repo, { devUrl: DEV, tools: fakeTools(repo, { hidden: true }) });
    assert.deepEqual(failing(report), ['renders']);
    const renders = report.checks.find(check => check.id === 'renders')!;
    assert.match(renders.detail, /sent the iteration.*shows something else/);
    assert.match(
      renders.fix ?? '',
      /\/rough-preview\/doctor-check-[a-z0-9]+\/sample\/iteration-01/
    );
    const status = statuses(report);
    assert.equal(status['reports-broken'], 'skip');
    assert.equal(status['reports-missing'], 'skip');
    assert.equal(status.screenshots, 'skip');
    assert.equal(status.fixture, 'pass');
    assert.equal(status.fresh, 'pass');
    assert.match(
      report.checks.find(check => check.id === 'reports-broken')!.detail,
      /did not show the sample iteration/
    );
  });

  it('names its page anew each run, so a watcher that lost the last folder is not blamed', async () => {
    const repo = await tempRepo();
    const seen: string[] = [];
    for (let run = 0; run < 2; run++) {
      const tools = fakeTools(repo);
      const fetching = tools.fetch;
      tools.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        const text =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const page = /doctor-check-[a-z0-9]+/.exec(text)?.[0];
        if (page && !seen.includes(page)) seen.push(page);
        return fetching(input, init);
      }) as typeof fetch;
      const report = await runDoctor(repo, { devUrl: DEV, skipBuild: true, tools });
      assert.deepEqual(failing(report), []);
    }
    assert.equal(seen.length, 2, seen.join(', '));
  });

  it('proves the runtime gate for a served stack, and skips the build when told', async () => {
    const header = `---
gate: runtime
production: node server.js @ http://127.0.0.1:3999
---
`;
    for (const [production, expected] of [
      ['ok', 'pass'],
      ['leaks', 'fail'],
      ['elsewhere', 'pass'],
      ['down', 'fail']
    ] as const) {
      const repo = await tempRepo({ 'rough/environment.md': header });
      const tools = fakeTools(repo, { production });
      const report = await runDoctor(repo, { devUrl: DEV, tools });
      assert.equal(statuses(report).gate, expected, production);
      assert.deepEqual(tools.built, [], production);
      assert.deepEqual(tools.served, ['node server.js @ http://127.0.0.1:3999'], production);
      if (expected === 'fail') {
        assert.match(report.checks.find(check => check.id === 'gate')!.fix ?? '', /production/);
      }
    }

    const repo = await tempRepo();
    const tools = fakeTools(repo);
    const report = await runDoctor(repo, { devUrl: DEV, skipBuild: true, tools });
    assert.equal(statuses(report).gate, 'skip');
    assert.equal(report.outcome, 'unverified');
    assert.equal(exitCodeFor(report.outcome), 2);
    assert.deepEqual(tools.built, []);
  });

  it('asks a production address that is already running, such as a store’s live theme, starting nothing', async () => {
    const header = `---
gate: runtime
production: http://127.0.0.1:3999
---
`;
    for (const [production, expected] of [
      ['elsewhere', 'pass'],
      ['leaks', 'fail']
    ] as const) {
      const repo = await tempRepo({ 'rough/environment.md': header });
      const tools = fakeTools(repo, { production });
      const report = await runDoctor(repo, { devUrl: DEV, tools });
      assert.equal(statuses(report).gate, expected, production);
      assert.deepEqual(tools.served, [], production);
      if (expected === 'fail') {
        assert.match(report.checks.find(check => check.id === 'gate')!.detail, /showed the sample/);
      }
    }
  });

  it('fails the environment check, and nothing after it, when the header cannot be read', async () => {
    const repo = await tempRepo({ 'rough/environment.md': '---\nfamily: cobol\n---\n' });
    const report = await runDoctor(repo, { devUrl: DEV, tools: fakeTools(repo) });
    assert.deepEqual(failing(report), ['environment']);
    assert.equal(report.checks[0]!.id, 'prerequisites');
    assert.equal(report.checks[0]!.status, 'skip');
    assert.match(report.checks[1]!.detail, /environment\.md: family/);
    assert.ok(report.checks.slice(2).every(check => check.status === 'skip'));
  });

  it('runs nothing until the commands are approved on this machine, and approves them with --yes', async () => {
    const repo = await tempRepo({}, { approve: false });
    const tools = fakeTools(repo);
    const report = await runDoctor(repo, { devUrl: DEV, tools });
    assert.deepEqual(failing(report), ['environment']);
    const environment = report.checks.find(check => check.id === 'environment')!;
    assert.match(environment.detail, /not approved.*npm run build/);
    assert.match(environment.fix ?? '', /--yes/);
    assert.deepEqual(tools.built, []);
    assert.ok(report.checks.slice(2).every(check => check.status === 'skip'));

    // A CI checkout's owner approves them without a terminal; the approval is kept for next time.
    const approved = await runDoctor(repo, { devUrl: DEV, tools, approve: true });
    assert.deepEqual(failing(approved), []);
    assert.deepEqual(tools.built, ['npm run build']);
    const again = await runDoctor(repo, { devUrl: DEV, tools: fakeTools(repo) });
    assert.deepEqual(failing(again), []);
  });

  it('names a tool the commands need that is not on the PATH, with how to install it', async () => {
    const repo = await tempRepo();
    const report = await runDoctor(repo, {
      devUrl: DEV,
      tools: fakeTools(repo, { missingTool: 'npm' })
    });
    assert.deepEqual(failing(report), ['prerequisites']);
    const check = report.checks[0]!;
    assert.match(check.detail, /npm/);
    assert.match(check.fix ?? '', /nodejs\.org/);
    // The rest still runs: a missing tool is one finding, not a stop.
    assert.equal(statuses(report).renders, 'pass');
  });

  it('looks for a program named by its path in the repo, not on the PATH, as a Gradle wrapper is', async () => {
    const header = '---\nbuild: ./bin/build\nbuildOutput:\n  - .next/server\n---\n';
    // Not on the PATH, whatever the PATH holds: a path is the repo's.
    const tools = (repo: string) => fakeTools(repo, { missingTool: './bin/build' });
    const present = await tempRepo({ 'rough/environment.md': header, 'bin/build': '#!/bin/sh\n' });
    assert.equal(
      statuses(await runDoctor(present, { devUrl: DEV, tools: tools(present) })).prerequisites,
      'pass'
    );
    const absent = await tempRepo({ 'rough/environment.md': header });
    const report = await runDoctor(absent, { devUrl: DEV, tools: tools(absent) });
    assert.equal(statuses(report).prerequisites, 'fail');
    assert.match(report.checks[0]!.detail, /\.\/bin\/build is not in the repo/);
  });

  it('checks the setup files: a recipe file the recipe would write differently fails it', async () => {
    const repo = await tempRepo();
    const route = path.join(repo, 'src', 'app', 'rough-preview', '[...slug]', 'ready.tsx');
    fs.writeFileSync(route, fs.readFileSync(route, 'utf8').replace('"ready"', '"done"'));
    const report = await runDoctor(repo, { devUrl: DEV, tools: fakeTools(repo) });
    assert.deepEqual(failing(report), ['setup-files']);
    const check = report.checks.find(item => item.id === 'setup-files')!;
    assert.match(check.detail, /ready\.tsx/);
    assert.match(check.fix ?? '', /setup --upgrade/);
  });

  it('skips the loopback check on a machine with no network address', async () => {
    const repo = await tempRepo();
    const tools = fakeTools(repo);
    tools.addresses = () => [];
    const report = await runDoctor(repo, { devUrl: DEV, tools });
    assert.equal(statuses(report).loopback, 'skip');
    assert.equal(report.outcome, 'pass');
  });

  it('renders lines for the terminal, and a redacted report with no path in it', async () => {
    const repo = await tempRepo();
    const report = await runDoctor(repo, { devUrl: DEV, tools: fakeTools(repo, { stale: true }) });
    const lines = renderReport(report);
    assert.ok(
      lines.some(line => /^\s*(ok|OK|✓|pass)\b.*environment/i.test(line)),
      lines.join('\n')
    );
    assert.ok(
      lines.some(line => /fresh/.test(line) && /fail|x\b|✗/i.test(line)),
      lines.join('\n')
    );
    assert.ok(lines.some(line => /fix:/i.test(line)));
    const redacted = redactedReport(report, { node: 'v22.0.0', os: 'win32' });
    const text = JSON.stringify(redacted);
    assert.ok(!text.includes(repo.replace(/\\/g, '\\\\')) && !text.includes(repo));
    assert.ok(!text.includes('C:\\') && !text.includes('/Users/'));
    assert.equal((redacted as { outcome: string }).outcome, 'fail');
  });
});

describe('the sentinel', () => {
  it('is found anywhere under the build output, and nowhere when the build kept rough/ out', async () => {
    const dir = await tempDir('roughbook-sentinel-');
    fs.mkdirSync(path.join(dir, '.next', 'static', 'chunks'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.next', 'static', 'chunks', 'a.js'),
      'x roughbook-doctor-abc y'
    );
    fs.writeFileSync(path.join(dir, '.next', 'b.js'), 'clean');
    assert.deepEqual(findSentinel(dir, ['.next', 'out'], 'roughbook-doctor-abc'), [
      '.next/static/chunks/a.js'
    ]);
    assert.deepEqual(findSentinel(dir, ['.next', 'out'], 'roughbook-doctor-zzz'), []);
    assert.deepEqual(findSentinel(dir, ['missing'], 'roughbook-doctor-abc'), []);
  });
});

describe("the repo's command lines", () => {
  it('splits a line into arguments, quotes kept whole', () => {
    assert.deepEqual(parseCommandLine('npm run build'), ['npm', 'run', 'build']);
    assert.deepEqual(parseCommandLine('  php  artisan serve --host "127.0.0.1"  '), [
      'php',
      'artisan',
      'serve',
      '--host',
      '127.0.0.1'
    ]);
    assert.deepEqual(parseCommandLine('node -e \'console.log(1)\' ""'), [
      'node',
      '-e',
      'console.log(1)',
      ''
    ]);
    assert.deepEqual(parseCommandLine(''), []);
  });

  it('runs npm and npx through the studio\u2019s Node.js and their own scripts, never a shell', () => {
    const winNode = path.join('C:', 'nodejs', 'node.exe');
    const winScript = path.join('C:', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    assert.deepEqual(
      resolveCommandLine('npm run build', winNode, 'win32', file => file === winScript),
      { command: winNode, args: [winScript, 'run', 'build'] }
    );
    const nix = (file: string) =>
      file === path.join('/usr/local/bin', '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');
    assert.deepEqual(resolveCommandLine('npx next build', '/usr/local/bin/node', 'linux', nix), {
      command: '/usr/local/bin/node',
      args: [
        path.join('/usr/local/bin', '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
        'next',
        'build'
      ]
    });
    // Without npm beside Node.js, or for any other program, the PATH finds it by name.
    assert.deepEqual(
      resolveCommandLine('npm run build', '/opt/node', 'linux', () => false),
      {
        command: 'npm',
        args: ['run', 'build']
      }
    );
    assert.deepEqual(
      resolveCommandLine('php artisan serve', '/opt/node', 'linux', () => false),
      {
        command: 'php',
        args: ['artisan', 'serve']
      }
    );
    assert.equal(resolveCommandLine('   '), null);
  });
});

describe('doctor --speed', () => {
  it('measures the budgets on the sample iteration and says each in a sentence, and skips them without --speed', async () => {
    const repo = await tempRepo();
    const tools = fakeTools(repo);
    const report = await runDoctor(repo, { devUrl: DEV, tools, speed: true });
    assert.deepEqual(failing(report), [], JSON.stringify(report.checks, null, 2));
    const speed = report.checks.find(check => check.id === 'speed')!;
    assert.equal(speed.status, 'pass', speed.detail);
    assert.match(speed.detail, /preview visible in \d+(\.\d+)? s \(budget \d+ s\)/i);
    assert.match(speed.detail, /screenshots .* in \d+(\.\d+)? s/);
    assert.match(speed.detail, /taken again: none/);
    assert.match(speed.detail, /cold start not measured/);
    // The speed samples are taken away with the rest, screenshots included.
    assert.equal(doctorPage(repo), null);
    const shotsDir = path.join(repo, 'rough', '.screenshots');
    assert.ok(
      !fs.existsSync(shotsDir) ||
        fs.readdirSync(shotsDir).every(name => !name.startsWith('doctor-check')),
      'no doctor screenshots stay in the repo'
    );
    const without = await runDoctor(repo, { devUrl: DEV, tools: fakeTools(repo) });
    const skipped = without.checks.find(check => check.id === 'speed')!;
    assert.equal(skipped.status, 'skip');
    assert.match(skipped.detail, /--speed/);
  });

  it('fails when a budget is over, naming the budget and the number', async () => {
    const repo = await tempRepo();
    const tools = fakeTools(repo, { slow: true });
    const report = await runDoctor(repo, { devUrl: DEV, tools, speed: true });
    const speed = report.checks.find(check => check.id === 'speed')!;
    assert.equal(speed.status, 'fail');
    assert.match(speed.detail, /preview visible in \d+(\.\d+)? s \(budget \d+ s\)/i);
    assert.match(speed.fix ?? '', /over budget/i);
    assert.equal(report.outcome, 'fail');
  });

  it('starts the app itself when asked, measures the cold start, and stops it after', async () => {
    const repo = await tempRepo();
    const tools = fakeTools(repo, { downUntilServed: true });
    const report = await runDoctor(repo, { devUrl: DEV, tools, speed: true, startApp: true });
    assert.deepEqual(failing(report), [], JSON.stringify(report.checks, null, 2));
    assert.ok(
      tools.served.some(item => item.startsWith('npm run dev @ http://localhost:3000')),
      tools.served.join(', ')
    );
    assert.deepEqual(tools.stopped, ['npm run dev']);
    const app = report.checks.find(check => check.id === 'app')!;
    assert.match(app.detail, /started/i);
    const speed = report.checks.find(check => check.id === 'speed')!;
    assert.match(speed.detail, /cold start in \d+(\.\d+)? s \(budget \d+ s\)/);
    // Without the start, nothing answered and doctor says to start the app.
    const notStarted = await runDoctor(repo, {
      devUrl: DEV,
      tools: fakeTools(repo, { downUntilServed: true })
    });
    assert.deepEqual(failing(notStarted), ['app']);
  });
});
