// A local run from start to finish: the backend allocates the iteration and compiles the prompt;
// the studio snapshots the repo, writes the slot and the prompt file, and hands the one-line
// instruction to the agent. At Done it applies the backend's checks and its own, compares the
// snapshot, and reports codes and counts through the outbox.
import type { StudioApi } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import type { Outbox } from '../api/outbox.js';
import { localOrigin } from '../config/settings.js';
import {
  fillEnvironment,
  hasEnvironmentFile,
  previewUrl,
  readEnvironment
} from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { recipeOf } from '../recipes/index.js';
import type { Recipe } from '../recipes/types.js';
import { iterationDir } from '../repo/iterations.js';
import { cleanStack, type RepoLink } from '../repo/link.js';
import { syncIterations } from '../repo/mirror.js';
import { ROUGH_DIR } from '../repo/root.js';
import { copyAssets } from './assets.js';
import {
  fillAppStandIns,
  fromTheApp,
  headCommit,
  planAppSlot,
  readBase,
  recordChildren
} from './base.js';
import { checkIteration, importsFromRough } from './checks.js';
import {
  assertTarget,
  createSlot,
  finishingSection,
  genericPlaceholder,
  iterationExists,
  promptFile,
  writePrompt
} from './slots.js';
import {
  allChanged,
  compareFiles,
  hashRepo,
  readSnapshot,
  revertFile,
  takeSnapshot,
  type Revert
} from './snapshot.js';
import { listRuns, readRun, saveRun, updateRun } from './store.js';
import type {
  FinishedBy,
  Finding,
  RunOutcome,
  RunRecord,
  StartRunRequest,
  StartedRun
} from './types.js';

/** Token counts a headless agent reported, sent with its result. */
export type RunUsage = {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
};

/** The files a run may write: its folder, its prompt, and what the studio itself regenerates. */
export function inScope(
  file: string,
  runs: Pick<RunRecord, 'targetFolder' | 'promptFile'>[],
  generated: string[] = []
): boolean {
  if (generated.includes(file)) return true;
  return runs.some(run => file.startsWith(`${run.targetFolder}/`) || file === run.promptFile);
}

/**
 * The repo's environment and the recipe that goes with it, for one run's steps; no recipe when the
 * setup run's agent built the preview, and then the environment alone says what is needed.
 */
async function repoSetup(
  repoRoot: string,
  link: RepoLink
): Promise<{ environment: RepoEnvironment; recipe: Recipe | null }> {
  const environment = await readEnvironment(repoRoot, link);
  return { environment, recipe: recipeOf(environment) };
}

/** Whether two runs were going at the same time, so each may write the other's folder. */
function overlapped(a: RunRecord, b: RunRecord, now: Date): boolean {
  const end = (run: RunRecord) => run.finishedAt ?? now.toISOString();
  return a.startedAt <= end(b) && b.startedAt <= end(a);
}

/** The stand-in the backend writes where the asset files' origin belongs. */
export const ASSET_ORIGIN_PLACEHOLDER = '{{roughbook:asset-origin}}';

export type StartOptions = {
  /** The local server's address, where iterations load the project's asset files. */
  assetOrigin?: string;
  /** The app's dev server, so the prompt can say where the iteration renders. */
  devUrl?: string;
  now?: () => Date;
  /**
   * Writes what the runs read but do not write, once the backend has allocated them and before
   * the repo is snapshotted, so it counts as neither run's change: a ported sketch's reference.
   */
  beforeSlots?: (started: StartedRun[]) => void;
};

export async function startRuns(
  repoRoot: string,
  api: StudioApi,
  link: RepoLink,
  request: StartRunRequest,
  options: StartOptions = {}
): Promise<RunRecord[]> {
  const now = options.now ?? (() => new Date());
  const assetOrigin = options.assetOrigin ?? localOrigin({ localPort: null });
  assertTarget(request.page, request.component, 'iteration-01');
  if (request.kind === 'fork' || request.kind === 'refine') {
    assertTarget(request.page, request.component, request.parent);
    if (!iterationExists(repoRoot, request.page, request.component, request.parent)) {
      throw new Error(
        `${iterationDir(request.page, request.component, request.parent)} is not in this repo, so it cannot be ${request.kind === 'fork' ? 'forked' : 'refined'} here.`
      );
    }
  }
  // A port's parent is a web sketch, which is never in the repo: its files are a reference only.
  if (request.kind === 'pull') assertTarget(request.page, request.component, request.sketch);
  const { environment, recipe } = await repoSetup(repoRoot, link);
  // A fork or refine of the app's own component starts from a copy of its real files (B3): one
  // that cannot be made here is refused before the backend allocates anything.
  const fromApp = (request.kind === 'fork' || request.kind === 'refine') && fromTheApp(request);
  if (fromApp) {
    planAppSlot(repoRoot, recipe, environment, { ...request, iteration: 'iteration-01' });
  }
  const commit = fromApp ? await headCommit(repoRoot) : null;
  const stack = cleanStack(environment.stack);
  // This studio takes screenshots (roughbook screenshot), so the prompt says when to look (D7).
  // The family and entry file choose the checks the backend sends (decision 23); the stack's
  // tokens stay with the iteration, so its ratings compare by stack (F7).
  const started = await api.startRuns(link.orgId, link.project, {
    ...request,
    ...(link.skills?.length ? { skills: link.skills } : {}),
    screenshots: true,
    family: environment.family,
    entry: environment.entry,
    ...(environment.assets.copy ? { assetsCopy: true } : {}),
    ...(stack.length ? { stack } : {})
  });
  for (const run of started) {
    assertTarget(request.page, request.component, run.iteration);
    // The folder is the studio's to decide; one the server names elsewhere is refused.
    if (run.targetFolder !== iterationDir(request.page, request.component, run.iteration)) {
      throw new Error(
        `The server asked to write ${run.targetFolder}, which is not an iteration folder.`
      );
    }
  }

  options.beforeSlots?.(started);
  // Before the slots, so writing them counts as the runs' own change.
  await takeSnapshot(
    repoRoot,
    started.map(run => run.runId),
    environment.ignore
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
    // A port starts from the placeholder like a new direction: its parent is the sketch, which
    // is not one of the repo's iterations to copy.
    createSlot(
      repoRoot,
      request.kind === 'pull' ? { ...record, parent: null } : record,
      {
        file: environment.entry,
        content: recipe
          ? recipe.placeholder(
              environment.entry,
              `${request.page}/${request.component}/${run.iteration}`
            )
          : genericPlaceholder(),
        ...(recipe?.retarget ? { retarget: recipe.retarget.bind(recipe) } : {})
      },
      fromApp && fromTheApp(record)
        ? { ...planAppSlot(repoRoot, recipe, environment, record), commit }
        : undefined
    );
    const standIn = run.placeholders?.assetOrigin ?? ASSET_ORIGIN_PLACEHOLDER;
    let prompt = fillEnvironment(
      run.prompt.replaceAll(standIn, () => assetOrigin),
      environment,
      run.placeholders ?? {},
      { hasEnvironmentFile: hasEnvironmentFile(repoRoot) }
    );
    // The component's files and its kept base, which only this machine knows, as promote's paths.
    const base = fromTheApp(record) ? readBase(repoRoot, record.targetFolder) : null;
    if (base) prompt = fillAppStandIns(prompt, base, record.targetFolder, run.placeholders);
    // A stack whose previews load nothing over the network gets the asset files in its folder.
    if (environment.assets.copy) {
      await copyAssets(repoRoot, api, link, record.targetFolder, prompt);
    }
    // A standalone preview is the studio's, behind its token, and a snapshot preview has no
    // address: the agent is sent to neither.
    const preview =
      options.devUrl && environment.mode === 'live'
        ? previewUrl(options.devUrl, request.page, request.component, run.iteration, environment)
        : null;
    writePrompt(
      repoRoot,
      record.promptFile,
      request.mode === 'headless'
        ? prompt
        : `${prompt.trimEnd()}\n\n${finishingSection(run.runId, preview)}`
    );
    await saveRun(repoRoot, record);
    records.push(record);
  }
  syncIterations(repoRoot, environment);
  return records;
}

/** Whether `file` is one the designer said was their own: `.` for every file, a file, or a folder. */
export function isMine(file: string, mine: string[]): boolean {
  return mine.some(entry => {
    const own = entry.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    return own === '.' || own === file || file.startsWith(`${own}/`);
  });
}

/**
 * What Done finds in a run's iteration: the backend's checks, the studio's own, the files changed
 * outside the run's folder, and those among them the designer said were their own.
 */
export type Assessment = {
  failure: Finding | null;
  warnings: Finding[];
  outOfScope: string[];
  mine: string[];
};

/**
 * The checks Done applies, without finishing anything: the backend's checks on the iteration,
 * files changed outside the run's folder since it started (less those the designer claims with
 * `mine`), and imports from rough/.
 */
export async function assessRun(
  repoRoot: string,
  link: RepoLink,
  run: RunRecord,
  now: Date = new Date(),
  mine: string[] = []
): Promise<Assessment> {
  const { environment, recipe } = await repoSetup(repoRoot, link);
  const checked = checkIteration(repoRoot, run, environment.sources);
  const after = await hashRepo(repoRoot, environment.ignore);
  const snapshot = await readSnapshot(repoRoot, run.runId);
  const others = (await listRuns(repoRoot)).filter(
    other => other.runId !== run.runId && overlapped(other, run, now)
  );
  const changed = snapshot
    ? allChanged(compareFiles(snapshot.files, after.files)).filter(
        file => !inScope(file, [run, ...others], recipe?.generatedFiles ?? [])
      )
    : [];
  const claimed = changed.filter(file => isMine(file, mine));
  const outOfScope = changed.filter(file => !isMine(file, mine));
  const offenders = importsFromRough(
    repoRoot,
    Object.keys(after.files),
    recipe?.importAllowed(link) ?? [],
    environment.code
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
  return { failure: checked.failure, warnings, outOfScope, mine: claimed };
}

export type FinishOptions = {
  /** Set when the run did not finish on its own: the agent failed, or the designer stopped it. */
  outcome?: Extract<RunOutcome, 'failed' | 'cancelled'>;
  usage?: RunUsage | null;
  /** Files or folders changed outside the run's folder that were the designer's own work. */
  mine?: string[];
  /** Who is finishing it, kept on the record. */
  by?: FinishedBy;
  /**
   * For a fork or refine of the app's own component: the app's files the agent says it copied in
   * to change them, by repository path (decision 32). Those it copied without a word are found too.
   */
  copied?: string[];
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

  const { failure, warnings, outOfScope, mine } = await assessRun(
    repoRoot,
    link,
    run,
    now,
    options.mine ?? []
  );
  const outcome: RunOutcome =
    options.outcome ??
    (failure ? 'failed' : warnings.length ? 'completed_with_warnings' : 'completed');
  const codes = [
    ...new Set([...(failure ? [failure.code] : []), ...warnings.map(item => item.code)])
  ];
  // The child components it copied in, kept in .base/ for B4; nothing of them is sent.
  let children: string[] | undefined;
  if (fromTheApp(run) && outcome !== 'cancelled') {
    await recordChildren(repoRoot, run, options.copied ?? []);
    children = readBase(repoRoot, run.targetFolder)?.children.map(child => child.path);
  }

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
    failure,
    warnings,
    outOfScope,
    mine,
    finishedBy: options.by,
    reported,
    ...(children?.length ? { children } : {})
  };
  await saveRun(repoRoot, finished);
  syncIterations(repoRoot, (await repoSetup(repoRoot, link)).environment);
  return finished;
}

/**
 * Puts back one file a finished run changed outside its folder, and keeps on the run that it is
 * back, so neither the CLI nor the local UI offers it again. A file the studio kept no copy of
 * stays unmarked: putting it back is still the designer's to do.
 */
export async function putBack(repoRoot: string, run: RunRecord, file: string): Promise<Revert> {
  const result = await revertFile(repoRoot, run.runId, file);
  if (result !== 'cannot') {
    await updateRun(repoRoot, run.runId, current => ({
      ...current,
      putBack: [...new Set([...(current.putBack ?? []), file])].sort()
    }));
  }
  return result;
}
