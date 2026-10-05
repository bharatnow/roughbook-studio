import { parseArgs } from 'node:util';
import { manualCommand, planTerminal, sessionTitle, type Session } from '../launch/terminal.js';
import { requireRepoLink } from '../repo/link.js';
import { findComponent, iterationToPromote, preparePromotion } from '../runs/promote.js';
import { handoffLine } from '../runs/slots.js';
import { requireApi, type Command } from './context.js';
import { chooseAgent, parseComponent } from './shared.js';

export const promote: Command = {
  name: 'promote',
  summary: 'Hand the selected iteration to your agent to write the real component',
  usage:
    'promote <page>/<component> [--iteration <id>] [--to <file>] [--public <folder>] [--agent <id>]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        iteration: { type: 'string' },
        to: { type: 'string' },
        public: { type: 'string' },
        agent: { type: 'string' },
        model: { type: 'string' }
      }
    });
    const { page, component } = parseComponent(positionals[0]);
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const api = await requireApi(context);
    const tree = await api.project(link.orgId, link.project);
    const record = findComponent(tree, page, component);
    const iteration = iterationToPromote(record, values.iteration);

    const prepared = await preparePromotion(repoRoot, api, link, tree, {
      page,
      component,
      iteration,
      targetFile: values.to,
      publicDir: values.public
    });
    io.out(`Promoting ${page}/${component}/${iteration} to ${prepared.targetFile}.`);
    for (const file of prepared.copied) io.out(`  Copied ${file}`);
    if (prepared.wroteCopy)
      io.out(`  Wrote the approved copy to rough/${page}/${component}/copy.md`);
    for (const asset of prepared.missing) {
      io.out(`  ! ${asset.file} is not in the ${asset.scope}; the prompt asks for a placeholder.`);
    }
    io.out(`  Prompt: ${prepared.promptFile}`);

    const instruction = handoffLine(prepared.promptFile);
    let session: Session | null = null;
    try {
      const { adapter, detection } = await chooseAgent(context, values.agent);
      const title = sessionTitle(`Promote ${record.name}`);
      session = {
        title,
        command: detection.executable!.command,
        args: [
          ...detection.executable!.prefixArgs,
          ...adapter.interactiveArgs({
            repoRoot,
            targetFolder: `rough/${page}/${component}`,
            promptFile: prepared.promptFile,
            instruction,
            sessionId: prepared.promotionId,
            model: values.model ?? null,
            title
          })
        ]
      };
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
        io.out(`Opened ${plan.terminal}. Review the diff when it is done; nothing is committed.`);
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
