import { parseArgs } from 'node:util';
import { runTarget, terminalSessions } from '../agents/session.js';
import type { AgentAdapter, Detection } from '../agents/types.js';
import type { StudioApi } from '../api/client.js';
import { outboxFor, type Outbox } from '../api/outbox.js';
import { manualCommand, planTerminal } from '../launch/terminal.js';
import { localOrigin, readSettings } from '../config/settings.js';
import { requireRepoLink, type RepoLink } from '../repo/link.js';
import { startRuns } from '../runs/lifecycle.js';
import type { RunRecord, StartRunRequest } from '../runs/types.js';
import { requireApi, type Command, type CommandContext } from './context.js';
import { completeRun, devUrl } from './done.js';
import { readEnvironment } from '../environment/read.js';
import { chooseAgent, openInEditor, parseComponent, sayEditorLaunch } from './shared.js';

/** What the designer asked for: new directions, a fork, or a refinement. */
function runKind(values: {
  direction?: string[];
  hypothesis?: string;
  fork?: string;
  refine?: string;
  intent?: string;
  preset?: string;
  preserve?: string;
}): Pick<StartRunRequest, 'kind'> & Record<string, unknown> {
  const asked = [values.direction?.length, values.fork, values.refine].filter(Boolean).length;
  if (asked !== 1) {
    throw new Error(
      'Say what to run: --direction "<idea>" (up to eight), --fork <iteration>, or --refine <iteration> --intent "<what to change>".'
    );
  }
  if (values.direction?.length) {
    if (values.direction.length > 8) throw new Error('At most eight directions at once.');
    return {
      kind: 'generate',
      directions: values.direction.map(direction => ({
        direction,
        ...(values.hypothesis ? { hypothesis: values.hypothesis } : {})
      }))
    };
  }
  if (values.fork) return { kind: 'fork', parent: values.fork };
  if (!values.intent) throw new Error('A refinement needs --intent "<what to change>".');
  return {
    kind: 'refine',
    parent: values.refine!,
    preset: values.preset ?? 'custom',
    intent: values.intent,
    ...(values.preserve ? { preserve: values.preserve } : {})
  };
}

export const run: Command = {
  name: 'run',
  summary: 'Start iterations with a coding agent, in a terminal, unattended or in your editor',
  usage:
    'run <page>/<component> (--direction <idea>... | --fork <iteration> | --refine <iteration> --intent <text>) [--agent <id>] [--headless]',
  needsRepo: true,
  async run(args, context) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        direction: { type: 'string', multiple: true },
        hypothesis: { type: 'string' },
        fork: { type: 'string' },
        refine: { type: 'string' },
        intent: { type: 'string' },
        preset: { type: 'string' },
        preserve: { type: 'string' },
        agent: { type: 'string' },
        model: { type: 'string' },
        headless: { type: 'boolean', default: false },
        'dev-url': { type: 'string' },
        'no-screenshots': { type: 'boolean', default: false }
      }
    });
    const { page, component } = parseComponent(positionals[0]);
    const kind = runKind(values);
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const environment = await readEnvironment(repoRoot, link);
    const { adapter, detection } = await chooseAgent(context, values.agent);
    const model = values.model ?? null;
    if (values.headless && !detection.headless.ready) throw new Error(detection.headless.reason);
    const dev = devUrl(values['dev-url'], context.env, environment.start.url);

    const api = await requireApi(context);
    const outbox = outboxFor(repoRoot);
    // Decisions waiting in the outbox reach the server first, so this prompt remembers them.
    await outbox.flush(api);
    const request = {
      page,
      component,
      agent: adapter.id,
      mode: adapter.kind === 'editor' ? 'editor' : values.headless ? 'headless' : 'interactive',
      ...kind
    } as StartRunRequest;
    const runs = await startRuns(repoRoot, api, link, request, {
      assetOrigin: localOrigin(await readSettings(context.configDir)),
      devUrl: dev
    });
    return launchRuns(context, {
      adapter,
      detection,
      runs,
      model,
      headless: values.headless,
      devUrl: dev,
      screenshots: !values['no-screenshots'],
      api,
      outbox,
      link
    });
  }
};

/**
 * Hands started runs to their agent: in the designer's editor, unattended with its output
 * summarized and the run finished here, or in terminal sessions the designer drives. Shared by
 * `run` and the port that `pull` starts.
 */
export async function launchRuns(
  context: CommandContext,
  launch: {
    adapter: AgentAdapter;
    detection: Detection;
    runs: RunRecord[];
    model: string | null;
    headless: boolean;
    devUrl: string;
    screenshots: boolean;
    api: StudioApi;
    outbox: Outbox;
    link: RepoLink;
  }
): Promise<number> {
  const { io } = context;
  const { adapter, detection, runs, model, api, outbox, link } = launch;
  const repoRoot = context.repoRoot!;
  for (const item of runs) {
    io.out(`${item.page}/${item.component}/${item.iteration}: ${item.promptFile}`);
  }

  if (adapter.kind === 'editor') {
    const prompts = runs.map(item => item.promptFile);
    sayEditorLaunch(
      io,
      await openInEditor(context, adapter, detection, repoRoot, prompts),
      prompts
    );
    io.out('When the agent has finished, run roughbook done.');
    return 0;
  }
  const executable = detection.executable!;

  if (launch.headless) {
    io.out(`Running ${adapter.name} unattended. Its output is summarized here.`);
    const finished = await Promise.all(
      runs.map(async record => {
        const invocation = adapter.headless(
          runTarget(repoRoot, record, model),
          executable,
          context.env
        );
        if ('refused' in invocation) throw new Error(invocation.refused);
        const result = await context.runHeadless(adapter, invocation, {
          env: context.env,
          model,
          onEvent: event => {
            if (event.kind === 'file') io.out(`  ${record.iteration}: wrote ${event.name}`);
          }
        });
        if (result.error) io.err(`  ${record.iteration}: ${result.error}`);
        return completeRun(context, api, outbox, link, record, {
          outcome: result.ok ? undefined : result.cancelled ? 'cancelled' : 'failed',
          usage: result.usage,
          devUrl: launch.devUrl,
          screenshots: launch.screenshots,
          by: 'headless'
        });
      })
    );
    return finished.every(item => item.outcome !== 'failed') ? 0 : 1;
  }

  const sessions = terminalSessions(adapter, executable, repoRoot, runs, model);
  const plan = planTerminal({
    platform: context.platform,
    env: context.env,
    repoRoot,
    sessions
  });
  let opened = false;
  if (plan.kind !== 'manual') {
    try {
      await context.launchTerminal(plan);
      opened = true;
      io.out(
        `Opened ${runs.length === 1 ? 'a session' : `${runs.length} sessions`} of ${adapter.name} in ${plan.terminal}.`
      );
    } catch (error) {
      io.err(`${plan.terminal} could not be opened: ${(error as Error).message}`);
    }
  }
  if (!opened) {
    if (plan.kind === 'manual') io.out(plan.reason);
    io.out('Run each of these in a terminal:');
    for (const session of sessions) {
      io.out(`  ${manualCommand(context.platform, repoRoot, session)}`);
    }
  }
  io.out('When the agent has finished, run roughbook done.');
  return 0;
}
