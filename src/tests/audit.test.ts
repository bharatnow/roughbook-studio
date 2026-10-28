// A13 step 4 of the Apple plan: the accessibility-audit contract. Apple's
// performAccessibilityAudit() runs in an XCUITest target with a host app, which the repo's own
// environment provides, as it does for snapshots; the studio declares the command (`audit` in
// rough/environment.md), runs it per iteration key, and reads `roughbook: audit <key>: ok` or
// `roughbook: audit <key>: issue <message>` lines. Issues are ACCESSIBILITY_AUDIT warnings in Done
// and get_checks, never a failure. This machine has no Xcode: the command is a fake Node script.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { outboxFor } from '../api/outbox.js';
import { AUDIT_CODE, auditCommandFor, auditIteration, parseAuditOutput } from '../audit/run.js';
import type { CommandContext } from '../commands/context.js';
import { finishWithScreenshots } from '../commands/done.js';
import {
  environmentFromHeader,
  parseEnvironmentHeader,
  readEnvironmentSync
} from '../environment/read.js';
import type { EnvironmentOs } from '../environment/types.js';
import { hostPlatform } from '../launch/platform.js';
import { studioTools } from '../mcp/tools.js';
import type { ToolCall } from '../mcp/server.js';
import { approveCommands, environmentCommands } from '../repo/approvals.js';
import type { RepoLink } from '../repo/link.js';
import { startRuns } from '../runs/lifecycle.js';
import { readRun } from '../runs/store.js';
import type { Check, StartedRun } from '../runs/types.js';
import { fakeFetch, ok, refused, tempDir, type RecordedRequest } from './helpers.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY = 'home/hero/iteration-03';
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: null
};
const CHECKS: Check[] = [{ kind: 'entry-file', file: 'index.tsx' }];
const COMMAND = 'node audit.mjs {key}';

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

function environmentOf(header: string, os: EnvironmentOs = 'macos') {
  return environmentFromHeader(parseEnvironmentHeader(header)!, LINK, os);
}

/**
 * A fake audit: prints what plans/audit-plan.json says (a folder the repo's snapshots skip), with
 * the key filled in, and exits with its code.
 */
const FAKE_AUDIT = `import fs from 'node:fs';
const key = process.argv[2];
const plan = JSON.parse(fs.readFileSync('plans/audit-plan.json', 'utf8'));
if (plan.sleep) await new Promise(resolve => setTimeout(resolve, plan.sleep));
console.log('Test Suite RoughAudit started');
if (process.env.ROUGHBOOK_KEY !== key) console.log('roughbook: audit ' + key + ': issue ROUGHBOOK_KEY was not set');
for (const line of plan.lines) console.log(line.replaceAll('{key}', key));
process.exit(plan.code ?? 0);
`;

type Plan = { lines: string[]; code?: number; sleep?: number };

/** A repo whose environment declares the fake audit, approved here unless `approve` is false. */
async function auditRepo(options: { audit?: string | null; approve?: boolean; plan?: Plan } = {}) {
  const repo = path.join(await tempDir('roughbook-audit-'), 'app');
  write(repo, 'package.json', '{}');
  write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
  write(repo, 'audit.mjs', FAKE_AUDIT);
  setPlan(repo, options.plan ?? { lines: ['roughbook: audit {key}: ok'] });
  const audit = options.audit === undefined ? COMMAND : options.audit;
  write(
    repo,
    'rough/environment.md',
    `---\ncontract: 1\n${audit === null ? '' : `audit: ${audit}\n`}ignore:\n  - plans\n  - node_modules\n---\n\n# This repo\n`
  );
  const environment = readEnvironmentSync(repo, LINK);
  if (options.approve !== false && environment.audit) {
    await approveCommands(repo, [{ command: environment.audit, shell: environment.shell }]);
  }
  return { repo, environment };
}

function setPlan(repo: string, plan: Plan) {
  write(repo, 'plans/audit-plan.json', JSON.stringify(plan));
}

/** The repo with one run started on KEY, and a fake backend that records the finish. */
async function startedRun(options: Parameters<typeof auditRepo>[0] = {}) {
  const { repo, environment } = await auditRepo(options);
  const run: StartedRun = {
    runId: RUN,
    iteration: 'iteration-03',
    parent: null,
    targetFolder: `rough/${KEY}`,
    prompt: '<task>\nGenerate it.\n</task>\n',
    checks: CHECKS
  };
  const fake = fakeFetch((request: RecordedRequest) => {
    if (request.url.endsWith('/runs')) return ok([run], 201);
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
  await startRuns(repo, api, LINK, {
    page: 'home',
    component: 'hero',
    agent: 'claude-code',
    mode: 'interactive',
    kind: 'generate',
    directions: [{ direction: 'Quiet' }]
  });
  write(repo, `rough/${KEY}/index.tsx`, 'export default () => <h1>Design that ships</h1>;\n');
  const context = {
    repoRoot: repo,
    cwd: repo,
    env: {},
    platform: hostPlatform(),
    askPreview: async () => undefined
  } as unknown as CommandContext;
  return { repo, environment, api, requests: fake.requests, context };
}

const toolCall = (repo: string): ToolCall =>
  ({ roots: async () => [repo], progress: () => undefined }) as unknown as ToolCall;

describe('the audit command in the environment', () => {
  it('reads audit per operating system, none for none, and leaves it out when absent', () => {
    const header = `---\ncontract: 1\naudit: xcodebuild test -only-testing:RoughAudit {key}\nauditWindows: none\n---\n`;
    const mac = environmentOf(header);
    assert.equal(mac.audit, 'xcodebuild test -only-testing:RoughAudit {key}');
    assert.equal(environmentOf(header, 'windows').audit, null);
    assert.equal(environmentOf('---\ncontract: 1\n---\n').audit, null);
    assert.equal(environmentOf('---\ncontract: 1\naudit: none\n---\n').audit, null);
    // An audit command is run on this machine, so it is approved like every other.
    assert.ok(environmentCommands(mac).some(item => item.field === 'audit'));
    assert.ok(
      !environmentCommands(environmentOf('---\ncontract: 1\n---\n')).some(
        item => item.field === 'audit'
      )
    );
  });
});

describe('the audit line contract', () => {
  it('reads ok and issues for the key alone, and ignores everything else', () => {
    assert.equal(auditCommandFor('run-audit --key={key}', KEY), `run-audit --key=${KEY}`);
    const output = [
      'Test Suite RoughAudit started',
      `roughbook: audit ${KEY}: issue Button "Close" has no label`,
      `    [RoughAudit] roughbook: audit ${KEY}: issue Text clips at the largest size\r`,
      `roughbook: audit home/hero/iteration-04: issue Not this key`,
      `roughbook: audit ${KEY}: issue Button "Close" has no label`,
      `roughbook: ready ${KEY}`,
      'roughbook: audit home/hero: ok',
      `roughbook: audit ${KEY} issue missing its colon`
    ].join('\n');
    assert.deepEqual(parseAuditOutput(output, KEY), {
      ok: false,
      issues: ['Button "Close" has no label', 'Text clips at the largest size']
    });
    assert.deepEqual(parseAuditOutput(`roughbook: audit ${KEY}: ok\n`, KEY), {
      ok: true,
      issues: []
    });
    assert.equal(parseAuditOutput('Build succeeded\n', KEY), null);
    // An issue with no words is still an issue.
    assert.deepEqual(parseAuditOutput(`roughbook: audit ${KEY}: issue\n`, KEY), {
      ok: false,
      issues: ['An issue the audit did not describe']
    });
  });
});

describe('running the audit', () => {
  it('warns once per issue, never fails, and says nothing when the audit passes', async () => {
    const { repo, environment } = await auditRepo();
    assert.deepEqual(await auditIteration(repo, environment, KEY), []);

    // performAccessibilityAudit fails its test when it finds issues: the exit code is not 0.
    setPlan(repo, {
      lines: [
        'roughbook: audit {key}: issue Image "hero" has no accessibility label',
        'roughbook: audit {key}: issue Contrast is too low on "Learn more"'
      ],
      code: 65
    });
    assert.deepEqual(await auditIteration(repo, environment, KEY), [
      {
        code: AUDIT_CODE,
        message: `Accessibility audit of ${KEY}: Image "hero" has no accessibility label`
      },
      {
        code: AUDIT_CODE,
        message: `Accessibility audit of ${KEY}: Contrast is too low on "Learn more"`
      }
    ]);
  });

  it('is one warning when the command fails, says nothing of the key, times out or is not approved', async () => {
    const { repo, environment } = await auditRepo({
      plan: { lines: ['xcodebuild: error: Unable to find a destination'], code: 70 }
    });
    const failed = await auditIteration(repo, environment, KEY);
    assert.equal(failed.length, 1);
    assert.equal(failed[0]!.code, AUDIT_CODE);
    assert.match(
      failed[0]!.message,
      /^The accessibility audit could not run on home\/hero\/iteration-03: .*exit 70.*Unable to find a destination/
    );

    setPlan(repo, { lines: ['All good, but no word on the key'] });
    const silent = await auditIteration(repo, environment, KEY);
    assert.equal(silent.length, 1);
    assert.match(silent[0]!.message, /could not run.*said nothing of home\/hero\/iteration-03/);

    setPlan(repo, { lines: [], sleep: 10_000 });
    const slow = await auditIteration(
      repo,
      { ...environment, timeouts: { ...environment.timeouts, build: 1 } },
      KEY
    );
    assert.equal(slow.length, 1);
    assert.match(slow[0]!.message, /could not run.*did not finish within 1 s/);

    setPlan(repo, { lines: ['roughbook: audit {key}: ok'] });
    const other = { ...environment, audit: 'node audit.mjs {key} --again' };
    const unapproved = await auditIteration(repo, other, KEY);
    assert.equal(unapproved.length, 1);
    assert.match(unapproved[0]!.message, /could not run.*not approved on this machine/);
  });

  it('runs nothing and warns of nothing with no audit command', async () => {
    const { repo, environment } = await auditRepo({ audit: null });
    assert.equal(environment.audit, null);
    let ran = false;
    const exec = async () => {
      ran = true;
      return { code: 0, output: '' };
    };
    assert.deepEqual(await auditIteration(repo, environment, KEY, exec), []);
    assert.equal(ran, false);
  });
});

describe('the audit in Done and get_checks', () => {
  it("adds the audit's issues to Done's warnings and to what is reported, as codes", async () => {
    const { repo, api, requests, context } = await startedRun({
      plan: { lines: ['roughbook: audit {key}: issue Button has no label'], code: 65 }
    });
    const { run } = await finishWithScreenshots(context, api, outboxFor(repo), LINK, RUN, {
      devUrl: 'http://localhost:3000',
      screenshots: false
    });
    assert.equal(run.failure, null);
    assert.equal(run.outcome, 'completed_with_warnings');
    assert.deepEqual(run.warnings, [
      { code: AUDIT_CODE, message: `Accessibility audit of ${KEY}: Button has no label` }
    ]);
    const finish = requests.find(request => request.url.endsWith('/finish'))!;
    assert.deepEqual((finish.body as { warnings: string[] }).warnings, [AUDIT_CODE]);
    assert.deepEqual((await readRun(repo, RUN))!.warnings, run.warnings);
  });

  it('finishes clean with no audit command, and skips the audit for a cancelled run', async () => {
    const quiet = await startedRun({ audit: null });
    const { run } = await finishWithScreenshots(
      quiet.context,
      quiet.api,
      outboxFor(quiet.repo),
      LINK,
      RUN,
      { devUrl: 'http://localhost:3000', screenshots: false }
    );
    assert.equal(run.outcome, 'completed');
    assert.deepEqual(run.warnings, []);

    const cancelled = await startedRun({
      plan: { lines: ['roughbook: audit {key}: issue Should not be asked'] }
    });
    const stopped = await finishWithScreenshots(
      cancelled.context,
      cancelled.api,
      outboxFor(cancelled.repo),
      LINK,
      RUN,
      { outcome: 'cancelled', devUrl: 'http://localhost:3000', screenshots: false }
    );
    assert.equal(stopped.run.outcome, 'cancelled');
    assert.deepEqual(stopped.run.warnings, []);
  });

  it('get_checks names the audit and reports its issues as warnings, never as a failure', async () => {
    const { repo, context } = await startedRun({
      plan: { lines: ['roughbook: audit {key}: issue Toggle has no value'], code: 65 }
    });
    const getChecks = studioTools(context, { devUrl: 'http://localhost:3000' }).find(
      tool => tool.name === 'get_checks'
    )!;
    const answer = JSON.parse(String(await getChecks.call({ run: RUN }, toolCall(repo))));
    assert.ok(
      answer.checks.some((line: string) => /accessibility audit.*Warnings only/i.test(line)),
      answer.checks.join('\n')
    );
    assert.equal(answer.now.failure, null);
    assert.equal(answer.now.passes, false);
    assert.deepEqual(answer.now.warnings, [`Accessibility audit of ${KEY}: Toggle has no value`]);
    assert.match(answer.next, /Fix what fails/);

    setPlan(repo, { lines: ['roughbook: audit {key}: ok'] });
    const clean = JSON.parse(String(await getChecks.call({ run: RUN }, toolCall(repo))));
    assert.equal(clean.now.passes, true);
  });

  it('get_checks says nothing of an audit the repo does not have', async () => {
    const { repo, context } = await startedRun({ audit: null });
    const getChecks = studioTools(context, { devUrl: 'http://localhost:3000' }).find(
      tool => tool.name === 'get_checks'
    )!;
    const answer = JSON.parse(String(await getChecks.call({ run: RUN }, toolCall(repo))));
    assert.ok(!answer.checks.some((line: string) => /audit/i.test(line)));
    assert.equal(answer.now.passes, true);
  });
});
