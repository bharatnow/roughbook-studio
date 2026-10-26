import { parseArgs } from 'node:util';
import type { Detection, TerminalAdapter } from '../agents/types.js';
import { manualCommand, planTerminal, sessionTitle, type Session } from '../launch/terminal.js';
import { describePageStart, preparePagePromotion } from '../compositions/promote.js';
import { COMPOSITIONS_DIR } from '../compositions/store.js';
import { readMap } from '../map/file.js';
import { SLUG } from '../repo/iterations.js';
import { requireRepoLink } from '../repo/link.js';
import {
  findComponent,
  iterationToPromote,
  preparePromotion,
  type PreparedPromotion
} from '../runs/promote.js';
import { handoffLine } from '../runs/slots.js';
import { requireApi, type Command } from './context.js';
import { chooseAgent, openInEditor, parseComponent, sayEditorLaunch } from './shared.js';

/** The agent's session that writes the real component from the promote prompt. */
export function promoteSession(
  adapter: TerminalAdapter,
  detection: Detection,
  repoRoot: string,
  target: { page: string; component: string; componentName: string },
  prepared: Pick<PreparedPromotion, 'promptFile' | 'promotionId'>,
  model: string | null
): Session {
  const title = sessionTitle(`Promote ${target.componentName}`);
  return {
    title,
    command: detection.executable!.command,
    args: [
      ...detection.executable!.prefixArgs,
      ...adapter.interactiveArgs({
        repoRoot,
        targetFolder: `rough/${target.page}/${target.component}`,
        promptFile: prepared.promptFile,
        instruction: handoffLine(prepared.promptFile),
        sessionId: prepared.promotionId,
        model,
        title
      })
    ]
  };
}

/**
 * `--branch` with or without a name (decision 18), which parseArgs cannot take: `--branch=<name>`,
 * or `--branch <name>` when another word is left for the component; the other arguments as given.
 */
export function branchArgument(args: string[]): { branch?: string | true; rest: string[] } {
  const rest: string[] = [];
  let branch: string | true | undefined;
  let named = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--branch=')) {
      branch = arg.slice('--branch='.length) || true;
    } else if (arg === '--branch') {
      branch = true;
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        branch = next;
        named = true;
        i++;
      }
    } else {
      rest.push(arg);
    }
  }
  // `promote --branch home/hero`: the word was the component, and the branch takes its default.
  if (named && typeof branch === 'string') {
    const valued = new Set([
      '--iteration',
      '--to',
      '--public',
      '--agent',
      '--model',
      '--composition'
    ]);
    const positional = rest.filter(
      (arg, index) => !arg.startsWith('-') && !valued.has(rest[index - 1] ?? '')
    );
    if (!positional.length) {
      rest.unshift(branch);
      branch = true;
    }
  }
  return { ...(branch !== undefined ? { branch } : {}), rest };
}

/** What the start found, as the terminal says it: where the change goes, how, and on what branch. */
export function describeStart(label: string, prepared: PreparedPromotion): string[] {
  const lines: string[] = [];
  if (prepared.how === 'new') {
    lines.push(`Promoting ${label} to ${prepared.targetFile}.`);
  } else {
    lines.push(
      prepared.how === 'merge'
        ? `Promoting ${label} into the app's own files as a merge: the app changed since the fork, so the agent keeps both changes, or writes nothing and says where they conflict.`
        : `Promoting ${label} into the app's own files, in place: none changed since the fork.`
    );
    for (const target of prepared.targets) {
      lines.push(
        `  ${target.path}${target.child ? ' (a child it copied in)' : ''}${target.drifted ? ': changed in the app since the fork' : ''}`
      );
    }
  }
  if (prepared.branch) {
    lines.push(
      `  On a new branch, ${prepared.branch.name}, from ${prepared.branch.from ?? 'the current commit'}; the studio commits there only on your yes, and never pushes.`
    );
  }
  return lines;
}

export const promote: Command = {
  name: 'promote',
  summary: 'Hand the selected iteration to your agent to write the real component',
  usage:
    'promote <page>/<component> [--iteration <id>] [--to <file>] [--branch [<name>]] [--public <folder>] [--agent <id>] | promote <page> --composition composition-NN [--branch [<name>]] [--agent <id>]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { branch, rest } = branchArgument(args);
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        iteration: { type: 'string' },
        to: { type: 'string' },
        public: { type: 'string' },
        agent: { type: 'string' },
        model: { type: 'string' },
        composition: { type: 'string' }
      }
    });
    const repoRoot = context.repoRoot!;
    let target: { page: string; component: string; componentName: string };
    let prepared: Pick<PreparedPromotion, 'promptFile' | 'promotionId'>;
    if (values.composition !== undefined) {
      // A page's composition (B6): its page's files and its new sections' files, nothing else.
      const page = (positionals[0] ?? '').replace(/\/+$/, '');
      if (!SLUG.test(page)) {
        throw new Error(
          'Name the page by its slug: roughbook promote home --composition composition-02.'
        );
      }
      if (values.iteration !== undefined || values.to !== undefined) {
        throw new Error(
          "A composition's promote writes the page's own files and its new sections' files: it takes no --iteration or --to."
        );
      }
      const link = await requireRepoLink(repoRoot);
      const api = await requireApi(context);
      const tree = await api.project(link.orgId, link.project);
      const started = await preparePagePromotion(repoRoot, api, link, tree, {
        page,
        composition: values.composition,
        publicDir: values.public,
        ...(branch !== undefined ? { branch } : {})
      });
      const names = new Map(
        (readMap(repoRoot)?.map.components ?? []).map(item => [item.slug, item.name])
      );
      for (const line of describePageStart(
        started,
        page,
        values.composition,
        slug => names.get(slug) ?? slug
      )) {
        io.out(line);
      }
      for (const file of started.copied) io.out(`  Copied ${file}`);
      for (const asset of started.missing) {
        io.out(
          `  ! ${asset.file} is not in the ${asset.scope}; the prompt asks for a placeholder.`
        );
      }
      io.out(`  Prompt: ${started.promptFile}`);
      prepared = started;
      target = {
        page,
        component: `${COMPOSITIONS_DIR}/${values.composition}`,
        componentName: `${page} ${values.composition}`
      };
    } else {
      const { page, component } = parseComponent(positionals[0]);
      const link = await requireRepoLink(repoRoot);
      const api = await requireApi(context);
      const tree = await api.project(link.orgId, link.project);
      const record = findComponent(tree, page, component);
      const iteration = iterationToPromote(record, values.iteration);

      const made = await preparePromotion(repoRoot, api, link, tree, {
        page,
        component,
        iteration,
        targetFile: values.to,
        publicDir: values.public,
        ...(branch !== undefined ? { branch } : {})
      });
      for (const line of describeStart(`${page}/${component}/${iteration}`, made)) io.out(line);
      for (const file of made.copied) io.out(`  Copied ${file}`);
      if (made.wroteCopy) io.out(`  Wrote the approved copy to rough/${page}/${component}/copy.md`);
      if (made.copyFile) {
        io.out(
          `  This repo keeps copy in ${made.copyFile} (rough/environment.md, copy: localized): the agent lands the approved copy there.`
        );
      }
      for (const asset of made.missing) {
        io.out(
          `  ! ${asset.file} is not in the ${asset.scope}; the prompt asks for a placeholder.`
        );
      }
      io.out(`  Prompt: ${made.promptFile}`);
      prepared = made;
      target = { page, component, componentName: record.name };
    }

    const instruction = handoffLine(prepared.promptFile);
    let session: Session | null = null;
    try {
      const { adapter, detection } = await chooseAgent(context, values.agent);
      if (adapter.kind === 'editor') {
        const prompts = [prepared.promptFile];
        sayEditorLaunch(
          io,
          await openInEditor(context, adapter, detection, repoRoot, prompts),
          prompts
        );
        io.out(
          "When it is done, finish it with roughbook done: the studio shows the diff and runs the app's checks."
        );
        return 0;
      }
      session = promoteSession(
        adapter,
        detection,
        repoRoot,
        target,
        prepared,
        values.model ?? null
      );
    } catch (error) {
      io.err((error as Error).message);
    }
    if (!session) {
      io.out(`Give your agent this instruction in the repo: ${instruction}`);
      return 0;
    }

    const plan = planTerminal({
      platform: context.platform,
      env: context.env,
      repoRoot,
      sessions: [session]
    });
    if (plan.kind !== 'manual') {
      try {
        await context.launchTerminal(plan);
        io.out(
          `Opened ${plan.terminal}. When it is done, finish it with roughbook done: the studio shows the diff and runs the app's checks.`
        );
        return 0;
      } catch (error) {
        io.err(`${plan.terminal} could not be opened: ${(error as Error).message}`);
      }
    } else {
      io.out(plan.reason);
    }
    io.out(`Run this in a terminal: ${manualCommand(context.platform, repoRoot, session)}`);
    return 0;
  }
};
