import { parseArgs } from 'node:util';
import { runTarget, terminalSessions } from '../agents/session.js';
import type { AgentAdapter, Detection } from '../agents/types.js';
import type { StudioApi } from '../api/client.js';
import type { DrawSection, SiteDrawView } from '../api/types.js';
import { outboxFor, type Outbox } from '../api/outbox.js';
import { manualCommand, planTerminal } from '../launch/terminal.js';
import { ensurePicturesAnswer } from '../pictures/answer.js';
import { localOrigin, readSettings } from '../config/settings.js';
import { requireRepoLink, type RepoLink } from '../repo/link.js';
import { startRuns } from '../runs/lifecycle.js';
import type { RunRecord, StartRunRequest } from '../runs/types.js';
import { requireApi, type Command, type CommandContext } from './context.js';
import { completeRun, devUrl } from './done.js';
import { readEnvironment } from '../environment/read.js';
import { forkFields, keptList } from '../runs/forkIntent.js';
import { chooseAgent, openInEditor, parseComponent, sayEditorLaunch } from './shared.js';
import { SLUG } from '../repo/iterations.js';

/** What the designer asked for: new directions, a fork, or a refinement. */
export function runKind(values: {
  direction?: string[];
  hypothesis?: string;
  fork?: string;
  refine?: string;
  intent?: string;
  preset?: string;
  preserve?: string;
  keep?: string;
  radical?: boolean;
}): Pick<StartRunRequest, 'kind'> & Record<string, unknown> {
  const asked = [values.direction?.length, values.fork, values.refine].filter(Boolean).length;
  if (asked !== 1) {
    throw new Error(
      'Say what to run: --direction "<idea>" (up to eight), --fork <iteration>, or --refine <iteration> --intent "<what to change>".'
    );
  }
  if (!values.fork && (values.keep || values.radical)) {
    throw new Error('--keep and --radical are for a fork: --fork <iteration>.');
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
  if (values.fork) {
    return {
      kind: 'fork',
      parent: values.fork,
      ...forkFields({
        change: values.intent,
        remain: keptList(values.keep),
        radical: values.radical
      })
    };
  }
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
    'run <page>/<component> (--direction <idea>... | --fork <iteration> [--intent <what to change>] [--keep <a,b,…>] [--radical] | --refine <iteration> --intent <text>) [--agent <id>] [--headless]\n       run --site [--page <slug>] [--agent <id>] [--headless]',
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
        keep: { type: 'string' },
        radical: { type: 'boolean', default: false },
        agent: { type: 'string' },
        model: { type: 'string' },
        headless: { type: 'boolean', default: false },
        'dev-url': { type: 'string' },
        'no-screenshots': { type: 'boolean', default: false },
        site: { type: 'boolean', default: false },
        page: { type: 'string' }
      }
    });
    const site = siteTarget(values, positionals);
    if (site) return runSite(context, site, values);
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
    const mode =
      adapter.kind === 'editor' ? 'editor' : values.headless ? 'headless' : 'interactive';
    // The project's pictures question (decision 25 of the Apple plan): asked once at a terminal,
    // and only said in an unattended or editor run, whose finish nobody answers questions at.
    await ensurePicturesAnswer(context.io, api, link, { ask: mode === 'interactive', outbox });
    // Decisions waiting in the outbox reach the server first, so this prompt remembers them.
    await outbox.flush(api);
    const request = { page, component, agent: adapter.id, mode, ...kind } as StartRunRequest;
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

/** What `--site` was asked for: the whole site, or one page's sections (and any Shared part). */
export type SiteTarget = { page: string | null };

/**
 * `--site [--page <slug>]` (ROUGHBOOK-WHOLE-SITE-PLAN.md, X5): the plan names the sections and
 * their directions, so a section, a direction, a fork or a refinement beside it is refused rather
 * than guessed at. Null when this is not a site run.
 */
export function siteTarget(
  values: { site?: boolean; page?: string; direction?: string[]; fork?: string; refine?: string },
  positionals: string[]
): SiteTarget | null {
  if (!values.site) {
    if (values.page !== undefined) {
      throw new Error('--page is for a site run: --site --page <slug>.');
    }
    return null;
  }
  if (positionals.length) {
    throw new Error(
      '--site draws the planned sections, so it takes no <page>/<component>. For one page: --site --page <slug>.'
    );
  }
  if (values.direction?.length || values.fork || values.refine) {
    throw new Error(
      '--site gives each section its direction from the plan, so it takes no --direction, --fork or --refine.'
    );
  }
  if (values.page !== undefined && !SLUG.test(values.page)) {
    throw new Error(`--page wants a page's slug, such as home; "${values.page}" is not one.`);
  }
  return { page: values.page ?? null };
}

/** One stage of a site draw, in the order it runs. */
export type SiteStage = { stage: 1 | 2 | 3; label: string; sections: DrawSection[] };

const STAGE_LABELS = { 1: 'Shared parts', 2: 'The opening', 3: 'The rest' } as const;

/**
 * The draw's order grouped by stage, empty stages left out (X5): the Shared parts first, then the
 * home page's opening that sets the bar, then the rest. Within a stage the plan's order is kept.
 */
export function siteStages(order: DrawSection[]): SiteStage[] {
  return ([1, 2, 3] as const)
    .map(stage => ({
      stage,
      label: STAGE_LABELS[stage],
      sections: order.filter(section => section.stage === stage)
    }))
    .filter(stage => stage.sections.length > 0);
}

/** "Shared parts: 2 sections", as each stage is printed. */
export function stageLine(stage: SiteStage): string {
  const n = stage.sections.length;
  return `${stage.label}: ${n} ${n === 1 ? 'section' : 'sections'}`;
}

/**
 * What `--site` says instead of drawing, and its exit (X5): nothing to draw is not a failure, so
 * its refusal exits 0; a draw already running on the web would be drawn twice, so it is refused.
 */
export function siteRefusal(view: SiteDrawView): { words: string; exit: number } | null {
  if (view.draw?.status === 'drawing') {
    return {
      words:
        'The site is being drawn on the web. Wait for it, or stop it there, then run this again.',
      exit: 1
    };
  }
  if (view.order.length === 0) return { words: view.refusal ?? 'Nothing left to draw.', exit: 0 };
  if (view.refusal) return { words: view.refusal, exit: 1 };
  return null;
}

/**
 * `roughbook run --site` (X5): draws the plan's undrawn sections here, one local take each, stage
 * by stage. The backend's preview decides the order and each direction, and the backend gives
 * each prompt its site contract, so the studio adds nothing to the prompt. Unattended, each stage
 * is waited for before the next starts; in sessions a person drives, one stage opens at a time and
 * the next `--site` picks up what is left, since the preview leaves picked sections out.
 */
async function runSite(
  context: CommandContext,
  target: SiteTarget,
  values: {
    agent?: string;
    model?: string;
    headless?: boolean;
    'dev-url'?: string;
    'no-screenshots'?: boolean;
  }
): Promise<number> {
  const { io } = context;
  const repoRoot = context.repoRoot!;
  const link = await requireRepoLink(repoRoot);
  const api = await requireApi(context);
  const view = await api.siteDraw(link.orgId, link.project, target.page ?? undefined);
  const said = siteRefusal(view);
  if (said) {
    io.out(said.words);
    return said.exit;
  }
  const stages = siteStages(view.order);
  // A plan with daily sketches draws up to them (ROUGHBOOK-WHOLE-SITE-PLAN.md, X5); the rest wait.
  if (view.allowance) {
    io.out(
      `Drawing ${view.order.length} of ${view.order.length + view.allowance.later} sections today, the plan's ${view.allowance.perDay} a day. Run this again tomorrow for the rest.`
    );
  }

  const environment = await readEnvironment(repoRoot, link);
  const { adapter, detection } = await chooseAgent(context, values.agent);
  if (values.headless && !detection.headless.ready) throw new Error(detection.headless.reason);
  // --site runs unattended whenever the agent can, so the stages follow one another by themselves.
  const headless = adapter.kind !== 'editor' && detection.headless.ready;
  const mode = adapter.kind === 'editor' ? 'editor' : headless ? 'headless' : 'interactive';
  const dev = devUrl(values['dev-url'], context.env, environment.start.url);
  const model = values.model ?? null;
  const outbox = outboxFor(repoRoot);
  // The pictures question and the outbox, once for the whole draw, as a single run does them.
  await ensurePicturesAnswer(io, api, link, { ask: mode === 'interactive', outbox });
  await outbox.flush(api);
  const assetOrigin = localOrigin(await readSettings(context.configDir));

  let exit = 0;
  for (const [index, stage] of stages.entries()) {
    io.out(stageLine(stage));
    const runs: RunRecord[] = [];
    for (const section of stage.sections) {
      const request: StartRunRequest = {
        page: section.page,
        component: section.component,
        agent: adapter.id,
        mode,
        kind: 'generate',
        directions: [{ direction: section.direction }]
      };
      runs.push(...(await startRuns(repoRoot, api, link, request, { assetOrigin, devUrl: dev })));
    }
    const code = await launchRuns(context, {
      adapter,
      detection,
      runs,
      model,
      headless,
      devUrl: dev,
      screenshots: !values['no-screenshots'],
      api,
      outbox,
      link
    });
    // A stage's failures don't stop the next one (X5); the exit still says some failed.
    if (code !== 0) exit = code;
    if (!headless) {
      // Nobody here waits on sessions a person drives: they pick, then ask for the next stage.
      if (index < stages.length - 1) {
        io.out('Pick what you like, then run roughbook run --site again for the next stage.');
      }
      return exit;
    }
  }
  return exit;
}

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
