import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Detection } from '../agents/types.js';
import { main, type MainOptions } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import { SAMPLE_FIXTURE, SAMPLE_MARKER } from '../doctor/run.js';
import type { DoctorReport, DoctorTools, Probe } from '../doctor/types.js';
import { readEnvironmentSync } from '../environment/read.js';
import { writeMap } from '../map/file.js';
import { recipeFor } from '../recipes/index.js';
import { applyPrep, planPrep } from '../repo/prep.js';
import { programOf, resolveCommandLine, shellInvocation } from '../launch/processes.js';
import type { TerminalPlan } from '../launch/terminal.js';
import {
  approveCommands,
  commandHash,
  environmentCommands,
  isApproved,
  readApprovals,
  unapprovedCommands
} from '../repo/approvals.js';
import type { RepoLink } from '../repo/link.js';
import {
  applySetup,
  checkSetupFiles,
  orphanTemplates,
  planSetup,
  removeSetup,
  withSnippet,
  withoutSnippet
} from '../repo/setup.js';
import { queued } from '../runs/queue.js';
import { fillSetupPrompt, fixSection, listSetups, setupFinishingSection } from '../runs/setup.js';
import { readSnapshot } from '../runs/snapshot.js';
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
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: null,
  stack: ['laravel-13', 'blade', 'php-8'],
  family: 'markup-css'
};

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');
const exists = (repo: string, file: string) => fs.existsSync(path.join(repo, ...file.split('/')));

/** The environment a setup run writes for a PHP app: no recipe, a route file and a snippet. */
const ENVIRONMENT = `---
contract: 1
recipe: none
stack:
  - laravel-13
  - blade
  - php-8
family: markup-css
mode: live
entry: index.blade.php
sources:
  - .blade.php
  - .css
shell: none
start: php artisan serve @ http://127.0.0.1:8000
preview: /rough-preview/{key}
gate: runtime
production: php artisan serve --env=production @ http://127.0.0.1:3999
ignore:
  - vendor
  - node_modules
  - .git
promote: resources/views/components
terms:
  - page: view
  - component: partial
setupFiles:
  - routes/rough-preview.php
  - routes/web.php (snippet)
---

# This repo

Blade views under resources/views; the preview route renders rough/<key>/index.blade.php.
`;
const ROUTE_TEMPLATE =
  "<?php\n// Roughbook preview route (development only)\nRoute::get('/rough-preview/{key}', fn () => view('rough::' . $key))->where('key', '.*');\n";
const SNIPPET =
  "if (app()->environment('local')) {\n    require __DIR__.'/rough-preview.php';\n}\n";
const WEB_ROUTES =
  "<?php\n\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::get('/', fn () => view('welcome'));\n";

/** A PHP app with a setup run's work in rough/: the environment, the templates and the samples. */
async function setupRepo(options: { applied?: boolean; git?: boolean } = {}): Promise<string> {
  const repo = path.join(await tempDir('roughbook-setup-'), 'app');
  write(
    repo,
    'composer.json',
    JSON.stringify({ require: { php: '^8.2', 'laravel/framework': '^13.0' } })
  );
  write(repo, 'artisan', '#!/usr/bin/env php');
  write(repo, 'routes/web.php', WEB_ROUTES);
  write(repo, 'resources/views/welcome.blade.php', '<h1>Welcome</h1>');
  write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
  write(repo, 'rough/environment.md', ENVIRONMENT);
  write(repo, 'rough/setup/routes/rough-preview.php', ROUTE_TEMPLATE);
  write(repo, 'rough/setup/routes/web.php.snippet', SNIPPET);
  write(
    repo,
    'rough/setup/sample/good/index.blade.php',
    `<main data-roughbook="doctor"><p>${SAMPLE_MARKER}</p><p>{{ $note }}</p></main>\n`
  );
  write(repo, 'rough/setup/sample/good/preview.json', `{ "note": "${SAMPLE_FIXTURE}" }\n`);
  write(
    repo,
    'rough/setup/sample/broken/index.blade.php',
    '@php throw new Exception("roughbook doctor: fails on purpose"); @endphp\n'
  );
  write(repo, '.gitignore', '/vendor\n/rough/.roughbook/\n/rough/.screenshots/\n');
  // Committed, as a PHP app's storage/ placeholders are, and ignored by the environment later.
  write(repo, 'storage/logs/.gitignore', '*\n!.gitignore\n');
  if (options.applied) {
    write(repo, 'routes/rough-preview.php', ROUTE_TEMPLATE);
    write(repo, 'routes/web.php', `${WEB_ROUTES}${SNIPPET}`);
  }
  if (options.git !== false) {
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], {
        cwd: repo,
        stdio: 'ignore'
      });
    git('init', '--quiet');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'start');
  }
  return repo;
}

type Route = (request: RecordedRequest) => ReturnType<typeof ok> | 'offline';

const SETUP_PROMPT = {
  prompt: `<task>\nSet this repo up for Roughbook previews.\n</task>\n\n<contract>\n{{roughbook:contract}}\n</contract>\n\n<repo>\n{{roughbook:guess}}\n{{roughbook:rule-files}}\n</repo>\n\n<recipe>\n{{roughbook:recipe-notes}}\n</recipe>\n`,
  placeholders: {
    contract: '{{roughbook:contract}}',
    guess: '{{roughbook:guess}}',
    recipeNotes: '{{roughbook:recipe-notes}}',
    ruleFiles: '{{roughbook:rule-files}}'
  }
};

/**
 * A dev server that keeps the contract for the PHP app above: the good sample shows its marker
 * and fixture, the broken one answers 500, a missing key 404, the network gets 404, and in
 * production mode the preview answers 404. The repo's commands are recorded, never run.
 */
function fakeDoctorTools(
  repo: string,
  faults: Partial<{ stale: boolean; down: boolean }> = {}
): Partial<DoctorTools> & { built: string[]; served: string[] } {
  const built: string[] = [];
  const served: string[] = [];
  let clock = 0;
  const sample = (which: string): string => {
    const rough = path.join(repo, 'rough');
    const page = fs.readdirSync(rough).find(entry => entry.startsWith('doctor-check'));
    const dir = page ? path.join(rough, page, 'sample', which) : '';
    return page && fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .map(file => fs.readFileSync(path.join(dir, file), 'utf8'))
          .join('\n')
      : '';
  };
  const pageFor = (url: URL): { status: number; body: string } => {
    const key = url.pathname.replace(/^\/rough-preview\/doctor-check(-[a-z0-9]+)?\//, '');
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname))
      return { status: 404, body: 'no' };
    if (key === 'sample/iteration-01') {
      const files = sample('iteration-01');
      const marker = faults.stale
        ? (/roughbook-doctor-[a-z0-9]+/.exec(files)?.[0] ?? '')
        : (/roughbook-doctor-[a-z0-9-]+/.exec(files)?.[0] ?? '');
      const note = /"note": "([^"]+)"/.exec(files)?.[1] ?? '';
      return { status: 200, body: `<main>${marker} ${note}</main>` };
    }
    if (key === 'sample/iteration-02') return { status: 500, body: 'boom' };
    return { status: 404, body: 'none' };
  };
  return {
    built,
    served,
    browser: '/fake/chrome',
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input : input.url
      );
      if (faults.down) throw new Error('ECONNREFUSED');
      if (url.port === '3999') {
        return new Response('x', {
          status: url.pathname.startsWith('/rough-preview/') ? 404 : 200
        });
      }
      const page = pageFor(url);
      return new Response(page.body, { status: page.status });
    }) as typeof fetch,
    async probe({ url }) {
      const page = pageFor(new URL(url));
      const good = url.endsWith('/sample/iteration-01');
      const probe: Probe = {
        shows: good ? page.status === 200 : true,
        ready: good && page.status === 200,
        error: page.status >= 400 ? `HTTP ${page.status}` : null,
        visibleOverlays: 0,
        exceptions: [],
        text: page.body.replace(/<[^>]+>/g, ' ')
      };
      return probe;
    },
    async screenshot({ file }) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'png');
      return true;
    },
    async exec(command) {
      built.push(command);
      return { code: 0 };
    },
    async serve(command, _cwd, url) {
      served.push(`${command} @ ${url}`);
      return { stop: async () => {} };
    },
    which: program => `/fake/bin/${program}`,
    addresses: () => ['192.168.1.20'],
    sleep: async () => {},
    now: () => (clock += 1000)
  };
}

function detection(found: boolean): Detection {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'terminal',
    found,
    executable: found ? { command: 'C:/tools/claude.exe', prefixArgs: [], source: 'PATH' } : null,
    version: found ? '2.1.286' : null,
    signedIn: found ? true : null,
    signIn: found ? 'claude.ai' : null,
    headless: { ready: false, reason: 'Set ANTHROPIC_API_KEY.' },
    capabilities: { interactive: true, headless: true, permissions: true, usage: true }
  };
}

/** A signed-in studio over `repo`, a fake backend, and recorded terminal plans. */
async function studio(
  repo: string,
  routes: Record<string, Route>,
  options: { answers?: (string | null)[]; doctorTools?: Partial<DoctorTools> } = {}
) {
  const configDir = await tempDir('roughbook-config-');
  await saveCredentials(configDir, {
    server: SERVER,
    installId: 'install-1',
    token: 'rbi_token',
    signedInAs: 'dana@example.test',
    savedAt: new Date(0).toISOString()
  });
  const fake = fakeFetch(request => {
    const url = new URL(request.url);
    const route = routes[`${request.method} ${url.pathname.replace('/v1/api/studio', '')}`];
    return route ? route(request) : refused('NOT_FOUND', 404);
  });
  const io = recordingIo(options.answers ?? []);
  const plans: TerminalPlan[] = [];
  const overrides: Partial<MainOptions> = {
    fetch: fake.fetch,
    platform: 'win32',
    home: await tempDir('roughbook-home-'),
    detect: async adapter => (adapter.id === 'claude-code' ? detection(true) : notFound(adapter)),
    launchTerminal: async plan => void plans.push(plan),
    launchEditor: async () => {},
    copyText: async () => true
  };
  const run = (argv: string[], cwd = repo) =>
    main(argv, {
      cwd,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      io,
      ...overrides,
      ...(options.doctorTools ? { doctorTools: options.doctorTools } : {})
    });
  return { io, plans, requests: fake.requests, run, configDir };
}

const linkRoute: Route = request =>
  ok(
    {
      linkId: 'link-1',
      org: { id: ORG, name: 'Acme' },
      project: { slug: (request.body as { project: string }).project, name: 'Site' }
    },
    201
  );
const projectsRoute: Route = () =>
  ok([{ id: ORG, name: 'Acme', role: 'owner', projects: [{ slug: 'site', name: 'Site' }] }]);

describe('command approval', () => {
  it('keeps a hash per command and shell, asks again when either changes, and lives in the state folder', async () => {
    const repo = await setupRepo();
    const environment = readEnvironmentSync(repo, LINK, { os: 'linux' });
    const commands = environmentCommands(environment);
    assert.deepEqual(
      commands.map(item => [item.field, item.command, item.shell]),
      [
        ['start', 'php artisan serve', 'none'],
        ['production', 'php artisan serve --env=production', 'none']
      ]
    );
    assert.equal(unapprovedCommands(environment, await readApprovals(repo)).length, 2);
    await approveCommands(repo, commands, new Date('2026-10-20T00:00:00Z'));
    const approvals = await readApprovals(repo);
    assert.deepEqual(unapprovedCommands(environment, approvals), []);
    assert.ok(isApproved(approvals, 'php artisan serve', 'none'));
    assert.ok(!isApproved(approvals, 'php artisan serve', 'bash'), 'another shell asks again');
    assert.ok(
      !isApproved(approvals, 'php artisan serve --port 9000', 'none'),
      'a changed command asks again'
    );
    assert.equal(commandHash('a', 'none').length, 64);
    assert.notEqual(commandHash('a', 'none'), commandHash('a', 'bash'));
    assert.ok(exists(repo, 'rough/.roughbook/approvals.json'));
    assert.equal(
      approvals[commandHash('php artisan serve', 'none')]!.approvedAt,
      '2026-10-20T00:00:00.000Z'
    );
  });

  it('with nobody to answer (no terminal), approves nothing and says how; --yes approves', async () => {
    const repo = await setupRepo({ applied: true });
    const tools = fakeDoctorTools(repo);
    const environment = readEnvironmentSync(repo, LINK);
    // No answers: the recorder answers null, as the terminal does when stdin is not a TTY.
    const { io, run } = await studio(repo, {}, { doctorTools: tools });
    await run(['doctor']);
    assert.equal(unapprovedCommands(environment, await readApprovals(repo)).length, 2);
    assert.ok(
      io.lines.some(line =>
        /Nobody can answer here \(no terminal\), so none is approved.*--yes/.test(line)
      ),
      io.lines.join('\n')
    );
    assert.deepEqual(tools.served, [], 'doctor ran no unapproved command');
    assert.deepEqual(tools.built, []);

    // setup --apply: the templates are in place already, and nobody answers for the commands.
    assert.equal(await run(['setup', '--apply']), 0, io.errors.join('\n'));
    assert.equal(unapprovedCommands(environment, await readApprovals(repo)).length, 2);
    assert.equal(io.questions.filter(question => /^Approve them here\?/.test(question)).length, 2);

    // The flag is the explicit approval, with or without a terminal.
    assert.equal(await run(['setup', '--apply', '--yes']), 0, io.errors.join('\n'));
    assert.deepEqual(unapprovedCommands(environment, await readApprovals(repo)), []);
  });

  it('starts a declared shell by name with the line as its one command, never the machine’s default', () => {
    assert.deepEqual(shellInvocation('bash', 'php artisan serve'), {
      command: 'bash',
      args: ['-c', 'php artisan serve']
    });
    assert.deepEqual(shellInvocation('powershell', 'php artisan serve'), {
      command: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'php artisan serve']
    });
    assert.deepEqual(shellInvocation('cmd', 'dir'), {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'dir']
    });
    assert.deepEqual(
      resolveCommandLine('php artisan serve', '/opt/node', 'linux', () => false, 'zsh'),
      {
        command: 'zsh',
        args: ['-c', 'php artisan serve']
      }
    );
    // Without a shell, by name, as before.
    assert.deepEqual(
      resolveCommandLine('php artisan serve', '/opt/node', 'linux', () => false),
      {
        command: 'php',
        args: ['artisan', 'serve']
      }
    );
    assert.deepEqual(programOf('php artisan serve', 'none'), ['php']);
    // With a shell declared, the line is the shell's business: a variable may come before the program.
    assert.deepEqual(programOf('APP_ENV=production php artisan serve', 'sh'), ['sh']);
    assert.deepEqual(programOf('php artisan serve', 'pwsh'), ['pwsh']);
  });
});

describe('the templates in rough/setup/', () => {
  it('are applied to a clone, a whole file copied and a snippet appended once, and checked in place', async () => {
    const repo = await setupRepo();
    const environment = readEnvironmentSync(repo, LINK, { os: 'linux' });
    const before = planSetup(repo, environment);
    assert.deepEqual(
      before.map(step => [step.file.path, step.action]),
      [
        ['routes/rough-preview.php', 'create'],
        ['routes/web.php', 'append']
      ]
    );
    assert.match(
      checkSetupFiles(repo, environment).join(' '),
      /rough-preview\.php is listed.*not in the repo/
    );
    assert.deepEqual(applySetup(repo, before), ['routes/rough-preview.php', 'routes/web.php']);
    assert.equal(read(repo, 'routes/rough-preview.php'), ROUTE_TEMPLATE);
    assert.equal(read(repo, 'routes/web.php'), `${WEB_ROUTES}${SNIPPET}`);
    assert.deepEqual(checkSetupFiles(repo, environment), []);
    // Again: nothing to do, and the snippet is not added twice.
    const again = planSetup(repo, environment);
    assert.ok(again.every(step => step.action === 'unchanged'));
    assert.deepEqual(applySetup(repo, again), []);
    assert.equal(read(repo, 'routes/web.php'), `${WEB_ROUTES}${SNIPPET}`);
    // The sample iterations are not templates; another file under rough/setup/ is an orphan.
    assert.deepEqual(orphanTemplates(repo, environment), []);
    write(repo, 'rough/setup/config/rough.php', '<?php');
    assert.deepEqual(orphanTemplates(repo, environment), ['rough/setup/config/rough.php']);
    assert.match(
      checkSetupFiles(repo, environment).join(' '),
      /rough\.php is a template no setupFiles entry names/
    );
  });

  it('uninstall removes exactly them: the file is gone, the snippet is taken out, the rest stays', async () => {
    const repo = await setupRepo({ applied: true });
    const environment = readEnvironmentSync(repo, LINK, { os: 'linux' });
    const removal = removeSetup(repo, environment);
    assert.deepEqual(removal.removed, [
      'routes/rough-preview.php',
      'the snippet in routes/web.php'
    ]);
    assert.deepEqual(removal.kept, []);
    assert.ok(!exists(repo, 'routes/rough-preview.php'));
    assert.equal(read(repo, 'routes/web.php'), WEB_ROUTES);
    assert.ok(exists(repo, 'routes'), 'the app’s own folder stays');
    assert.ok(exists(repo, 'rough/setup/routes/rough-preview.php'), 'the template stays');
    assert.ok(exists(repo, 'resources/views/welcome.blade.php'));
    // A second removal finds nothing to take out and says so.
    const second = removeSetup(repo, environment);
    assert.deepEqual(second.removed, []);
    assert.equal(second.kept.length, 2);
    // Snippets are matched by their text, whatever the file's line endings.
    assert.equal(withSnippet('a\r\nb', 'c\n'), 'a\nb\nc\n');
    assert.equal(withoutSnippet('a\nb\nc\n', 'c'), 'a\nb\n');
    assert.equal(withSnippet('', 'x'), 'x\n');
  });

  it('runs the repo’s commands one at a time per repo, in order, and other repos alongside', async () => {
    const order: string[] = [];
    const slow = (key: string, name: string, ms: number) =>
      queued(key, async () => {
        order.push(`${name} start`);
        await new Promise(resolve => setTimeout(resolve, ms));
        order.push(`${name} end`);
        return name;
      });
    const results = await Promise.all([
      slow('repo-a', 'a1', 30),
      slow('repo-a', 'a2', 1),
      slow('repo-b', 'b1', 1)
    ]);
    assert.deepEqual(results, ['a1', 'a2', 'b1']);
    assert.ok(order.indexOf('a1 end') < order.indexOf('a2 start'), order.join(', '));
    assert.ok(order.indexOf('b1 start') < order.indexOf('a1 end'), order.join(', '));
    // A failure does not block what follows it.
    await assert.rejects(
      queued('repo-a', async () => Promise.reject(new Error('boom'))),
      /boom/
    );
    assert.equal(await queued('repo-a', async () => 'after'), 'after');
  });
});

describe('roughbook setup', () => {
  it('writes the prompt with the contract, the guess, the recipe notes and the rule files filled in, snapshots, and opens the agent', async () => {
    const repo = await setupRepo();
    fs.rmSync(path.join(repo, 'rough', 'environment.md'));
    write(repo, 'AGENTS.md', '# Team rules');
    const { io, plans, requests, run } = await studio(repo, {
      [`GET /orgs/${ORG}/projects/site/setup-prompt`]: () => ok(SETUP_PROMPT)
    });
    assert.equal(await run(['setup']), 0, io.errors.join('\n'));
    assert.ok(requests.some(request => request.url.endsWith('/setup-prompt')));
    const promptLine = io.lines.find(line => line.startsWith('Setup run: '))!;
    const promptFile = promptLine.slice('Setup run: '.length);
    assert.match(promptFile, /^rough\/prompts\/setup-[0-9a-f-]{36}\.md$/);
    const prompt = read(repo, promptFile);
    assert.doesNotMatch(prompt, /\{\{roughbook:/);
    assert.match(prompt, /# The preview contract/);
    assert.match(
      prompt,
      /Stack: Laravel 13 \(laravel-13, blade, php-8\); markup-css checks, live previews\./
    );
    assert.match(prompt, /Package manager: composer\./);
    assert.match(prompt, /rule files: AGENTS\.md\. Read them and respect them/);
    // Laravel has a recipe since F8: its notes are what the setup run starts from.
    assert.match(prompt, /This repo is on Laravel with Blade, which has a recipe/);
    assert.match(prompt, /<finishing>[\s\S]*Do not run roughbook doctor yourself/);
    // The agent gets the one line, in a terminal the designer watches.
    assert.equal(plans.length, 1);
    const plan = plans[0]!;
    assert.equal(plan.kind, 'spawn');
    assert.ok(
      JSON.stringify(plan).includes(`Follow the instructions in ${promptFile}`),
      JSON.stringify(plan)
    );
    assert.ok(
      io.lines.some(line => /Detected Laravel 13; the Laravel with Blade recipe fits/.test(line))
    );
    // The run is recorded, open until doctor ends it, with a snapshot of the repo before it.
    const [record] = await listSetups(repo);
    assert.equal(record!.kind, 'setup');
    assert.equal(record!.finishedAt, null);
    assert.equal(record!.promptFile, promptFile);
    const snapshot = await readSnapshot(repo, record!.id);
    assert.ok(snapshot && 'routes/web.php' in snapshot.files);
    assert.ok(
      snapshot && !Object.keys(snapshot.files).some(file => file.startsWith('rough/prompts/'))
    );

    // Never unattended.
    assert.equal(await run(['setup', '--headless']), 1);
    assert.match(io.errors.at(-1)!, /never unattended/);
  });

  it('--fix brings doctor’s failed checks back to the agent, and refuses without a report', async () => {
    const repo = await setupRepo({ applied: true });
    const { io, run } = await studio(repo, {
      [`GET /orgs/${ORG}/projects/site/setup-prompt`]: () => ok(SETUP_PROMPT)
    });
    assert.equal(await run(['setup', '--fix']), 1);
    assert.match(io.errors.at(-1)!, /no doctor report/);
    const report: DoctorReport = {
      studio: '0.3.15',
      environment: {
        contract: 1,
        recipe: null,
        stack: ['laravel-13'],
        family: 'markup-css',
        mode: 'live',
        gate: 'runtime'
      },
      outcome: 'fail',
      checks: [
        {
          id: 'environment',
          name: 'The environment reads',
          status: 'pass',
          detail: 'ok',
          fix: null
        },
        {
          id: 'fresh',
          name: 'A change shows without a restart',
          status: 'fail',
          detail: 'A change did not show within 150 s.',
          fix: 'Make the preview pick changes up.'
        },
        {
          id: 'gate',
          name: 'Nothing reaches production',
          status: 'skip',
          detail: 'Not checked.',
          fix: null
        }
      ]
    };
    write(repo, 'rough/.roughbook/doctor-report.json', JSON.stringify(report));
    assert.equal(await run(['setup', '--fix']), 0, io.errors.join('\n'));
    const promptFile = io.lines
      .find(line => line.startsWith('Setup fix: '))!
      .slice('Setup fix: '.length);
    const prompt = read(repo, promptFile);
    assert.match(
      prompt,
      /<fix>[\s\S]*1\. A change shows without a restart \(fresh\): A change did not show within 150 s\.\n {3}Fix: Make the preview pick changes up\./
    );
    assert.match(prompt, /Not checked until the failures above are fixed: gate\./);
    assert.match(prompt, /<finishing>/);
    assert.equal((await listSetups(repo))[0]!.kind, 'fix');
    assert.equal(fixSection(report, null).includes('fresh'), true);
    assert.match(
      setupFinishingSection(report.studio.length ? '00000000-0000-4000-8000-000000000001' : ''),
      /Roughbook setup run: 00000000/
    );
    assert.equal(
      fillSetupPrompt(
        'a {{x}} b',
        { contract: '{{c}}', guess: '{{x}}', recipeNotes: '{{r}}', ruleFiles: '{{f}}' },
        { guess: '$1', recipeNotes: '', ruleFiles: '' }
      ),
      'a $1 b'
    );
  });

  it('--apply puts the templates in place after showing them, approves the commands, and --upgrade has no recipe to apply', async () => {
    const repo = await setupRepo();
    const { io, run } = await studio(repo, {}, { answers: ['y', 'y'] });
    assert.equal(await run(['setup', '--apply']), 0, io.errors.join('\n'));
    assert.ok(
      io.lines.some(line =>
        /\+ write routes\/rough-preview\.php from rough\/setup\/routes\/rough-preview\.php/.test(
          line
        )
      )
    );
    assert.ok(
      io.lines.some(line =>
        /\+ add the lines of rough\/setup\/routes\/web\.php\.snippet to routes\/web\.php/.test(line)
      )
    );
    assert.equal(read(repo, 'routes/rough-preview.php'), ROUTE_TEMPLATE);
    assert.ok(io.lines.some(line => /names 2 commands the studio runs on this machine/.test(line)));
    assert.ok(io.lines.some(line => line.includes('start: php artisan serve  (run by name)')));
    const approvals = await readApprovals(repo);
    assert.ok(isApproved(approvals, 'php artisan serve', 'none'));
    assert.equal(await run(['setup', '--upgrade']), 0);
    assert.ok(io.lines.some(line => /written by your agent, not a recipe/.test(line)));
  });
});

describe('roughbook init on a repo with no recipe', () => {
  it('detects the stack, writes the workspace without a preview route, links with the tokens, and offers the setup run', async () => {
    const repo = await setupRepo();
    fs.rmSync(path.join(repo, 'rough'), { recursive: true });
    // A stack with no recipe (Laravel has one since F8): a Rails app.
    fs.rmSync(path.join(repo, 'composer.json'));
    fs.rmSync(path.join(repo, 'artisan'));
    write(repo, 'Gemfile', 'source "https://rubygems.org"\ngem "rails", "~> 8.0"\n');
    const { io, plans, requests, run } = await studio(
      repo,
      {
        'GET /projects': projectsRoute,
        [`POST /orgs/${ORG}/links`]: linkRoute,
        [`GET /orgs/${ORG}/projects/site/setup-prompt`]: () => ok(SETUP_PROMPT)
      },
      // The project, commit rough/, apply, and start the setup run now.
      { answers: ['1', '', '', 'y'] }
    );
    assert.equal(await run(['init']), 0, io.errors.join('\n'));
    assert.ok(io.lines.some(line => line.startsWith('Stack: Rails 8 (rails-8, ruby)')));
    assert.ok(io.lines.some(line => /No recipe fits Rails 8/.test(line)));
    const link = requests.find(request => request.url.endsWith('/links'))!;
    assert.deepEqual(link.body, {
      project: 'site',
      framework: 'rails-8',
      roughCommitted: true,
      stack: ['rails-8', 'ruby'],
      family: 'markup-css'
    });
    assert.ok(exists(repo, 'rough/AGENTS.md') && exists(repo, 'rough/CONTRACT.md'));
    assert.ok(!exists(repo, 'app/rough-preview'), 'no Next.js route in a Rails app');
    assert.ok(!exists(repo, 'rough/preview-registry.ts'));
    assert.deepEqual(JSON.parse(read(repo, 'rough/roughbook.json')).stack, ['rails-8', 'ruby']);
    assert.equal(JSON.parse(read(repo, 'rough/roughbook.json')).appDir, null);
    assert.match(read(repo, 'rough/AGENTS.md'), /entry file \(named by `environment\.md`/);
    // The setup run started: its prompt is written and the agent opened.
    assert.ok(io.lines.some(line => line.startsWith('Setup run: rough/prompts/setup-')));
    assert.equal(plans.length, 1);
    // Nothing the server heard names the machine or the repo's files.
    for (const request of requests) {
      assert.ok(!JSON.stringify(request.body ?? {}).includes(repo.replace(/\\/g, '/')));
    }
  });

  it('with nobody to answer the last question, opens no agent', async () => {
    const repo = await setupRepo();
    fs.rmSync(path.join(repo, 'rough'), { recursive: true });
    fs.rmSync(path.join(repo, 'composer.json'));
    fs.rmSync(path.join(repo, 'artisan'));
    write(repo, 'Gemfile', 'source "https://rubygems.org"\ngem "rails", "~> 8.0"\n');
    const { io, plans, run } = await studio(
      repo,
      {
        'GET /projects': projectsRoute,
        [`POST /orgs/${ORG}/links`]: linkRoute,
        [`GET /orgs/${ORG}/projects/site/setup-prompt`]: () => ok(SETUP_PROMPT)
      },
      // The project, commit rough/ and apply; then nobody answers whether to start the run.
      { answers: ['1', '', ''] }
    );
    assert.equal(await run(['init']), 0, io.errors.join('\n'));
    assert.equal(plans.length, 0);
    assert.ok(io.lines.some(line => /Next, run roughbook setup/.test(line)));
  });

  it('on a clone with the environment and templates, applies them, approves the commands and runs doctor when the app answers', async () => {
    const repo = await setupRepo();
    const tools = fakeDoctorTools(repo);
    const { io, requests, run } = await studio(
      repo,
      {
        'GET /projects': projectsRoute,
        [`POST /orgs/${ORG}/links`]: linkRoute,
        [`POST /orgs/${ORG}/links/link-1/doctor`]: () => ok({ recorded: true })
      },
      // The clone's rough/roughbook.json names the project, so init asks only to apply the
      // workspace, then the templates, then the commands.
      { answers: ['y', 'y', 'y'], doctorTools: tools }
    );
    assert.equal(await run(['init']), 0, io.errors.join('\n'));
    assert.ok(
      io.lines.some(line =>
        /environment\.md is here: your team's own setup, live previews/.test(line)
      )
    );
    assert.equal(read(repo, 'routes/rough-preview.php'), ROUTE_TEMPLATE);
    assert.equal(read(repo, 'routes/web.php'), `${WEB_ROUTES}${SNIPPET}`);
    assert.ok(isApproved(await readApprovals(repo), 'php artisan serve --env=production', 'none'));
    assert.ok(io.lines.some(line => /running roughbook doctor/.test(line)));
    assert.ok(
      io.lines.some(line =>
        /The preview keeps the contract: 12 passed, 0 failed, 1 skipped/.test(line)
      ),
      io.lines.join('\n')
    );
    // The link carries the environment's mode as well as the tokens.
    const link = requests.find(request => request.url.endsWith('/links'))!;
    assert.equal((link.body as { mode: string }).mode, 'live');
    // Doctor's result went up as tokens and check ids, through the install's link.
    const told = requests.find(request => request.url.endsWith('/links/link-1/doctor'))!;
    assert.deepEqual(told.body, {
      outcome: 'pass',
      mode: 'live',
      family: 'markup-css',
      stack: ['laravel-13', 'blade', 'php-8'],
      failed: [],
      // The team's own setup: no recipe, the verified tier. No setup run was open on the clone.
      recipe: null
    });
    assert.deepEqual(tools.served, ['php artisan serve --env=production @ http://127.0.0.1:3999']);
    assert.deepEqual(tools.built, []);
    assert.ok(exists(repo, 'rough/.roughbook/doctor-report.json'));
    // The sample iterations are gone again.
    assert.ok(
      !fs.readdirSync(path.join(repo, 'rough')).some(entry => entry.startsWith('doctor-check'))
    );
  });
});

describe('roughbook doctor on an agent-built setup', () => {
  it('ends the open setup run, fails the setup-files check for an unlisted change, and uninstall leaves the app as it was', async () => {
    const repo = await setupRepo({ applied: true });
    const { io, run, requests } = await studio(
      repo,
      {
        [`GET /orgs/${ORG}/projects/site/setup-prompt`]: () => ok(SETUP_PROMPT),
        [`POST /orgs/${ORG}/links/link-1/doctor`]: () => ok({ recorded: true })
      },
      { doctorTools: fakeDoctorTools(repo) }
    );
    write(
      repo,
      'rough/.roughbook/link.json',
      JSON.stringify({ linkId: 'link-1', installId: 'install-1', linkedAt: 'now' })
    );
    assert.equal(await run(['setup']), 0, io.errors.join('\n'));
    // The agent changed a file outside rough/ and forgot to list it, and told the environment to
    // ignore storage/, whose committed placeholder is then no change.
    write(
      repo,
      'config/view.php',
      "<?php return ['paths' => [resource_path('views'), base_path('rough')]];"
    );
    write(
      repo,
      'rough/environment.md',
      read(repo, 'rough/environment.md').replace('ignore:\n', 'ignore:\n  - storage\n')
    );
    assert.equal(await run(['doctor', '--yes']), 1);
    const report = JSON.parse(read(repo, 'rough/.roughbook/doctor-report.json')) as DoctorReport;
    const setupFiles = report.checks.find(check => check.id === 'setup-files')!;
    assert.equal(setupFiles.status, 'fail');
    assert.match(setupFiles.detail, /changed 1 file outside rough\/.*config\/view\.php/);
    assert.doesNotMatch(setupFiles.detail, /storage/);
    assert.match(setupFiles.fix ?? '', /snippet/);
    assert.equal(report.outcome, 'fail');
    const [record] = await listSetups(repo);
    assert.equal(record!.doctor, 'fail');
    assert.ok(record!.finishedAt);
    const told = requests.find(request => request.url.endsWith('/doctor'))!;
    assert.deepEqual((told.body as { failed: string[] }).failed, ['setup-files']);
    // The doctor that ended the setup run tells the server its kind and how long it took, for
    // analytics by stack; the recipe is none, since the agent built this setup.
    const ended = told.body as { recipe: string | null; setup?: { kind: string; seconds: number } };
    assert.equal(ended.recipe, null);
    assert.equal(ended.setup?.kind, 'setup');
    assert.ok(Number.isInteger(ended.setup?.seconds) && ended.setup!.seconds >= 0);

    // Listed with its template, the same file passes.
    write(repo, 'rough/setup/config/view.php', read(repo, 'config/view.php'));
    const environmentText = read(repo, 'rough/environment.md').replace(
      'setupFiles:\n',
      'setupFiles:\n  - config/view.php\n'
    );
    write(repo, 'rough/environment.md', environmentText);
    assert.equal(await run(['doctor', '--yes']), 0, io.lines.slice(-20).join('\n'));
    // No setup run was open this time.
    const again = requests.filter(request => request.url.endsWith('/doctor')).at(-1)!;
    assert.equal((again.body as { setup?: unknown }).setup, undefined);

    // Uninstall takes exactly the listed files out and leaves the app's own files.
    assert.equal(await run(['uninstall', '--yes']), 0, io.errors.join('\n'));
    assert.ok(!exists(repo, 'routes/rough-preview.php'));
    assert.ok(!exists(repo, 'config/view.php'));
    assert.equal(read(repo, 'routes/web.php'), WEB_ROUTES);
    assert.ok(
      exists(repo, 'rough/environment.md') && exists(repo, 'rough/setup/routes/rough-preview.php')
    );
    assert.ok(exists(repo, 'resources/views/welcome.blade.php'));
    // The app as it was before the setup was applied: the route file gone and web.php as the app
    // had it, and nothing else outside rough/ touched (the fixture committed the applied setup,
    // so git shows exactly those two going back).
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })
      .split('\n')
      .filter(line => line.trim() && !line.includes('rough/'))
      .map(line => line.trim())
      .sort();
    assert.deepEqual(status, ['D routes/rough-preview.php', 'M routes/web.php']);
  });

  it('fails the renders check when a repo with no recipe has no sample iterations to render', async () => {
    const repo = await setupRepo({ applied: true });
    fs.rmSync(path.join(repo, 'rough', 'setup', 'sample'), { recursive: true });
    const { io, run } = await studio(repo, {}, { doctorTools: fakeDoctorTools(repo) });
    assert.equal(await run(['doctor', '--yes']), 1);
    const report = JSON.parse(read(repo, 'rough/.roughbook/doctor-report.json')) as DoctorReport;
    const renders = report.checks.find(check => check.id === 'renders')!;
    assert.equal(renders.status, 'fail');
    // The report file is redacted (paths become <path>); the terminal names the folders.
    assert.match(renders.detail, /are missing: the setup run writes one iteration that renders/);
    assert.match(renders.fix ?? '', /setup --fix/);
    const line = io.lines.find(item => /FAIL {2}renders/.test(item))!;
    assert.match(
      line,
      /rough\/setup\/sample\/good\/ and rough\/setup\/sample\/broken\/ are missing/
    );
  });
});

describe('setup --upgrade and --apply show every change first', () => {
  it('--upgrade shows the lines it takes out of a file and puts in, before asking (rule 5)', async () => {
    const repo = path.join(await tempDir('roughbook-setup-'), 'app');
    const link: RepoLink = { ...LINK, appDir: 'app', stack: ['next-16'], family: 'react-like' };
    write(repo, 'package.json', JSON.stringify({ dependencies: { next: '16.4.2' } }));
    write(repo, 'node_modules/next/package.json', JSON.stringify({ version: '16.4.2' }));
    write(repo, 'app/layout.tsx', 'export default function Layout() { return null; }\n');
    write(
      repo,
      'next.config.ts',
      'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n'
    );
    write(repo, 'rough/roughbook.json', JSON.stringify(link));
    writeMap(repo, {
      version: 1,
      by: ['next'],
      pages: [
        {
          slug: 'home',
          name: 'Home',
          address: '/',
          example: null,
          signIn: 'no',
          files: [],
          sections: ['hero'],
          byAgent: false
        }
      ],
      components: [
        {
          slug: 'hero',
          name: 'Hero',
          kind: 'section',
          files: ['components/hero.tsx'],
          export: 'Hero',
          fixture: null,
          alone: 'unknown',
          why: null,
          byAgent: false
        }
      ],
      missed: [],
      unplaced: []
    });
    applyPrep(planPrep(repo, { link, recipe: recipeFor('next')! }));
    // The block as version 7 wrote it, before the cache setting.
    const current = read(repo, 'next.config.ts');
    const old = current.replace(', turbopackFileSystemCacheForDev: false', '');
    assert.notEqual(old, current);
    write(repo, 'next.config.ts', old);
    const { io, run } = await studio(repo, {}, { answers: ['n'] });
    assert.equal(await run(['setup', '--upgrade']), 0, io.errors.join('\n'));
    const shown = io.lines.slice(io.lines.findIndex(line => /would change:/.test(line)));
    assert.ok(
      shown.some(line => /^ {2}~ next\.config\.ts: /.test(line)),
      shown.join('\n')
    );
    assert.ok(
      shown.some(line => /^ {6}- .*turbopackLazyDynamicImportsSSR: true \},$/.test(line)),
      shown.join('\n')
    );
    assert.ok(
      shown.some(line =>
        /^ {6}\+ .*turbopackLazyDynamicImportsSSR: true, turbopackFileSystemCacheForDev: false \},$/.test(
          line
        )
      ),
      shown.join('\n')
    );
    assert.equal(read(repo, 'next.config.ts'), old);
  });

  it('--apply shows the lines a template changes in a file the repo has', async () => {
    const repo = await setupRepo();
    write(repo, 'routes/rough-preview.php', '<?php\n// an older route\n');
    const { io, run } = await studio(repo, {}, { answers: ['n'] });
    assert.equal(await run(['setup', '--apply']), 1, io.errors.join('\n'));
    const at = (pattern: RegExp) => io.lines.findIndex(line => pattern.test(line));
    const rewrite = at(/~ rewrite routes\/rough-preview\.php from /);
    assert.ok(rewrite >= 0, io.lines.join('\n'));
    assert.equal(io.lines[rewrite + 1], '      - // an older route');
    assert.match(io.lines[rewrite + 2]!, /^ {6}\+ /);
    const append = at(
      /\+ add the lines of rough\/setup\/routes\/web\.php\.snippet to routes\/web\.php/
    );
    assert.ok(append >= 0, io.lines.join('\n'));
    const added = SNIPPET.split('\n').find(line => line.trim())!;
    assert.ok(
      io.lines.slice(append + 1).some(line => line === `      + ${added}`),
      io.lines.join('\n')
    );
    assert.equal(read(repo, 'routes/rough-preview.php'), '<?php\n// an older route\n');
  });
});
