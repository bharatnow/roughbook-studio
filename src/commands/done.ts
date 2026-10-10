import { parseArgs } from 'node:util';
import type { StudioApi } from '../api/client.js';
import type { Outbox } from '../api/outbox.js';
import { outboxFor } from '../api/outbox.js';
import { requireRepoLink, type RepoLink } from '../repo/link.js';
import { assessRun, finishRun, type FinishOptions } from '../runs/lifecycle.js';
import type { Shots } from '../screenshot/iteration.js';
import { listRuns, namesRun } from '../runs/store.js';
import type { RunRecord } from '../runs/types.js';
import { confirm } from '../io.js';
import { requireApi, type Command, type CommandContext } from './context.js';

/** Where the app's dev server runs when nothing says otherwise. */
export const DEFAULT_DEV_URL = 'http://localhost:3000';

export function devUrl(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const url = (flag ?? env.ROUGHBOOK_DEV_URL ?? DEFAULT_DEV_URL).replace(/\/+$/, '');
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{2,5})?$/.test(url)) {
    throw new Error(`The dev server must be on this machine, such as ${DEFAULT_DEV_URL}.`);
  }
  return url;
}

export type CompleteOptions = FinishOptions & { devUrl: string; screenshots: boolean };

/** Finishes one run and, when it made something to look at, takes its screenshots. */
export async function finishWithScreenshots(
  context: CommandContext,
  api: StudioApi,
  outbox: Outbox,
  link: RepoLink,
  runId: string,
  options: CompleteOptions
): Promise<{ run: RunRecord; shots: Shots | null }> {
  const repoRoot = context.repoRoot!;
  const run = await finishRun(repoRoot, api, outbox, link, runId, options);
  if (!options.screenshots || run.failure || run.outcome === 'cancelled')
    return { run, shots: null };
  const shots = await context.screenshot(
    repoRoot,
    options.devUrl,
    { page: run.page, component: run.component, iteration: run.iteration },
    context.env
  );
  return { run, shots };
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
  const { run: finished, shots } = await finishWithScreenshots(
    context,
    api,
    outbox,
    link,
    run.runId,
    options
  );
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
  if (shots) {
    const files = Object.values(shots.files);
    if (files.length) io.out(`  Screenshots: ${files.join(', ')}`);
    if (shots.warning) io.out(`  ${shots.warning}`);
  }
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
  const { io } = context;
  const { outOfScope } = await assessRun(context.repoRoot!, link, run);
  if (!outOfScope.length) return [];
  io.out(
    `${outOfScope.length} file${outOfScope.length === 1 ? '' : 's'} changed outside ${run.targetFolder} since the run started:`
  );
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
    'done [<run or iteration>] [--all] [--failed | --cancelled] [--mine <path>]... [--dev-url <url>]',
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
        'no-screenshots': { type: 'boolean', default: false }
      }
    });
    if (values.failed && values.cancelled) throw new Error('Choose --failed or --cancelled.');
    const repoRoot = context.repoRoot!;
    const open = (await listRuns(repoRoot)).filter(run => run.status === 'started');
    if (!open.length) {
      io.out('No run is open in this repo.');
      return 0;
    }

    let runs: RunRecord[];
    if (positionals[0]) {
      runs = open.filter(run => namesRun(run, positionals[0]!));
      if (!runs.length) throw new Error(`No open run matches ${positionals[0]}.`);
      if (runs.length > 1) {
        throw new Error(
          `${positionals[0]} matches ${runs.length} open runs; name one by its page and component.`
        );
      }
    } else if (values.all || open.length === 1) {
      runs = open;
    } else {
      io.out('Several runs are open:');
      for (const run of open) {
        io.out(`  ${run.page}/${run.component}/${run.iteration}  (${run.agent}, ${run.runId})`);
      }
      throw new Error('Name one, or pass --all to finish them all.');
    }

    const api = await requireApi(context);
    const link = await requireRepoLink(repoRoot);
    const outbox = outboxFor(repoRoot);
    const url = devUrl(values['dev-url'], context.env);
    let failed = false;
    for (const run of runs) {
      const mine = values.mine?.length ? values.mine : await askWhoseChanges(context, link, run);
      const finished = await completeRun(context, api, outbox, link, run, {
        outcome: values.failed ? 'failed' : values.cancelled ? 'cancelled' : undefined,
        devUrl: url,
        screenshots: !values['no-screenshots'],
        mine
      });
      // A run the designer marked failed is not the command failing.
      failed ||= finished.outcome === 'failed' && !values.failed;
    }
    return failed ? 1 : 0;
  }
};
