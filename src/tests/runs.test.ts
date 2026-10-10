import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { outboxFor } from '../api/outbox.js';
import type { RepoLink } from '../repo/link.js';
import { applyChecks, headlineAppearsIn, importsFromRough } from '../runs/checks.js';
import { finishRun, inScope, isMine, startRuns } from '../runs/lifecycle.js';
import {
  PLACEHOLDER_INDEX,
  createSlot,
  finishingSection,
  handoffLine,
  isPlaceholder
} from '../runs/slots.js';
import { revertFile } from '../runs/snapshot.js';
import { listRuns, readRun } from '../runs/store.js';
import type { Check, StartRunRequest, StartedRun } from '../runs/types.js';
import { watchedPath } from '../runs/watch.js';
import { fakeFetch, ok, refused, tempDir, type RecordedRequest } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const RUN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: 'src/app'
};
const CHECKS: Check[] = [
  { kind: 'entry-file', file: 'index.tsx' },
  { kind: 'approved-headline', version: 2, headline: 'Design that ships' }
];

const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');
const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

function started(iteration: string, runId: string, extra: Partial<StartedRun> = {}): StartedRun {
  return {
    runId,
    iteration,
    parent: null,
    targetFolder: `rough/home/hero/${iteration}`,
    prompt: `<task>\r\nGenerate ${iteration}.\r\n</task>\n`,
    checks: CHECKS,
    ...extra
  };
}

/** A prepared repo with a page, and a fake backend that hands out `runs`. */
async function setup(runs: StartedRun[], options: { git?: boolean; online?: () => boolean } = {}) {
  const repo = path.join(await tempDir('roughbook-runs-'), 'app');
  write(repo, 'package.json', '{}');
  write(repo, 'src/app/page.tsx', 'export default function Page() { return null; }\n');
  write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
  write(
    repo,
    'rough/preview.tsx',
    'export default function P({ children }) { return children; }\n'
  );
  if (options.git) {
    write(repo, '.gitignore', '/rough/.roughbook/\n');
    const run = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], {
        cwd: repo,
        stdio: 'ignore'
      });
    run('init', '--quiet');
    run('add', '-A');
    run('commit', '--quiet', '-m', 'start');
  }
  const fake = fakeFetch((request: RecordedRequest) => {
    if (options.online && !options.online()) return 'offline';
    if (request.url.endsWith('/runs')) return ok(runs, 201);
    if (request.url.endsWith('/finish'))
      return ok({ status: (request.body as { outcome: string }).outcome });
    return refused('NOT_FOUND', 404);
  });
  const api = new StudioApi({
    server: 'http://localhost:4000',
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: fake.fetch
  });
  return { repo, api, requests: fake.requests, outbox: outboxFor(repo) };
}

const GENERATE: StartRunRequest = {
  page: 'home',
  component: 'hero',
  agent: 'claude-code',
  mode: 'interactive',
  kind: 'generate',
  directions: [{ direction: 'Quiet' }, { direction: 'Loud' }]
};

describe('whose change', () => {
  it('matches a file, a folder, or everything with a dot', () => {
    assert.ok(isMine('src/app/page.tsx', ['src/app/page.tsx']));
    assert.ok(isMine('src/app/page.tsx', ['src']));
    assert.ok(isMine('src/app/page.tsx', ['./src/app/']));
    assert.ok(isMine('src/app/page.tsx', ['src\\app']));
    assert.ok(isMine('src/app/page.tsx', ['docs', '.']));
    assert.ok(!isMine('src/app/page.tsx', ['src/app/page']));
    assert.ok(!isMine('src/app/page.tsx', ['docs', 'src/lib']));
    assert.ok(!isMine('src/app/page.tsx', []));
  });
});

describe('starting runs', () => {
  it('writes a placeholder slot and a prompt file for each run, and records them', async () => {
    const { repo, api, requests } = await setup([
      started('iteration-03', RUN_A),
      started('iteration-04', RUN_B)
    ]);
    const records = await startRuns(repo, api, LINK, GENERATE);
    assert.deepEqual(
      records.map(record => [record.iteration, record.promptFile]),
      [
        ['iteration-03', `rough/home/hero/prompts/${RUN_A}.md`],
        ['iteration-04', `rough/home/hero/prompts/${RUN_B}.md`]
      ]
    );
    assert.equal(
      new URL(requests[0]!.url).pathname,
      `/v1/api/studio/orgs/${ORG}/projects/site/runs`
    );
    assert.deepEqual(requests[0]!.body, GENERATE);
    assert.equal(read(repo, 'rough/home/hero/iteration-03/index.tsx'), PLACEHOLDER_INDEX);
    // Prompt files are written with \n line endings whatever the server sent, and end with how the
    // run finishes, since the designer drives this one.
    assert.equal(
      read(repo, `rough/home/hero/prompts/${RUN_A}.md`),
      `<task>\nGenerate iteration-03.\n</task>\n\n${finishingSection(RUN_A)}`
    );
    assert.match(finishingSection(RUN_A), new RegExp(`^Roughbook run: ${RUN_A}$`, 'm'));
    assert.match(read(repo, 'rough/preview-registry.ts'), /"home\/hero\/iteration-04"/);
    assert.equal((await listRuns(repo)).length, 2);
    assert.equal(
      handoffLine(records[0]!.promptFile),
      `Follow the instructions in rough/home/hero/prompts/${RUN_A}.md`
    );
  });

  it('refuses a folder the server names outside rough/, and a parent that is not here', async () => {
    const elsewhere = await setup([started('iteration-03', RUN_A, { targetFolder: 'src/app' })]);
    await assert.rejects(
      startRuns(elsewhere.repo, elsewhere.api, LINK, GENERATE),
      /not an iteration folder/
    );
    assert.ok(!fs.existsSync(path.join(elsewhere.repo, 'rough', 'home')));

    const fork = await setup([started('iteration-05', RUN_A, { parent: 'iteration-02' })]);
    const request: StartRunRequest = { ...GENERATE, kind: 'fork', parent: 'iteration-02' };
    await assert.rejects(startRuns(fork.repo, fork.api, LINK, request), /is not in this repo/);
    assert.equal(fork.requests.length, 0);

    write(fork.repo, 'rough/home/hero/iteration-02/index.tsx', 'export default function A() {}\n');
    write(fork.repo, 'rough/home/hero/iteration-02/parts/Bar.tsx', 'export const Bar = 1;\n');
    await startRuns(fork.repo, fork.api, LINK, request);
    assert.equal(
      read(fork.repo, 'rough/home/hero/iteration-05/parts/Bar.tsx'),
      'export const Bar = 1;\n'
    );
  });

  it('never writes over an existing iteration', async () => {
    const { repo } = await setup([]);
    write(repo, 'rough/home/hero/iteration-01/index.tsx', 'mine');
    assert.throws(
      () =>
        createSlot(repo, {
          page: 'home',
          component: 'hero',
          iteration: 'iteration-01',
          parent: null
        }),
      /already exists/
    );
    assert.equal(read(repo, 'rough/home/hero/iteration-01/index.tsx'), 'mine');
    assert.throws(
      () =>
        createSlot(repo, {
          page: '..',
          component: 'hero',
          iteration: 'iteration-02',
          parent: null
        }),
      /Not an iteration/
    );
  });
});

describe('finishing runs', () => {
  it('fails a run whose iteration is still the placeholder, and reports only codes and counts', async () => {
    const { repo, api, requests } = await setup([started('iteration-03', RUN_A)]);
    await startRuns(repo, api, LINK, { ...GENERATE, directions: [{ direction: 'Quiet' }] });
    const run = await finishRun(repo, api, outboxFor(repo), LINK, RUN_A);
    assert.equal(run.outcome, 'failed');
    assert.equal(run.failure?.code, 'PLACEHOLDER');
    const finish = requests.find(request => request.url.endsWith('/finish'))!;
    assert.equal(new URL(finish.url).pathname, `/v1/api/studio/orgs/${ORG}/runs/${RUN_A}/finish`);
    const body = finish.body as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      'durationMs',
      'outOfScopeWrites',
      'outcome',
      'usage',
      'warnings'
    ]);
    assert.deepEqual(
      [body.outcome, body.warnings, body.outOfScopeWrites],
      ['failed', ['PLACEHOLDER'], 0]
    );
    assert.equal(run.reported, 'sent');
    // Finishing again changes nothing and sends nothing.
    await finishRun(repo, api, outboxFor(repo), LINK, RUN_A);
    assert.equal(requests.filter(request => request.url.endsWith('/finish')).length, 1);
  });

  it('completes a good run, warns about a missing headline, and flags writes outside its folder', async () => {
    const { repo, api, requests } = await setup([
      started('iteration-03', RUN_A),
      started('iteration-04', RUN_B)
    ]);
    await startRuns(repo, api, LINK, GENERATE);
    write(
      repo,
      'rough/home/hero/iteration-03/index.tsx',
      'export default () => <h1>Design <em>that</em> ships</h1>;\n'
    );
    write(
      repo,
      'rough/home/hero/iteration-04/index.tsx',
      'export default () => <h1>Something else</h1>;\n'
    );
    // The other run in the batch writing its own folder is not this run's fault.
    write(repo, 'rough/home/hero/iteration-04/extra.css', 'h1 {}\n');

    const good = await finishRun(repo, api, outboxFor(repo), LINK, RUN_A);
    assert.equal(good.outcome, 'completed');
    assert.deepEqual(good.warnings, []);

    write(repo, 'src/app/page.tsx', 'export default function Page() { return <main />; }\n');
    write(repo, 'src/app/new.tsx', 'export const x = 1;\n');
    const warned = await finishRun(repo, api, outboxFor(repo), LINK, RUN_B);
    assert.equal(warned.outcome, 'completed_with_warnings');
    assert.deepEqual(
      warned.warnings.map(item => item.code),
      ['APPROVED_HEADLINE_MISSING', 'OUT_OF_SCOPE_WRITE']
    );
    assert.deepEqual(warned.outOfScope, ['src/app/new.tsx', 'src/app/page.tsx']);
    const body = requests.filter(request => request.url.endsWith('/finish'))[1]!.body as {
      outOfScopeWrites: number;
    };
    assert.equal(body.outOfScopeWrites, 2);
  });

  it('reverts a write outside the folder: committed, uncommitted and new files alike', async () => {
    const { repo, api } = await setup([started('iteration-03', RUN_A)], { git: true });
    write(repo, 'src/app/draft.tsx', 'my uncommitted work\n');
    await startRuns(repo, api, LINK, { ...GENERATE, directions: [{ direction: 'Quiet' }] });
    write(repo, 'src/app/page.tsx', 'changed by the agent\n');
    write(repo, 'src/app/draft.tsx', 'overwritten by the agent\n');
    write(repo, 'src/app/stray.tsx', 'new\n');
    write(
      repo,
      'rough/home/hero/iteration-03/index.tsx',
      'export default () => <h1>Design that ships</h1>;\n'
    );
    const run = await finishRun(repo, api, outboxFor(repo), LINK, RUN_A);
    assert.deepEqual(run.outOfScope, [
      'src/app/draft.tsx',
      'src/app/page.tsx',
      'src/app/stray.tsx'
    ]);

    assert.equal(await revertFile(repo, RUN_A, 'src/app/page.tsx'), 'restored');
    assert.equal(
      read(repo, 'src/app/page.tsx'),
      'export default function Page() { return null; }\n'
    );
    assert.equal(await revertFile(repo, RUN_A, 'src/app/draft.tsx'), 'restored');
    assert.equal(read(repo, 'src/app/draft.tsx'), 'my uncommitted work\n');
    assert.equal(await revertFile(repo, RUN_A, 'src/app/stray.tsx'), 'removed');
    assert.ok(!fs.existsSync(path.join(repo, 'src', 'app', 'stray.tsx')));
    assert.equal(await revertFile(repo, RUN_A, 'src/app/page.tsx'), 'unchanged');
    assert.equal(await revertFile(repo, RUN_A, '../outside.txt'), 'cannot');
  });

  it('keeps the result for later when the backend cannot be reached', async () => {
    let online = true;
    const { repo, api } = await setup([started('iteration-03', RUN_A)], { online: () => online });
    await startRuns(repo, api, LINK, { ...GENERATE, directions: [{ direction: 'Quiet' }] });
    write(
      repo,
      'rough/home/hero/iteration-03/index.tsx',
      'export default () => <h1>Design that ships</h1>;\n'
    );
    online = false;
    const run = await finishRun(repo, api, outboxFor(repo), LINK, RUN_A);
    assert.equal(run.reported, 'queued');
    assert.equal((await outboxFor(repo).pending()).length, 1);
    assert.equal((await readRun(repo, RUN_A))?.status, 'finished');
  });

  it('flags app code that imports from rough/, except the preview route', async () => {
    const repo = await tempDir();
    write(repo, 'src/app/page.tsx', 'import Hero from "../../rough/home/hero/iteration-01";\n');
    write(repo, 'src/lib/ok.ts', 'import { x } from "./roughly";\nimport r from "roughjs";\n');
    write(
      repo,
      'src/app/rough-preview/[...slug]/page.tsx',
      'await import("../../../../rough/preview-registry")\n'
    );
    write(repo, 'rough/home/hero/iteration-01/index.tsx', 'import "../iteration-02";\n');
    assert.deepEqual(
      importsFromRough(
        repo,
        [
          'src/app/page.tsx',
          'src/lib/ok.ts',
          'src/app/rough-preview/[...slug]/page.tsx',
          'rough/home/hero/iteration-01/index.tsx'
        ],
        'src/app/rough-preview'
      ),
      ['src/app/page.tsx']
    );
  });
});

describe('checks and scope', () => {
  it('flags a fork that still names its parent or did not change', () => {
    const parent = new Map([['index.tsx', 'export default () => <div data-id="iteration-02" />;']]);
    const checks: Check[] = [
      { kind: 'entry-file', file: 'index.tsx' },
      { kind: 'changed-from-parent', parent: 'iteration-02' }
    ];
    const same = applyChecks(checks, {
      iterationId: 'iteration-03',
      files: new Map(parent),
      parentFiles: parent
    });
    assert.deepEqual(
      same.warnings.map(item => item.code),
      ['NAMES_PARENT', 'UNCHANGED_FROM_PARENT']
    );
    assert.equal(
      applyChecks(checks, { iterationId: 'iteration-03', files: null }).failure?.code,
      'TARGET_MISSING'
    );
    assert.equal(
      applyChecks(checks, { iterationId: 'iteration-03', files: new Map([['other.tsx', 'x']]) })
        .failure?.code,
      'ENTRY_MISSING'
    );
  });

  it('finds a headline across tags and lines, and knows both placeholders', () => {
    assert.ok(
      headlineAppearsIn('<h1>\n  Design <span>that</span>\n  ships!\n</h1>', 'Design that ships')
    );
    assert.ok(!headlineAppearsIn('<h1>Design ships</h1>', 'Design that ships'));
    assert.ok(isPlaceholder(PLACEHOLDER_INDEX));
    assert.ok(
      isPlaceholder(
        '<p>Not yet generated. Paste the compiled prompt into Claude Code to fill this iteration.</p>'
      )
    );
  });

  it('lets a run write only its folder, its prompt and the registry, and ignores churn', () => {
    const run = {
      targetFolder: 'rough/home/hero/iteration-03',
      promptFile: `rough/home/hero/prompts/${RUN_A}.md`
    };
    assert.ok(inScope('rough/home/hero/iteration-03/index.tsx', [run]));
    assert.ok(inScope(run.promptFile, [run]));
    assert.ok(inScope('rough/preview-registry.ts', [run]));
    assert.ok(!inScope('rough/home/hero/iteration-030/index.tsx', [run]));
    assert.ok(!inScope('src/app/page.tsx', [run]));
    assert.equal(watchedPath('node_modules\\react\\index.js'), null);
    assert.equal(watchedPath('rough/.roughbook/runs/x.json'), null);
    assert.equal(watchedPath('src\\app\\page.tsx'), 'src/app/page.tsx');
  });
});
