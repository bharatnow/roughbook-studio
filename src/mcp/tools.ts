// The four tools an agent calls: list_runs, get_prompt, get_checks and finish_run. They read and
// write local files only, and finish_run reports through the same client and outbox as
// `roughbook done`, so nothing here sends more than the CLI does.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outboxFor } from '../api/outbox.js';
import { finishWithScreenshots } from '../commands/done.js';
import { requireApi, type CommandContext } from '../commands/context.js';
import { requireRepoLink } from '../repo/link.js';
import { findRepoRoot } from '../repo/root.js';
import { assessRun } from '../runs/lifecycle.js';
import { finishingSection } from '../runs/slots.js';
import { listRuns, namesRun } from '../runs/store.js';
import type { Check, RunRecord } from '../runs/types.js';
import type { Tool, ToolCall } from './server.js';

export const INSTRUCTIONS = `Roughbook design iterations, made in the designer's own repo. The designer starts a run with roughbook run or the Roughbook studio; each run has a prompt file under rough/ and one folder to write in. list_runs shows the open runs. get_prompt gives a run's instructions: follow them, writing only inside the run's folder. get_checks says what the iteration must pass and whether it passes now. finish_run finishes the run once it is ready. When the server cannot tell which repo you have open, pass repo: its absolute path.`;

const REPO = {
  type: 'string',
  description:
    'The absolute path of the repo you have open, the one with rough/roughbook.json. Only needed when the server cannot tell.'
};
const RUN = {
  type: 'string',
  description:
    "The run's id from list_runs, its iteration as <page>/<component>/iteration-NN, or its folder or prompt file. Optional when only one run is open."
};

type Found = { repoRoot: string; run: RunRecord };

function text(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value.trim();
}

function strings(value: unknown, name: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`${name} must be a list of paths.`);
  }
  return value.map(item => item.trim()).filter(Boolean);
}

/** A folder an agent named: a path, or a file URI, or VS Code's /c:/… form on Windows. */
function folderFrom(value: string, context: CommandContext): string {
  if (value.startsWith('file:')) return fileURLToPath(value);
  if (context.platform === 'win32' && /^\/[A-Za-z]:[\\/]/.test(value)) value = value.slice(1);
  return path.resolve(context.cwd, value);
}

/**
 * The Roughbook repos to look in: the one named, else those holding the client's open folders,
 * else the one the server was started in.
 */
async function reposFor(
  context: CommandContext,
  named: string | undefined,
  call: ToolCall
): Promise<string[]> {
  if (named) {
    const repoRoot = findRepoRoot(folderFrom(named, context));
    if (!repoRoot) {
      throw new Error(
        `${named} is not in a Roughbook repo: no rough/roughbook.json in it or above it. Run roughbook init there first.`
      );
    }
    return [repoRoot];
  }
  const found = new Set<string>();
  for (const folder of await call.roots()) {
    const repoRoot = findRepoRoot(folder);
    if (repoRoot) found.add(repoRoot);
  }
  if (!found.size && context.repoRoot) found.add(context.repoRoot);
  if (!found.size) {
    throw new Error(
      'No Roughbook repo was found here. Pass repo: the absolute path of the folder you have open, the one with rough/roughbook.json.'
    );
  }
  return [...found];
}

function label(run: RunRecord): string {
  return `${run.page}/${run.component}/${run.iteration}`;
}

async function runsIn(repos: string[]): Promise<Found[]> {
  const lists = await Promise.all(
    repos.map(async repoRoot => (await listRuns(repoRoot)).map(run => ({ repoRoot, run })))
  );
  return lists.flat();
}

/** One run: the one named, open runs first, or the only open one. */
async function findRun(repos: string[], name: string | undefined): Promise<Found> {
  const all = await runsIn(repos);
  const open = all.filter(item => item.run.status === 'started');
  if (!name) {
    if (open.length === 1) return open[0]!;
    if (!open.length) {
      throw new Error(
        'No run is open. The designer starts one with roughbook run or the Roughbook studio.'
      );
    }
    throw new Error(
      `${open.length} runs are open; name one with run: ${open.map(item => `${item.run.runId} (${label(item.run)})`).join(', ')}.`
    );
  }
  for (const pool of [open, all]) {
    const matches = pool.filter(item => namesRun(item.run, name));
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new Error(`${name} matches ${matches.length} runs; name one by its run id.`);
    }
  }
  throw new Error(`No run matches ${name}. list_runs shows the open ones.`);
}

/** The direction a new iteration was asked for, as its prompt names it. */
function direction(repoRoot: string, run: RunRecord): string | null {
  try {
    const prompt = fs.readFileSync(path.join(repoRoot, ...run.promptFile.split('/')), 'utf8');
    return /^Direction: (.+)$/m.exec(prompt)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** A check in words, as the agent should read it. */
export function describeCheck(check: Check, run: RunRecord): string {
  switch (check.kind) {
    case 'entry-file':
      return `${check.file} exists in ${run.targetFolder}, is not empty, and is no longer the placeholder.`;
    case 'approved-headline':
      return `The approved headline (Version ${check.version}) appears in the source: "${check.headline}"`;
    case 'changed-from-parent':
      return `The iteration differs from ${check.parent}, and its source no longer names ${check.parent} as itself.`;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function refuseUnattended(run: RunRecord): void {
  if (run.mode === 'headless') {
    throw new Error(
      `${label(run)} is an unattended run: the studio finishes it when its agent exits.`
    );
  }
}

export function studioTools(context: CommandContext, options: { devUrl: string }): Tool[] {
  const listRunsTool: Tool = {
    name: 'list_runs',
    title: 'List open Roughbook runs',
    description:
      'Lists the Roughbook runs waiting for an agent in this repo: each one is a design iteration to make, with its prompt file and the one folder it may write.',
    inputSchema: { type: 'object', properties: { repo: REPO }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async call(args, call) {
      const repos = await reposFor(context, text(args.repo, 'repo'), call);
      const open = (await runsIn(repos)).filter(item => item.run.status === 'started');
      return json({
        runs: open.map(({ repoRoot, run }) => ({
          run: run.runId,
          iteration: label(run),
          kind: run.kind,
          direction: run.kind === 'generate' ? direction(repoRoot, run) : null,
          parent: run.parent,
          agent: run.agent,
          mode: run.mode,
          prompt: run.promptFile,
          folder: run.targetFolder,
          startedAt: run.startedAt,
          repo: repoRoot
        })),
        next: open.length
          ? 'Read a run with get_prompt and follow it. Check it with get_checks, then finish it with finish_run.'
          : 'No run is open. The designer starts one with roughbook run or the Roughbook studio.'
      });
    }
  };

  const getPrompt: Tool = {
    name: 'get_prompt',
    title: "Read a Roughbook run's prompt",
    description:
      "Returns a run's instructions: the brief, the design system, the direction and the rules. Follow them, writing only inside the run's folder.",
    inputSchema: {
      type: 'object',
      properties: { run: RUN, repo: REPO },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async call(args, call) {
      const repos = await reposFor(context, text(args.repo, 'repo'), call);
      const { repoRoot, run } = await findRun(repos, text(args.run, 'run'));
      const prompt = fs.readFileSync(path.join(repoRoot, ...run.promptFile.split('/')), 'utf8');
      // Prompts written before the studio added its finishing section still say how to end.
      if (run.mode === 'headless' || prompt.includes('<finishing>')) return prompt;
      return `${prompt.trimEnd()}\n\n${finishingSection(run.runId)}`;
    }
  };

  const getChecks: Tool = {
    name: 'get_checks',
    title: 'Check a Roughbook iteration',
    description:
      "Says what a run's iteration must pass and checks it now, without finishing the run: its entry file, the approved headline, changes from its parent, files changed outside its folder, and app files importing from rough/. Fix what fails, then call finish_run.",
    inputSchema: {
      type: 'object',
      properties: { run: RUN, repo: REPO },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async call(args, call) {
      const repos = await reposFor(context, text(args.repo, 'repo'), call);
      const { repoRoot, run } = await findRun(repos, text(args.run, 'run'));
      // A finished run is what Done found; checking again would count later changes against it.
      const now =
        run.status === 'finished'
          ? run
          : await assessRun(repoRoot, await requireRepoLink(repoRoot), run);
      const passes = !now.failure && !now.warnings.length;
      return json({
        run: run.runId,
        iteration: label(run),
        folder: run.targetFolder,
        status: run.status,
        checks: [
          ...run.checks.map(check => describeCheck(check, run)),
          `Nothing outside ${run.targetFolder}/ changes.`,
          'No file outside rough/ imports from rough/.'
        ],
        now: {
          passes,
          failure: now.failure?.message ?? null,
          warnings: now.warnings.map(item => item.message),
          changedOutsideFolder: now.outOfScope
        },
        next:
          run.status === 'finished'
            ? 'This run is already finished; this is what Done found.'
            : passes
              ? 'Everything passes. Call finish_run when the iteration is ready.'
              : [
                  now.failure || now.warnings.some(item => item.code !== 'OUT_OF_SCOPE_WRITE')
                    ? `Fix what fails inside ${run.targetFolder}, then call get_checks again or finish_run.`
                    : '',
                  now.outOfScope.length
                    ? `Files changed outside ${run.targetFolder} count against the run: put back any you changed; if the designer says the rest were their own work, pass them to finish_run as mine ("." for all); otherwise call finish_run anyway and name them, and the designer decides at review.`
                    : ''
                ]
                  .filter(Boolean)
                  .join(' ')
      });
    }
  };

  const finishRun: Tool = {
    name: 'finish_run',
    title: 'Finish a Roughbook run',
    description:
      "Finishes a run once its iteration is ready, as the designer's Done does: checks the iteration, flags files changed outside its folder, takes desktop and phone screenshots through the app's dev server, and reports the result to Roughbook (codes and counts, never code). Call it once, after get_checks. Pass outcome only when the iteration was not made.",
    inputSchema: {
      type: 'object',
      properties: {
        run: RUN,
        outcome: {
          type: 'string',
          enum: ['failed', 'cancelled'],
          description:
            'Only when the iteration was not made: failed when you could not make it, cancelled when the designer stopped the run.'
        },
        mine: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Files or folders changed outside the run\'s folder that the designer told you were their own work, so they are not counted against the run; "." for all of them. Never the files you wrote.'
        },
        repo: REPO
      },
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    async call(args, call) {
      const outcome = text(args.outcome, 'outcome');
      if (outcome !== undefined && outcome !== 'failed' && outcome !== 'cancelled') {
        throw new Error('outcome is failed or cancelled, or left out when the iteration is ready.');
      }
      const mine = strings(args.mine, 'mine');
      const repos = await reposFor(context, text(args.repo, 'repo'), call);
      const { repoRoot, run } = await findRun(repos, text(args.run, 'run'));
      refuseUnattended(run);
      const wasFinished = run.status === 'finished';
      let finished = run;
      let shots = null;
      if (!wasFinished) {
        const scoped = { ...context, repoRoot };
        const api = await requireApi(scoped);
        const link = await requireRepoLink(repoRoot);
        call.progress('Checking the iteration and taking screenshots');
        ({ run: finished, shots } = await finishWithScreenshots(
          scoped,
          api,
          outboxFor(repoRoot),
          link,
          run.runId,
          { outcome, mine, devUrl: options.devUrl, screenshots: true, by: 'agent' }
        ));
      }
      const tell: string[] = [];
      if (finished.outOfScope.length) {
        tell.push(
          `Files changed outside the iteration: the designer can put each back with roughbook revert ${label(finished)} <file>.`
        );
      }
      if (shots?.warning) tell.push(shots.warning);
      if (finished.reported === 'queued') {
        tell.push('The result waits in the outbox and reaches Roughbook when it can be reached.');
      }
      return json({
        run: finished.runId,
        iteration: label(finished),
        alreadyFinished: wasFinished,
        outcome: finished.outcome,
        failure: finished.failure?.message ?? null,
        warnings: finished.warnings.map(item => item.message),
        changedOutsideFolder: finished.outOfScope,
        mine: finished.mine ?? [],
        finishedBy: finished.finishedBy ?? null,
        screenshots: shots ? Object.values(shots.files) : [],
        reported: finished.reported,
        next: [
          `Tell the designer ${label(finished)} is finished${finished.warnings.length ? ', with the warnings above' : ''}; they review it in the Roughbook studio.`,
          ...tell
        ].join(' ')
      });
    }
  };

  return [listRunsTool, getPrompt, getChecks, finishRun];
}
