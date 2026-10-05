// A local run from start to finish: the backend allocates the iteration and compiles the prompt;
// the studio snapshots the repo, writes the slot and the prompt file, and hands the one-line
// instruction to the agent. At Done it applies the backend's checks and its own, compares the
// snapshot, and reports codes and counts through the outbox.
import type { StudioApi } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import type { Outbox } from '../api/outbox.js';
import type { RepoLink } from '../repo/link.js';
import {
  REGISTRY_FILE,
  iterationDir,
  previewRouteDir,
  writePreviewRegistry
} from '../repo/preview.js';
import { ROUGH_DIR } from '../repo/root.js';
import { checkIteration, importsFromRough } from './checks.js';
import { createSlot, iterationExists, promptFile, writePrompt, assertTarget } from './slots.js';
import { allChanged, compareFiles, hashRepo, readSnapshot, takeSnapshot } from './snapshot.js';
import { listRuns, readRun, saveRun } from './store.js';
import type { Finding, RunOutcome, RunRecord, StartRunRequest } from './types.js';

/** Token counts a headless agent reported, sent with its result. */
export type RunUsage = {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
};

/** The files a run may write: its folder, its prompt, and the registry the studio regenerates. */
export function inScope(
  file: string,
  runs: Pick<RunRecord, 'targetFolder' | 'promptFile'>[]
): boolean {
  if (file === `${ROUGH_DIR}/${REGISTRY_FILE}`) return true;
  return runs.some(run => file.startsWith(`${run.targetFolder}/`) || file === run.promptFile);
}

/** Whether two runs were going at the same time, so each may write the other's folder. */
function overlapped(a: RunRecord, b: RunRecord, now: Date): boolean {
  const end = (run: RunRecord) => run.finishedAt ?? now.toISOString();
  return a.startedAt <= end(b) && b.startedAt <= end(a);
}

export async function startRuns(
  repoRoot: string,
  api: StudioApi,
  link: RepoLink,
  request: StartRunRequest,
  now: () => Date = () => new Date()
): Promise<RunRecord[]> {
  assertTarget(request.page, request.component, 'iteration-01');
  if (request.kind !== 'generate') {
    assertTarget(request.page, request.component, request.parent);
    if (!iterationExists(repoRoot, request.page, request.component, request.parent)) {
      throw new Error(
        `${iterationDir(request.page, request.component, request.parent)} is not in this repo, so it cannot be ${request.kind === 'fork' ? 'forked' : 'refined'} here.`
      );
    }
  }
  const started = await api.startRuns(link.orgId, link.project, request);
  for (const run of started) {
    assertTarget(request.page, request.component, run.iteration);
    // The folder is the studio's to decide; one the server names elsewhere is refused.
    if (run.targetFolder !== iterationDir(request.page, request.component, run.iteration)) {
      throw new Error(
        `The server asked to write ${run.targetFolder}, which is not an iteration folder.`
      );
    }
  }

  // Before the slots, so writing them counts as the runs' own change.
  await takeSnapshot(
    repoRoot,
    started.map(run => run.runId)
  );
  const records: RunRecord[] = [];
  for (const run of started) {
    const record: RunRecord = {
      runId: run.runId,
      orgId: link.orgId,
      project: link.project,
      page: request.page,
      component: request.component,
      iteration: run.iteration,
      parent: run.parent,
      kind: request.kind,
      agent: request.agent,
      mode: request.mode,
      targetFolder: run.targetFolder,
      promptFile: promptFile(request.page, request.component, run.runId),
      checks: run.checks,
      startedAt: now().toISOString(),
      status: 'started',
      finishedAt: null,
      outcome: null,
      failure: null,
      warnings: [],
      outOfScope: [],
      reported: null
    };
    createSlot(repoRoot, record);
    writePrompt(repoRoot, record.promptFile, run.prompt);
    await saveRun(repoRoot, record);
    records.push(record);
  }
  writePreviewRegistry(repoRoot);
  return records;
}

export type FinishOptions = {
  /** Set when the run did not finish on its own: the agent failed, or the designer stopped it. */
  outcome?: Extract<RunOutcome, 'failed' | 'cancelled'>;
  usage?: RunUsage | null;
  now?: Date;
};

export async function finishRun(
  repoRoot: string,
  api: StudioApi,
  outbox: Outbox,
  link: RepoLink,
  runId: string,
  options: FinishOptions = {}
): Promise<RunRecord> {
  const run = await readRun(repoRoot, runId);
  if (!run) throw new Error(`There is no run ${runId} in this repo.`);
  if (run.status === 'finished') return run;
  const now = options.now ?? new Date();

  const checked = checkIteration(repoRoot, run);
  const after = await hashRepo(repoRoot);
  const snapshot = await readSnapshot(repoRoot, runId);
  const others = (await listRuns(repoRoot)).filter(
    other => other.runId !== run.runId && overlapped(other, run, now)
  );
  const outOfScope = snapshot
    ? allChanged(compareFiles(snapshot.files, after.files)).filter(
        file => !inScope(file, [run, ...others])
      )
    : [];
  const offenders = importsFromRough(
    repoRoot,
    Object.keys(after.files),
    link.appDir ? previewRouteDir(link.appDir) : null
  );

  const warnings: Finding[] = [...checked.warnings];
  if (outOfScope.length) {
    warnings.push({
      code: 'OUT_OF_SCOPE_WRITE',
      message: `${outOfScope.length} file${outOfScope.length === 1 ? '' : 's'} changed outside ${run.targetFolder}: ${outOfScope.slice(0, 5).join(', ')}${outOfScope.length > 5 ? ', …' : ''}`
    });
  }
  if (offenders.length) {
    warnings.push({
      code: 'IMPORTS_FROM_ROUGH',
      message: `${offenders.join(', ')} import${offenders.length === 1 ? 's' : ''} from ${ROUGH_DIR}/. The app must never depend on a design reference.`
    });
  }
  const outcome: RunOutcome =
    options.outcome ??
    (checked.failure ? 'failed' : warnings.length ? 'completed_with_warnings' : 'completed');
  const codes = [
    ...new Set([
      ...(checked.failure ? [checked.failure.code] : []),
      ...warnings.map(item => item.code)
    ])
  ];

  let reported: RunRecord['reported'];
  try {
    const sent = await outbox.send(api, `/orgs/${run.orgId}/runs/${run.runId}/finish`, {
      outcome,
      durationMs: Math.max(0, now.getTime() - Date.parse(run.startedAt)),
      warnings: codes,
      outOfScopeWrites: outOfScope.length,
      usage: options.usage ?? null
    });
    reported = sent.status;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    reported = null;
  }

  const finished: RunRecord = {
    ...run,
    status: 'finished',
    finishedAt: now.toISOString(),
    outcome,
    failure: checked.failure,
    warnings,
    outOfScope,
    reported
  };
  await saveRun(repoRoot, finished);
  writePreviewRegistry(repoRoot);
  return finished;
}
