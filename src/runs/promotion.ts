// Updating the app (B4 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 10, 18 and 35 to 39): a promote
// of a fork or refine of the app's own component writes back into the component's own files,
// with each child the agent copied in written back to its original. The start knows where the
// change goes and whether the app moved since the fork (in place, or a merge); it snapshots the
// targets and, when asked, puts the change on a new branch. The finish shows the diff, names any
// file outside the promote's scope, runs the app's build and checks, reports codes and counts,
// and on a branch commits only the promote's files on the designer's yes. Nothing is pushed, and
// no path or code reaches the server.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import type { Outbox } from '../api/outbox.js';
import type { RepoEnvironment, Shell } from '../environment/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { withLock } from '../fs/lock.js';
import { runCapture } from '../launch/processes.js';
import { isApproved, readApprovals } from '../repo/approvals.js';
import { lineDiff, type DiffHunk } from '../repo/diff.js';
import { iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR, statePath } from '../repo/root.js';
import { BASE_DIR, inLineEndingsOf, sameText, type BaseRecord } from './base.js';
import { queued } from './queue.js';
import {
  compareFiles,
  hashRepo,
  readSnapshot,
  revertFile,
  snapshotContent,
  type Revert
} from './snapshot.js';
import { assertRunId } from './store.js';

/** How the change reaches the app: a new file, the component's own files, or a merge (B4's contract). */
export type PromoteHow = 'new' | 'in-place' | 'merge';

/** How a promote ended, as `promotion.finished` carries it. */
export type PromotionOutcome = 'done' | 'conflict' | 'out-of-scope' | 'failed';

/** A build's or the checks' result, as `promotion.finished` carries it. */
export type CheckResult = 'passed' | 'failed' | 'skipped';

/** The stand-ins the backend writes in a promote prompt for the app's own files (B4's contract). */
export const PROMOTE_FILES_PLACEHOLDER = '{{roughbook:promote-files}}';

/** The branch a promote goes on unless the designer names one (decision 18). */
export function defaultBranch(page: string, component: string, iteration: string): string {
  return `roughbook/${page}-${component}-${iteration}`;
}

/** One file the promote writes: the app's, by repository path, and the iteration's copy of it. */
export type PromoteTarget = {
  path: string;
  /** The copy's path inside the iteration, or null for a radical fork, which starts empty. */
  copy: string | null;
  /** A child component the agent copied in to change (decision 32), not the component's own. */
  child: boolean;
  /** Changed in the app since the fork, against its kept base. */
  drifted: boolean;
  /** In a page composition's promote (B6): the new section this file is written from. */
  section?: { component: string; iteration: string; name: string };
};

/** One command the finish ran: the environment's build, or one of its checks (decision 35). */
export type CommandRun = {
  command: string;
  result: CheckResult;
  /** The exit code; null when it timed out or did not run. */
  code: number | null;
  seconds: number;
  /** Why it was skipped, or how it failed, in words. */
  note: string | null;
  /** The output's last lines, when it failed. */
  tail: string[];
};

/** One app file the promote changed, as the diff shows it. */
export type ChangedFile = {
  path: string;
  status: 'added' | 'changed' | 'removed';
  /** A target or a file the studio wrote for the promote; otherwise out of scope (decision 36). */
  inScope: boolean;
};

export type PromotionResult = {
  outcome: PromotionOutcome;
  changed: ChangedFile[];
  /** App files changed outside the targets and the studio's own writes, offered for revert. */
  outOfScope: string[];
  /** Where a merge's two changes conflict, from the agent's report (decision 37). */
  conflicts: string[];
  /** Targets the agent wrote anyway in a conflicting merge, put back by the studio. */
  putBackOnConflict: string[];
  /** Targets whose line endings the studio turned back to the app file's own (decision 39). */
  lineEndings: string[];
  build: CommandRun | null;
  checks: CommandRun[];
  buildResult: CheckResult;
  checksResult: CheckResult;
  /** Whether the outcome reached the backend, or waits in the outbox. */
  reported: 'sent' | 'queued' | null;
};

/** `rough/.roughbook/promotions/<id>.json`: what this machine knows of one promote. */
export type PromotionRecord = {
  promotionId: string;
  orgId: string;
  project: string;
  page: string;
  /**
   * The component and iteration promoted; for a page composition's (B6), `compositions` and the
   * composition's id, so `<page>/<component>/<iteration>` is its folder in rough/ either way.
   */
  component: string;
  iteration: string;
  /** A page composition's promote (B6); a component's when absent. */
  subject?: 'page';
  how: PromoteHow;
  targets: PromoteTarget[];
  /** Files the studio itself wrote for the promote outside rough/: the assets it copied in. */
  studioWrites: string[];
  promptFile: string;
  /** The branch the change was put on, the one it started from, and the commit it started at. */
  branch: { name: string; from: string | null; commit: string } | null;
  startedAt: string;
  status: 'started' | 'finished';
  finishedAt: string | null;
  result: PromotionResult | null;
  /** On a branch: waiting for the designer's yes, committed, or left uncommitted on their no. */
  commit: {
    state: 'pending' | 'committed' | 'declined';
    sha: string | null;
    files: string[];
  } | null;
  /** Files put back since, with roughbook revert or the local UI. */
  putBack?: string[];
};

function promotionFile(repoRoot: string, promotionId: string): string {
  return statePath(repoRoot, 'promotions', `${assertRunId(promotionId)}.json`);
}

export async function savePromotion(repoRoot: string, record: PromotionRecord): Promise<void> {
  await writeJsonAtomic(promotionFile(repoRoot, record.promotionId), record);
}

export async function readPromotion(
  repoRoot: string,
  promotionId: string
): Promise<PromotionRecord | null> {
  return readJson<PromotionRecord>(promotionFile(repoRoot, promotionId));
}

export async function updatePromotion(
  repoRoot: string,
  promotionId: string,
  change: (record: PromotionRecord) => PromotionRecord
): Promise<PromotionRecord> {
  const file = promotionFile(repoRoot, promotionId);
  return withLock(file, async () => {
    const record = await readJson<PromotionRecord>(file);
    if (!record) throw new Error(`There is no promotion ${promotionId} in this repo.`);
    const changed = change(record);
    await writeJsonAtomic(file, changed);
    return changed;
  });
}

/** Every promote in this repo, newest first. */
export async function listPromotions(repoRoot: string): Promise<PromotionRecord[]> {
  let names: string[];
  try {
    names = await readdir(statePath(repoRoot, 'promotions'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records = await Promise.all(
    names
      .filter(name => name.endsWith('.json'))
      .map(name => {
        try {
          return readPromotion(repoRoot, name.slice(0, -5));
        } catch {
          return null;
        }
      })
  );
  return records
    .filter((record): record is PromotionRecord => record !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Whether `name` is this promote: its id or the id's first eight characters, or its iteration. */
export function namesPromotion(record: PromotionRecord, name: string): boolean {
  const clean = name.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return (
    record.promotionId === clean ||
    (clean.length >= 8 && record.promotionId.startsWith(clean)) ||
    `${record.page}/${record.component}/${record.iteration}` === clean ||
    record.iteration === clean ||
    clean === record.promptFile ||
    clean.endsWith(`/${record.promptFile}`)
  );
}

function toDisk(repoRoot: string, relative: string): string {
  return path.join(repoRoot, ...relative.split('/'));
}

function readBytes(repoRoot: string, file: string): Buffer | null {
  try {
    return fs.readFileSync(toDisk(repoRoot, file));
  } catch {
    return null;
  }
}

/**
 * An app file a promote may write back: a relative path inside the repo, outside rough/ and the
 * folders the environment ignores; the problem, or null.
 */
export function checkAppFile(file: string, ignore: string[] = []): string | null {
  const normalized = file.replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    return `${file} is not a relative path inside the repo.`;
  }
  if (normalized === ROUGH_DIR || normalized.startsWith(`${ROUGH_DIR}/`)) {
    return `${file} is in rough/, never the app's own code.`;
  }
  for (const item of ignore) {
    const folder = item.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
    if (folder && (normalized === folder || normalized.startsWith(`${folder}/`))) {
      return `${file} is in ${folder}/, which rough/environment.md ignores.`;
    }
  }
  return null;
}

/**
 * Where a promote of an iteration with a kept base writes, and whether the app moved since the
 * fork (B4's contract): the component's own files and each recorded child, each compared with its
 * `.base/` copy with line endings set aside. Throws in words when a file is gone from the app or
 * from the base, or cannot be written; nothing is written either way.
 */
export function planTargets(
  repoRoot: string,
  relative: string,
  base: BaseRecord,
  environment: Pick<RepoEnvironment, 'ignore' | 'entry'>
): { how: Exclude<PromoteHow, 'new'>; targets: PromoteTarget[] } {
  const label = relative.split('/').slice(1).join('/');
  const targets: PromoteTarget[] = [];
  for (const [file, child] of [
    ...base.files.map(item => [item, false] as const),
    ...base.children.map(item => [item, true] as const)
  ]) {
    if (targets.some(target => target.path === file.path)) continue;
    const problem = checkAppFile(file.path, environment.ignore);
    if (problem) throw new Error(`${label} cannot be promoted: ${problem}`);
    const now = readBytes(repoRoot, file.path);
    if (!now) {
      throw new Error(
        `${file.path} is no longer in the app, so ${label} cannot be written back to it. Fork again from the app's current version.`
      );
    }
    const kept = readBytes(repoRoot, `${relative}/${BASE_DIR}/${file.path}`);
    if (!kept) {
      throw new Error(
        `${relative}/${BASE_DIR}/${file.path} is missing, so the studio cannot tell whether the app changed since the fork. Fork again from the app's current version.`
      );
    }
    targets.push({
      path: file.path,
      // A radical fork has no copy of each file: the iteration's entry is what it made.
      copy: file.copy || (child ? null : environment.entry),
      child,
      drifted: !sameText(now, kept)
    });
  }
  return { how: targets.some(target => target.drifted) ? 'merge' : 'in-place', targets };
}

/** `{{roughbook:promote-files}}`: one "original ← copy" pair per line, by repository path. */
export function promoteFilesLines(relative: string, targets: PromoteTarget[]): string {
  return targets
    .map(target => `${target.path} ← ${target.copy ? `${relative}/${target.copy}` : relative}`)
    .join('\n');
}

/** The promote prompt's B4 stand-ins with this machine's paths. */
export function fillPromoteStandIns(
  prompt: string,
  relative: string,
  targets: PromoteTarget[],
  placeholders: { promoteFiles?: string; base?: string } = {}
): string {
  return prompt
    .replaceAll(placeholders.promoteFiles ?? PROMOTE_FILES_PLACEHOLDER, () =>
      promoteFilesLines(relative, targets)
    )
    .replaceAll(placeholders.base ?? '{{roughbook:base}}', () => `${relative}/${BASE_DIR}/`);
}

/** What the agent is told of ending a promote, after the backend's prompt. */
export function promoteFinishingSection(promotionId: string, how: PromoteHow): string {
  const conflict =
    how === 'merge'
      ? `If the two changes conflict and you cannot keep both, write no file and pass
each conflict to finish_run as conflicts, a few words each: the file, its lines
and what each side changed.
`
      : '';
  return `<finishing>
Roughbook promotion: ${assertRunId(promotionId)}
When the app's files are written, call the Roughbook MCP tool finish_run once
with promotion set to this id, and pass on what it says: the studio shows the
diff, runs the app's build and checks, and asks the designer about any commit.
${conflict}Without those tools, tell the designer you are done; they finish it with
roughbook done or in the Roughbook studio. Do not run the build, the checks or git.
</finishing>
`;
}

type GitResult = { code: number; stdout: string; stderr: string };

function git(repoRoot: string, args: string[]): Promise<GitResult> {
  return new Promise(resolve => {
    execFile(
      'git',
      args,
      { cwd: repoRoot, windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '')
        })
    );
  });
}

/** The branch HEAD is on, or null when it is detached or outside git. */
export async function currentBranch(repoRoot: string): Promise<string | null> {
  const found = await git(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return found.code === 0 ? found.stdout.trim() || null : null;
}

/** The commit HEAD names, or null. */
async function head(repoRoot: string): Promise<string | null> {
  const found = await git(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const commit = found.stdout.trim();
  return found.code === 0 && /^[0-9a-f]{7,64}$/.test(commit) ? commit : null;
}

/** The files among `files` git sees with uncommitted changes, staged, unstaged or untracked. */
export async function uncommittedAmong(repoRoot: string, files: string[]): Promise<string[]> {
  if (!files.length) return [];
  const status = await git(repoRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    ...files.map(file => `:(literal)${file}`)
  ]);
  if (status.code !== 0) return files;
  const prefix = (await git(repoRoot, ['rev-parse', '--show-prefix'])).stdout.trim();
  const entries = status.stdout.split('\0').filter(Boolean);
  const dirty: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const file = entry.slice(3);
    dirty.push(file.startsWith(prefix) ? file.slice(prefix.length) : file);
    if (entry[0] === 'R' || entry[0] === 'C') i++;
  }
  return dirty.sort();
}

/**
 * Before a promote on a branch (decision 18): the branch to create and where it starts, or a
 * refusal in words when the repo is not git, has no commit, a target has uncommitted changes, or
 * the name is not a branch's or is taken. Nothing is changed.
 */
export async function planBranch(
  repoRoot: string,
  name: string,
  targets: string[]
): Promise<{ name: string; from: string | null; commit: string }> {
  const inside = await git(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    throw new Error(
      'This repo is not a git repository, so the promote cannot go on a branch of its own. Promote without --branch.'
    );
  }
  const commit = await head(repoRoot);
  if (!commit) {
    throw new Error(
      'This repo has no commit yet, so there is nothing to start a branch from. Commit first, or promote without --branch.'
    );
  }
  const dirty = await uncommittedAmong(repoRoot, targets);
  if (dirty.length) {
    throw new Error(
      `${dirty.join(', ')} ${dirty.length === 1 ? 'has' : 'have'} uncommitted changes, which a commit of the promote would take along. Commit or stash ${dirty.length === 1 ? 'it' : 'them'} first, or promote without --branch.`
    );
  }
  const format = await git(repoRoot, ['check-ref-format', '--branch', name]);
  if (format.code !== 0) throw new Error(`${name} is not a name git takes for a branch.`);
  const taken = await git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
  if (taken.code === 0) {
    throw new Error(`A branch ${name} already exists. Name another with --branch <name>.`);
  }
  return { name, from: await currentBranch(repoRoot), commit };
}

/** Creates the planned branch at its commit and switches to it, keeping the working tree. */
export async function createBranch(repoRoot: string, name: string, commit: string): Promise<void> {
  let made = await git(repoRoot, ['switch', '--quiet', '-c', name, commit]);
  if (made.code !== 0) made = await git(repoRoot, ['checkout', '--quiet', '-b', name, commit]);
  if (made.code !== 0) {
    throw new Error(
      `The branch ${name} could not be created: ${made.stderr.trim() || 'git refused'}`
    );
  }
}

/** Runs one command line to its end, keeping its output: the environment's build or a check. */
export type CommandRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
  shell: Shell
) => Promise<{ code: number | null; output: string }>;

/** How many of a failing command's last lines are kept and shown. */
const TAIL_LINES = 20;

function tailOf(output: string): string[] {
  const lines = output.replace(/\r\n?/g, '\n').trimEnd().split('\n');
  return lines.slice(-TAIL_LINES).map(line => line.replace(/\s+$/, ''));
}

async function runOne(
  repoRoot: string,
  environment: Pick<RepoEnvironment, 'shell' | 'timeouts'>,
  command: string,
  approved: boolean,
  run: CommandRunner,
  clock: () => number
): Promise<CommandRun> {
  if (!approved) {
    return {
      command,
      result: 'skipped',
      code: null,
      seconds: 0,
      note: 'not approved on this machine: run roughbook doctor in a terminal and approve it',
      tail: []
    };
  }
  const limit = environment.timeouts.build;
  const started = clock();
  const done = await run(command, repoRoot, limit * 1000, environment.shell);
  const seconds = Math.round((clock() - started) / 100) / 10;
  if (done.code === 0) return { command, result: 'passed', code: 0, seconds, note: null, tail: [] };
  return {
    command,
    result: 'failed',
    code: done.code,
    seconds,
    note: done.code === null ? `did not finish within ${limit} s` : `exit ${done.code}`,
    tail: tailOf(done.output)
  };
}

/**
 * The environment's production build and its checks (decision 35), each within the build's
 * timeout, one after another; a command not approved on this machine is skipped and says so.
 */
export async function runAppChecks(
  repoRoot: string,
  environment: Pick<RepoEnvironment, 'build' | 'checks' | 'shell' | 'timeouts'>,
  run: CommandRunner = (command, cwd, timeoutMs, shell) =>
    queued(repoRoot, () => runCapture(command, cwd, timeoutMs, shell)),
  clock: () => number = Date.now
): Promise<{ build: CommandRun | null; checks: CommandRun[] }> {
  const approvals = await readApprovals(repoRoot);
  const ok = (command: string) => isApproved(approvals, command, environment.shell);
  const build = environment.build.command
    ? await runOne(
        repoRoot,
        environment,
        environment.build.command,
        ok(environment.build.command),
        run,
        clock
      )
    : null;
  const checks: CommandRun[] = [];
  for (const command of environment.checks) {
    checks.push(await runOne(repoRoot, environment, command, ok(command), run, clock));
  }
  return { build, checks };
}

/** The checks' result for `promotion.finished`: failed if one failed, passed if any ran. */
export function overall(runs: CommandRun[]): CheckResult {
  if (runs.some(run => run.result === 'failed')) return 'failed';
  return runs.some(run => run.result === 'passed') ? 'passed' : 'skipped';
}

export type FinishPromotionOptions = {
  /** Set when the agent could not do it, or the designer stopped it. */
  outcome?: 'failed';
  /** Where a merge's two changes conflict, from the agent's report (decision 37). */
  conflicts?: string[];
  /** Runs the build and the checks; this machine's shell by default, a stand-in in tests. */
  run?: CommandRunner;
  now?: Date;
  clock?: () => number;
};

/** An app file, as the promote's diff and scope see it: outside rough/ and the studio's state. */
function appFile(file: string): boolean {
  return file !== ROUGH_DIR && !file.startsWith(`${ROUGH_DIR}/`);
}

/**
 * Finishes a promote (B4's contract): the changed app files against its snapshot; in a merge the
 * agent reported conflicts for, every target put back, since a conflict writes nothing; else the
 * targets' line endings kept as the app had them, the out-of-scope files named, and the build and
 * checks run when a target changed. The outcome goes to the backend through the outbox, with
 * `promotion.finished`'s fields but `how`, which it has from the start: no path, no code. A
 * finished promote is returned as it is.
 */
export async function finishPromotion(
  repoRoot: string,
  api: StudioApi,
  outbox: Outbox,
  environment: RepoEnvironment,
  promotionId: string,
  options: FinishPromotionOptions = {}
): Promise<PromotionRecord> {
  const record = await readPromotion(repoRoot, promotionId);
  if (!record) throw new Error(`There is no promotion ${promotionId} in this repo.`);
  if (record.status === 'finished') return record;
  const now = options.now ?? new Date();
  const snapshot = await readSnapshot(repoRoot, promotionId);
  if (!snapshot) throw new Error(`The snapshot of promotion ${promotionId} is gone.`);

  // The localized copy file is where the prompt lands the approved copy (decision 34).
  const scope = new Set([
    ...record.targets.map(target => target.path),
    ...record.studioWrites,
    ...(environment.copy.kind === 'localized' ? [environment.copy.file] : [])
  ]);
  const changedNow = async () => {
    const after = await hashRepo(repoRoot, environment.ignore);
    const changes = compareFiles(snapshot.files, after.files);
    return [
      ...changes.added.map(file => ({ path: file, status: 'added' as const })),
      ...changes.changed.map(file => ({ path: file, status: 'changed' as const })),
      ...changes.removed.map(file => ({ path: file, status: 'removed' as const }))
    ]
      .filter(item => appFile(item.path))
      .map(item => ({ ...item, inScope: scope.has(item.path) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  };

  let changed = await changedNow();
  const targetPaths = new Set(record.targets.map(target => target.path));
  const wroteTarget = () => changed.some(item => targetPaths.has(item.path));
  const conflicts = (options.conflicts ?? []).map(item => item.trim()).filter(Boolean);
  // A merge that wrote nothing is one the agent could not resolve (decision 37).
  const conflict =
    options.outcome !== 'failed' &&
    record.how === 'merge' &&
    (conflicts.length > 0 || !wroteTarget());

  const putBackOnConflict: string[] = [];
  const lineEndings: string[] = [];
  if (conflict) {
    for (const item of changed.filter(entry => targetPaths.has(entry.path))) {
      const result = await revertFile(repoRoot, promotionId, item.path);
      if (result === 'restored' || result === 'removed') putBackOnConflict.push(item.path);
    }
    if (putBackOnConflict.length) changed = await changedNow();
  } else {
    // A write back keeps the app file's own line endings (decision 39).
    for (const item of changed.filter(
      entry => entry.status === 'changed' && targetPaths.has(entry.path)
    )) {
      const before = await snapshotContent(repoRoot, promotionId, item.path, snapshot);
      const after = readBytes(repoRoot, item.path);
      if (!before || !after || before.includes(0) || after.includes(0)) continue;
      const text = after.toString('utf8');
      const kept = inLineEndingsOf(text, before.toString('utf8'));
      if (kept !== text) {
        fs.writeFileSync(toDisk(repoRoot, item.path), kept);
        lineEndings.push(item.path);
      }
    }
    if (lineEndings.length) changed = await changedNow();
  }
  const outOfScope = changed.filter(item => !item.inScope).map(item => item.path);

  const ran =
    !conflict && options.outcome !== 'failed' && wroteTarget()
      ? await runAppChecks(repoRoot, environment, options.run, options.clock)
      : { build: null, checks: [] };
  const buildResult: CheckResult = ran.build?.result ?? 'skipped';
  const checksResult = overall(ran.checks);
  const outcome: PromotionOutcome = conflict
    ? 'conflict'
    : options.outcome === 'failed' || !wroteTarget()
      ? 'failed'
      : outOfScope.length
        ? 'out-of-scope'
        : buildResult === 'failed' || checksResult === 'failed'
          ? 'failed'
          : 'done';

  let reported: PromotionResult['reported'];
  try {
    const sent = await outbox.send(
      api,
      `/orgs/${record.orgId}/projects/${record.project}/promotions/${record.promotionId}/finish`,
      // The backend knows `how` from the promote's start and refuses any other field.
      {
        outcome,
        build: buildResult,
        checks: checksResult,
        branch: record.branch !== null
      }
    );
    reported = sent.status;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    reported = null;
  }

  const committable =
    record.branch !== null && outcome !== 'conflict' && changed.some(item => item.inScope);
  return updatePromotion(repoRoot, promotionId, current => ({
    ...current,
    status: 'finished',
    finishedAt: now.toISOString(),
    result: {
      outcome,
      changed,
      outOfScope,
      conflicts,
      putBackOnConflict,
      lineEndings,
      build: ran.build,
      checks: ran.checks,
      buildResult,
      checksResult,
      reported
    },
    commit: committable
      ? {
          state: 'pending',
          sha: null,
          files: changed.filter(item => item.inScope).map(item => item.path)
        }
      : null
  }));
}

/** One changed file's diff against the snapshot, for the CLI and the local UI's diff view. */
export type FileDiff = {
  path: string;
  status: ChangedFile['status'];
  inScope: boolean;
  /** Null when the file is not text, or the snapshot kept no copy of what it was. */
  hunks: DiffHunk[] | null;
  /** Why there are no hunks, in words. */
  note: string | null;
};

/** The diff of every app file the promote changed, as it is now, against its snapshot. */
export async function promotionDiff(
  repoRoot: string,
  record: PromotionRecord
): Promise<FileDiff[]> {
  const snapshot = await readSnapshot(repoRoot, record.promotionId);
  const diffs: FileDiff[] = [];
  for (const item of record.result?.changed ?? []) {
    const before =
      item.status === 'added'
        ? Buffer.alloc(0)
        : await snapshotContent(repoRoot, record.promotionId, item.path, snapshot);
    const after = item.status === 'removed' ? Buffer.alloc(0) : readBytes(repoRoot, item.path);
    const base = { path: item.path, status: item.status, inScope: item.inScope };
    if (!before || !after) {
      diffs.push({ ...base, hunks: null, note: 'The studio kept no copy of it to compare.' });
    } else if (before.includes(0) || after.includes(0)) {
      diffs.push({ ...base, hunks: null, note: 'Not a text file.' });
    } else {
      diffs.push({
        ...base,
        hunks: lineDiff(before.toString('utf8'), after.toString('utf8')),
        note: null
      });
    }
  }
  return diffs;
}

/**
 * On the designer's yes, commits the promote's files on its branch (decision 18): only those it
 * changed in scope, with a message naming the iteration; never on another branch, never pushed.
 */
export async function commitPromotion(
  repoRoot: string,
  promotionId: string
): Promise<PromotionRecord> {
  const record = await readPromotion(repoRoot, promotionId);
  if (!record) throw new Error(`There is no promotion ${promotionId} in this repo.`);
  if (!record.branch || !record.commit) {
    throw new Error(
      'This promote was not put on a branch of its own, so the studio commits nothing.'
    );
  }
  if (record.commit.state === 'committed') return record;
  const on = await currentBranch(repoRoot);
  if (on !== record.branch.name) {
    throw new Error(
      `The repo is on ${on ?? 'a detached HEAD'}, not ${record.branch.name}, and the studio commits only on the promote's own branch. Switch back to it first.`
    );
  }
  const files = record.commit.files;
  const pathspecs = files.map(file => `:(literal)${file}`);
  const added = await git(repoRoot, ['add', '--all', '--', ...pathspecs]);
  if (added.code !== 0) throw new Error(`git add refused: ${added.stderr.trim()}`);
  const label = `${record.page}/${record.component}/${record.iteration}`;
  const message =
    record.subject === 'page'
      ? `Promote the ${record.page} page's ${record.iteration} from Roughbook\n\nIts sections arranged ${record.how === 'merge' ? 'as a merge with the page’s changes since it was saved' : 'in place'}${record.targets.some(target => target.section) ? ', with its new sections’ files' : ''}.`
      : `Promote ${label} from Roughbook\n\nWritten back into the app ${record.how === 'merge' ? 'as a merge with its changes since the fork' : 'in place'}.`;
  const made = await git(repoRoot, ['commit', '--quiet', '-m', message, '--', ...pathspecs]);
  if (made.code !== 0) {
    throw new Error(`git commit refused: ${(made.stderr || made.stdout).trim()}`);
  }
  const sha = await head(repoRoot);
  return updatePromotion(repoRoot, promotionId, current => ({
    ...current,
    commit: { state: 'committed', sha, files }
  }));
}

/** On the designer's no: the change stays uncommitted on the branch. */
export async function declinePromotionCommit(
  repoRoot: string,
  promotionId: string
): Promise<PromotionRecord> {
  return updatePromotion(repoRoot, promotionId, current =>
    current.commit && current.commit.state === 'pending'
      ? { ...current, commit: { ...current.commit, state: 'declined' } }
      : current
  );
}

/**
 * Puts back one app file a finished promote changed, from its snapshot, and keeps on the record
 * that it is back.
 */
export async function putBackPromoted(
  repoRoot: string,
  record: PromotionRecord,
  file: string
): Promise<Revert> {
  if (!record.result?.changed.some(item => item.path === file)) {
    throw new Error(
      `${file} is not among the files the promote of ${record.page}/${record.component}/${record.iteration} changed.`
    );
  }
  const result = await revertFile(repoRoot, record.promotionId, file);
  if (result !== 'cannot') {
    await updatePromotion(repoRoot, record.promotionId, current => ({
      ...current,
      putBack: [...new Set([...(current.putBack ?? []), file])].sort()
    }));
  }
  return result;
}

/** A command's result in words, with how long it took. */
export function describeRun(kind: string, run: CommandRun): string {
  if (run.result === 'skipped') return `${kind} (${run.command}): skipped, ${run.note}.`;
  if (run.result === 'passed') return `${kind} (${run.command}): passed in ${run.seconds} s.`;
  return `${kind} (${run.command}): failed, ${run.note}, after ${run.seconds} s.`;
}

/** What the finish found, as lines for a terminal or an agent, the diff aside. */
export function describePromotion(record: PromotionRecord): string[] {
  const result = record.result;
  if (!result) return [];
  const label = `${record.page}/${record.component}/${record.iteration}`;
  const lines: string[] = [];
  const page = record.subject === 'page';
  const how =
    record.how === 'merge'
      ? page
        ? 'as a merge with the page’s changes since the composition was saved'
        : 'as a merge with the app’s changes since the fork'
      : record.how === 'in-place'
        ? 'in place'
        : 'as a new file';
  if (result.outcome === 'conflict') {
    lines.push(`${label}: the merge conflicts, so nothing was written to the app.`);
    for (const where of result.conflicts) lines.push(`  Conflict: ${where}`);
    if (!result.conflicts.length) {
      lines.push('  The agent wrote nothing; where the changes conflict is in its report.');
    }
    for (const file of result.putBackOnConflict) {
      lines.push(`  Put back ${file}, which the agent had written anyway.`);
    }
    lines.push(
      page
        ? '  Resolve it in the page, or save a new composition of the page as it is now, then promote that.'
        : '  Resolve it in the app, or fork again from the app’s current version, then promote that.'
    );
    return lines;
  }
  const inScope = result.changed.filter(item => item.inScope);
  lines.push(
    result.outcome === 'failed' && !inScope.length
      ? `${label}: nothing was written to the app.`
      : `${label}: ${page ? 'arranged' : 'written back'} ${how}, ${inScope.length} file${inScope.length === 1 ? '' : 's'} changed.`
  );
  for (const item of inScope)
    lines.push(
      `  ${item.status === 'added' ? '+' : item.status === 'removed' ? '-' : '~'} ${item.path}`
    );
  for (const file of result.lineEndings) lines.push(`  Kept ${file}'s own line endings.`);
  if (result.outOfScope.length) {
    lines.push(
      page
        ? `  Changed outside the page's files and its new sections', which it must leave alone (decision 50); put each back with roughbook revert:`
        : `  Changed outside the promote's files, which it must leave alone (decision 36); put each back with roughbook revert:`
    );
    for (const file of result.outOfScope) lines.push(`    roughbook revert ${label} ${file}`);
  }
  if (result.build) lines.push(`  ${describeRun('The build', result.build)}`);
  else if (inScope.length) lines.push('  The build: skipped, rough/environment.md names none.');
  for (const check of result.checks) lines.push(`  ${describeRun('Check', check)}`);
  for (const failed of [result.build, ...result.checks].filter(
    (run): run is CommandRun => run !== null && run.result === 'failed' && run.tail.length > 0
  )) {
    lines.push(`  Last lines of ${failed.command}:`);
    for (const line of failed.tail) lines.push(`    ${line}`);
  }
  if (result.reported === 'queued') {
    lines.push('  The result waits in the outbox and goes to the server when it can be reached.');
  }
  return lines;
}

/** The iteration folder a promote reads, for messages. */
export function promotedFolder(
  record: Pick<PromotionRecord, 'page' | 'component' | 'iteration'>
): string {
  return iterationDir(record.page, record.component, record.iteration);
}
