import { parseArgs } from 'node:util';
import type { StudioApi } from '../api/client.js';
import type { Outbox } from '../api/outbox.js';
import { outboxFor } from '../api/outbox.js';
import { defaultEnvironment, previewUrl, readEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { requireRepoLink, type RepoLink } from '../repo/link.js';
import { withPreviews } from '../standalone/server.js';
import { assessRun, finishRun, type FinishOptions } from '../runs/lifecycle.js';
import { queued } from '../runs/queue.js';
import type { Shots } from '../screenshot/iteration.js';
import { picturesAfterShots } from '../pictures/share.js';
import { listRuns, namesRun } from '../runs/store.js';
import type { RunRecord } from '../runs/types.js';
import { confirm } from '../io.js';
import { unifiedText } from '../repo/diff.js';
import {
  changedOutside,
  commitPromotion,
  declinePromotionCommit,
  describePromotion,
  listPromotions,
  namesPromotion,
  promotionDiff,
  type PromotionRecord
} from '../runs/promotion.js';
import { requireApi, type Command, type CommandContext } from './context.js';
import { finishPromotionHere, type PromotionFinishOptions } from './finishPromotion.js';

/**
 * Where the app's dev server runs: the flag, then ROUGHBOOK_DEV_URL, then the repo's environment
 * (its recipe's default until the environment file says).
 */
export function devUrl(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  fallback: string = defaultEnvironment().start.url
): string {
  const url = (flag ?? env.ROUGHBOOK_DEV_URL ?? fallback).replace(/\/+$/, '');
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{2,5})?$/.test(url)) {
    throw new Error(`The dev server must be on this machine, such as ${fallback}.`);
  }
  return url;
}

export type CompleteOptions = FinishOptions & {
  devUrl: string;
  screenshots: boolean;
  /**
   * The environment as previews are asked through it, when the caller serves them (the local UI's
   * standalone site, its token in the preview path). Otherwise it is read here, and standalone
   * previews get a server of their own for the screenshots.
   */
  environment?: RepoEnvironment;
};

/**
 * Finishes one run; warms its preview, so a dev server that compiles on first request has it
 * ready before the designer looks (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Speed"); and, when it made
 * something to look at, takes its screenshots, one run at a time through the repo's queue.
 */
export async function finishWithScreenshots(
  context: CommandContext,
  api: StudioApi,
  outbox: Outbox,
  link: RepoLink,
  runId: string,
  options: CompleteOptions
): Promise<{ run: RunRecord; shots: Shots | null; pictures?: string | null }> {
  const repoRoot = context.repoRoot!;
  const run = await finishRun(repoRoot, api, outbox, link, runId, options);
  if (run.failure || run.outcome === 'cancelled' || run.outcome === 'failed') {
    return { run, shots: null };
  }
  const read = options.environment ?? (await readEnvironment(repoRoot, link));
  // A standalone server started only for this would be gone before anyone looked.
  if (!options.screenshots && !options.environment && read.mode === 'standalone') {
    return { run, shots: null };
  }
  const target = { page: run.page, component: run.component, iteration: run.iteration };
  const shoot = async (url: string, environment: RepoEnvironment) => {
    // Snapshot mode serves nothing to warm: its images are rendered as its screenshots are.
    const answer =
      environment.mode === 'snapshot'
        ? undefined
        : await context.askPreview(
            previewUrl(url, target.page, target.component, target.iteration, environment),
            environment.timeouts.preview * 1000
          );
    if (!options.screenshots) return null;
    return queued(repoRoot, async () => {
      const taken = await context.screenshot(
        repoRoot,
        url,
        target,
        context.env,
        undefined,
        undefined,
        undefined,
        environment,
        { answer }
      );
      // Its pictures go up as soon as its screenshots are taken (decisions 21 and 23).
      pictures = await picturesAfterShots(
        context,
        { repoRoot, api, outbox, link, environment },
        target,
        previewUrl(url, target.page, target.component, target.iteration, environment),
        taken
      ).catch(() => null);
      return taken;
    });
  };
  let pictures: string | null = null;
  const shots = options.environment
    ? await shoot(options.devUrl, read)
    : await withPreviews(repoRoot, read, options.devUrl, shoot);
  return { run, shots, pictures };
}

/** Finishes one run, takes its screenshots, and says how it went. */
export async function completeRun(
  context: CommandContext,
  api: StudioApi,
  outbox: Outbox,
  link: RepoLink,
  run: RunRecord,
  options: CompleteOptions
): Promise<RunRecord> {
  const { io } = context;
  const {
    run: finished,
    shots,
    pictures
  } = await finishWithScreenshots(context, api, outbox, link, run.runId, options);
  const label = `${finished.page}/${finished.component}/${finished.iteration}`;
  // The warnings are counted beside it, so completed_with_warnings reads as completed.
  const outcome = (finished.outcome ?? 'completed').replace('_with_warnings', '');
  const count = finished.warnings.length;
  io.out(`${label}: ${outcome}${count ? `, ${count} warning${count === 1 ? '' : 's'}` : ''}`);
  if (finished.failure) io.out(`  x ${finished.failure.message}`);
  for (const warning of finished.warnings) io.out(`  ! ${warning.message}`);
  if (finished.outOfScope.length) {
    io.out('  Changed outside the iteration; put each back with roughbook revert:');
    for (const file of finished.outOfScope) {
      io.out(`    roughbook revert ${label} ${file}`);
    }
  }
  if (finished.mine?.length) {
    const count = finished.mine.length;
    io.out(
      `  ${count} file${count === 1 ? '' : 's'} changed outside the iteration ${count === 1 ? 'was' : 'were'} yours, not counted.`
    );
  }
  if (finished.children?.length) {
    io.out(
      `  Copied in from the app to change, kept in its .base/ for the promote: ${finished.children.join(', ')}`
    );
  }
  if (shots) {
    const files = Object.values(shots.files);
    if (files.length) io.out(`  Screenshots: ${files.join(', ')}`);
    if (shots.warning) io.out(`  ${shots.warning}`);
  }
  if (pictures) io.out(`  ${pictures}`);
  if (finished.reported === 'queued') {
    io.out('  The result waits in the outbox and goes to the server when it can be reached.');
  }
  return finished;
}

/** How many of the changed files are shown before the question. */
const SHOWN = 12;

/**
 * Shows what changed outside the run's folder since it started and asks whether that was the
 * designer's own work, so it is not counted against the run. With nobody to answer, it counts.
 */
async function askWhoseChanges(
  context: CommandContext,
  link: RepoLink,
  run: RunRecord
): Promise<string[]> {
  const { outOfScope } = await assessRun(context.repoRoot!, link, run);
  return askWhose(context, outOfScope, `outside ${run.targetFolder} since the run started`);
}

/** The same for a promote: its changes outside its own files, before it is finished. */
async function askWhosePromoteChanges(
  context: CommandContext,
  link: RepoLink,
  record: PromotionRecord
): Promise<string[]> {
  const environment = await readEnvironment(context.repoRoot!, link);
  const outside = await changedOutside(context.repoRoot!, environment, record);
  return askWhose(context, outside, "outside the promote's files since it started");
}

/** Lists `files`, changed `where`, and asks whether they were the designer's: `.` for yes. */
async function askWhose(
  context: CommandContext,
  files: string[],
  where: string
): Promise<string[]> {
  const { io } = context;
  const outOfScope = files;
  if (!outOfScope.length) return [];
  io.out(`${outOfScope.length} file${outOfScope.length === 1 ? '' : 's'} changed ${where}:`);
  for (const file of outOfScope.slice(0, SHOWN)) io.out(`  ${file}`);
  if (outOfScope.length > SHOWN) io.out(`  ... and ${outOfScope.length - SHOWN} more`);
  const theirs = await confirm(
    io,
    "Were these changes yours, not the agent's? (To name some, pass --mine <path>.)",
    false
  );
  return theirs ? ['.'] : [];
}

export const done: Command = {
  name: 'done',
  summary: 'Finish a run: check its iteration, take screenshots, report it',
  usage:
    'done [<run, promote or iteration>] [--all] [--failed | --cancelled] [--mine <path>]... [--conflict <where>]... [--commit | --no-commit] [--dev-url <url>]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        all: { type: 'boolean', default: false },
        failed: { type: 'boolean', default: false },
        cancelled: { type: 'boolean', default: false },
        'dev-url': { type: 'string' },
        mine: { type: 'string', multiple: true },
        'no-screenshots': { type: 'boolean', default: false },
        conflict: { type: 'string', multiple: true },
        commit: { type: 'boolean' },
        'no-commit': { type: 'boolean', default: false }
      }
    });
    if (values.failed && values.cancelled) throw new Error('Choose --failed or --cancelled.');
    if (values.commit && values['no-commit']) throw new Error('Choose --commit or --no-commit.');
    const repoRoot = context.repoRoot!;
    const open = (await listRuns(repoRoot)).filter(run => run.status === 'started');
    const promotions = await listPromotions(repoRoot);
    const openPromotions = promotions.filter(record => record.status === 'started');
    // A finished promote's commit, decided later: roughbook done <promote> --commit.
    const name = positionals[0];
    if (name && (values.commit || values['no-commit'])) {
      const waiting = promotions.find(
        record =>
          record.status === 'finished' &&
          record.commit !== null &&
          record.commit.state !== 'committed' &&
          namesPromotion(record, name)
      );
      if (waiting) return (await decideCommit(context, waiting, values.commit === true)) ? 0 : 1;
    }
    if (!open.length && !openPromotions.length) {
      io.out('No run is open in this repo.');
      return 0;
    }

    let runs: RunRecord[];
    let promotes: PromotionRecord[];
    if (name) {
      runs = open.filter(run => namesRun(run, name));
      promotes = openPromotions.filter(record => namesPromotion(record, name));
      const count = runs.length + promotes.length;
      if (!count) throw new Error(`No open run or promote matches ${name}.`);
      if (count > 1) {
        throw new Error(`${name} matches ${count} open runs; name one by its page and component.`);
      }
    } else if (values.all || open.length + openPromotions.length === 1) {
      runs = open;
      promotes = openPromotions;
    } else {
      io.out('Several runs are open:');
      for (const run of open) {
        io.out(`  ${run.page}/${run.component}/${run.iteration}  (${run.agent}, ${run.runId})`);
      }
      for (const record of openPromotions) {
        io.out(
          `  ${record.page}/${record.component}/${record.iteration}  (promote, ${record.promotionId})`
        );
      }
      throw new Error('Name one, or pass --all to finish them all.');
    }

    const api = await requireApi(context);
    const link = await requireRepoLink(repoRoot);
    const outbox = outboxFor(repoRoot);
    const url = devUrl(
      values['dev-url'],
      context.env,
      (await readEnvironment(repoRoot, link)).start.url
    );
    let failed = false;
    for (const run of runs) {
      const mine = values.mine?.length ? values.mine : await askWhoseChanges(context, link, run);
      const finished = await completeRun(context, api, outbox, link, run, {
        outcome: values.failed ? 'failed' : values.cancelled ? 'cancelled' : undefined,
        devUrl: url,
        screenshots: !values['no-screenshots'],
        mine,
        by: 'done'
      });
      // A run the designer marked failed is not the command failing.
      failed ||= finished.outcome === 'failed' && !values.failed;
    }
    for (const record of promotes) {
      const mine = values.mine?.length
        ? values.mine
        : await askWhosePromoteChanges(context, link, record);
      const finished = await completePromotion(context, api, outbox, link, record, {
        outcome: values.failed || values.cancelled ? 'failed' : undefined,
        conflicts: values.conflict ?? [],
        mine,
        devUrl: url,
        refresh: !values['no-screenshots'],
        commit: values.commit === true ? true : values['no-commit'] ? false : undefined
      });
      const outcome = finished.result?.outcome;
      failed ||= (outcome === 'failed' && !values.failed) || outcome === 'conflict';
    }
    return failed ? 1 : 0;
  }
};

/**
 * Finishes one promote and shows what it did: the outcome, the diff of every app file it changed,
 * the scope check, the build's and the checks' results and the refreshed baseline; then, on a
 * branch, asks whether to commit (`commit` answers for the designer).
 */
export async function completePromotion(
  context: CommandContext,
  api: StudioApi,
  outbox: Outbox,
  link: RepoLink,
  record: PromotionRecord,
  options: PromotionFinishOptions & { commit?: boolean }
): Promise<PromotionRecord> {
  const { io } = context;
  const { record: finished, refreshed } = await finishPromotionHere(
    context,
    api,
    outbox,
    link,
    record.promotionId,
    options
  );
  for (const diff of await promotionDiff(context.repoRoot!, finished)) {
    io.out(diff.hunks ? unifiedText(diff.path, diff.hunks) : `${diff.path}: ${diff.note}`);
  }
  for (const line of describePromotion(finished)) io.out(line);
  for (const line of refreshed) io.out(`  ${line}`);
  if (finished.commit?.state === 'pending') {
    const outcome = finished.result?.outcome;
    // --commit, given before the outcome was known, commits a done promote only.
    if (options.commit === true && outcome !== 'done') {
      io.out(
        `  Left uncommitted on ${finished.branch!.name}: the promote is ${outcome}, and --commit commits a done one only. To commit it all the same, run roughbook done ${finished.page}/${finished.component}/${finished.iteration} --commit.`
      );
    } else await decideCommit(context, finished, options.commit);
  }
  return finished;
}

/**
 * The designer's yes or no to committing a promote on its branch (decision 18); asked when not
 * given, and no without an answer. Never pushed. False when the commit was refused.
 */
async function decideCommit(
  context: CommandContext,
  record: PromotionRecord,
  answer?: boolean
): Promise<boolean> {
  const { io } = context;
  const branch = record.branch!.name;
  const files = record.commit?.files ?? [];
  const yes =
    answer ??
    (await confirm(
      io,
      `Commit the promote's ${files.length} file${files.length === 1 ? '' : 's'} on ${branch}? Nothing is pushed.`,
      false
    ));
  const label = `${record.page}/${record.component}/${record.iteration}`;
  if (!yes) {
    await declinePromotionCommit(context.repoRoot!, record.promotionId);
    io.out(
      `  Left uncommitted on ${branch}: ${files.join(', ')}. Commit them yourself, or run roughbook done ${label} --commit.`
    );
    return true;
  }
  try {
    const committed = await commitPromotion(context.repoRoot!, record.promotionId);
    io.out(
      `  Committed ${files.length} file${files.length === 1 ? '' : 's'} on ${branch} as ${committed.commit?.sha?.slice(0, 7) ?? 'a new commit'}. Nothing was pushed${record.branch!.from ? `; ${record.branch!.from} is as it was` : ''}.`
    );
    return true;
  } catch (error) {
    io.err((error as Error).message);
    return false;
  }
}
