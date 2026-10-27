// `roughbook map` (B1 of ROUGHBOOK-BROWNFIELD-PLAN.md): what the app already has, in rough/map.md.
// The discoverers read what the stack declares, with no agent and no command run; `--agent` then
// starts the map run, an agent session that names and groups what they found, adds what they
// could not see and writes fixtures, writing only rough/map.md and fixtures inside rough/. Nothing
// of the map reaches the server: the map run's prompt is fetched with ids alone.
import { parseArgs } from 'node:util';
import type { TerminalAdapter } from '../agents/types.js';
import type { DoctorReport } from '../doctor/types.js';
import { readEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { readJson } from '../fs/json.js';
import { askYesNo, NOBODY_ANSWERS } from '../io.js';
import { manualCommand, planTerminal, sessionTitle, type Session } from '../launch/terminal.js';
import {
  discoveredText,
  doctorText,
  fillMapPrompt,
  fixtureFileText,
  mapFinishingSection,
  mapPromptFile,
  mapRunStrays,
  newMapRunId,
  openMapRun,
  saveMapRun
} from '../map/agent.js';
import { MAP_FILE, MapFormatError, mapProblems, readMap } from '../map/file.js';
import { countMap, describeChanges, describeMap, mapRepo, type MapResult } from '../map/run.js';
import { recipeOf } from '../recipes/index.js';
import { describeDetection, detectStack } from '../recipes/detect.js';
import { requireRepoLink, type RepoLink } from '../repo/link.js';
import { ROUGH_DIR } from '../repo/root.js';
import { handoffLine, writePrompt } from '../runs/slots.js';
import { takeSnapshot } from '../runs/snapshot.js';
import { recordEvent } from '../telemetry/events.js';
import { requireApi, type Command, type CommandContext } from './context.js';
import { doctorReportFile } from './setup.js';
import { chooseAgent, openInEditor, sayEditorLaunch } from './shared.js';

/** How many of the missed things the terminal lists before it says how many more. */
const SHOWN_MISSED = 8;

/** The map as the terminal says it, after `roughbook map` or `init` wrote it. */
export function sayMap(
  context: CommandContext,
  result: MapResult,
  options: { brief?: boolean } = {}
) {
  const { io } = context;
  const { map } = result;
  const names = result.by.map(recipe => recipe.name).join(' and ');
  io.out(
    `${ROUGH_DIR}/${MAP_FILE} ${result.changed ? 'written' : 'is up to date'}: ${countMap(map)}${
      names
        ? `, by the ${names} discoverer${result.by.length === 1 ? '' : 's'} in ${(result.ms / 1000).toFixed(1)} s`
        : ''
    }.`
  );
  for (const line of describeMap(map, { pages: options.brief ? 8 : 25 })) io.out(line);
  for (const line of describeChanges(result)) io.out(line);
  if (map.missed.length) {
    io.out(`Not placed (${map.missed.length}), each with the reason in ${ROUGH_DIR}/${MAP_FILE}:`);
    if (!options.brief) {
      for (const item of map.missed.slice(0, SHOWN_MISSED)) io.out(`  ${item.what}: ${item.why}`);
      if (map.missed.length > SHOWN_MISSED) {
        io.out(`  … and ${map.missed.length - SHOWN_MISSED} more.`);
      }
    }
  }
  if (map.unplaced.length) {
    io.out(
      `${map.unplaced.length} component file${map.unplaced.length === 1 ? '' : 's'} nothing renders (unplaced).`
    );
  }
  for (const fixture of result.fixtures)
    io.out(`  + ${fixture}: a fixture from the app's own story.`);
  for (const problem of mapProblems(map)) io.err(`  ! ${problem}`);
}

/** The map run's agent session, which the designer watches. */
function mapSession(
  adapter: TerminalAdapter,
  executable: { command: string; prefixArgs: string[] },
  repoRoot: string,
  promptFile: string,
  id: string,
  model: string | null
): Session {
  const title = sessionTitle('Roughbook map');
  return {
    title,
    command: executable.command,
    args: [
      ...executable.prefixArgs,
      ...adapter.interactiveArgs({
        repoRoot,
        targetFolder: ROUGH_DIR,
        promptFile,
        instruction: handoffLine(promptFile),
        sessionId: id,
        model,
        title
      })
    ]
  };
}

/**
 * Starts the map run: the prompt with the stand-ins filled, a snapshot so the next `roughbook map`
 * can tell what it changed, its record, and the designer's agent opened on it.
 */
async function startMapRun(
  context: CommandContext,
  repoRoot: string,
  link: RepoLink,
  environment: RepoEnvironment,
  result: MapResult | null,
  options: { agent?: string; model?: string | null; yes: boolean }
): Promise<number> {
  const { io } = context;
  const api = await requireApi(context);
  const { adapter, detection } = await chooseAgent(context, options.agent);
  if (!options.yes) {
    const yes = await askYesNo(
      io,
      `Start the map run with ${adapter.name}? It reads this app and writes only ${ROUGH_DIR}/${MAP_FILE} and fixtures in ${ROUGH_DIR}/; its tokens are your agent's own.`,
      true
    );
    if (yes === null) {
      io.out(
        `${NOBODY_ANSWERS}, so the map run did not start. Run it with --yes once you have read this.`
      );
      return 1;
    }
    if (!yes) {
      io.out('The map run did not start.');
      return 0;
    }
  }
  const fetched = await api.mapPrompt(link.orgId, link.project);
  const report = await readJson<DoctorReport>(doctorReportFile(repoRoot)).catch(() => null);
  const id = newMapRunId();
  const promptFile = mapPromptFile(id);
  const prompt = fillMapPrompt(fetched.prompt, fetched.placeholders, {
    discovered: discoveredText(result?.map ?? null, result?.by.map(recipe => recipe.id) ?? []),
    fixtureFile: fixtureFileText(environment),
    guess: describeDetection(detectStack(repoRoot)).join('\n'),
    doctor: doctorText(report)
  }).trimEnd();
  // Before the prompt is written, so writing it counts as the run's own change.
  await takeSnapshot(repoRoot, [id], environment.ignore);
  writePrompt(repoRoot, promptFile, `${prompt}\n\n${mapFinishingSection(id)}`);
  await saveMapRun(repoRoot, {
    id,
    agent: adapter.id,
    mode: adapter.kind === 'editor' ? 'editor' : 'interactive',
    promptFile,
    startedAt: new Date().toISOString(),
    finishedAt: null
  });
  io.out(`Map run: ${promptFile}`);
  const next = `When the agent says the map is ready, run roughbook map to keep its work and check it, then roughbook doctor with the app running.`;
  if (adapter.kind === 'editor') {
    sayEditorLaunch(
      io,
      await openInEditor(context, adapter, detection, repoRoot, [promptFile], { finish: false }),
      [promptFile]
    );
    io.out(next);
    return 0;
  }
  const session = mapSession(
    adapter,
    detection.executable!,
    repoRoot,
    promptFile,
    id,
    options.model ?? null
  );
  const plan = planTerminal({
    platform: context.platform,
    env: context.env,
    repoRoot,
    sessions: [session]
  });
  if (plan.kind !== 'manual') {
    try {
      await context.launchTerminal(plan);
      io.out(`Opened ${adapter.name} in ${plan.terminal}.`);
      io.out(next);
      return 0;
    } catch (error) {
      io.err(`${plan.terminal} could not be opened: ${(error as Error).message}`);
    }
  } else {
    io.out(plan.reason);
  }
  io.out(`Run this in a terminal: ${manualCommand(context.platform, repoRoot, session)}`);
  io.out(next);
  return 0;
}

export const map: Command = {
  name: 'map',
  summary: 'Map the pages and components this app already has, into rough/map.md',
  usage: 'map [--agent <id>] [--model <m>] [--yes] [--json]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values } = parseArgs({
      args,
      options: {
        agent: { type: 'string' },
        model: { type: 'string' },
        yes: { type: 'boolean', short: 'y', default: false },
        json: { type: 'boolean', default: false }
      }
    });
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const environment = await readEnvironment(repoRoot, link);

    // A map run that ended: the map it left is kept below; what it changed besides is named.
    const open = await openMapRun(repoRoot);
    if (open) {
      const strays = await mapRunStrays(repoRoot, open, environment.ignore);
      await saveMapRun(repoRoot, { ...open, finishedAt: new Date().toISOString() });
      io.out(`The map run from ${open.startedAt} is over; its map is kept.`);
      if (strays?.length) {
        io.err(
          `It changed ${strays.length} file${strays.length === 1 ? '' : 's'} besides the map and its fixtures, which a map run must not: ${strays.join(', ')}. Look at them with git diff and put back what is not yours.`
        );
      }
    }

    let result: MapResult | null;
    try {
      result = await mapRepo(repoRoot, environment, link, { full: true });
    } catch (error) {
      if (!(error instanceof MapFormatError)) throw error;
      throw new Error(
        `${error.message} Fix the header, or move the file away and run roughbook map to write it again.`
      );
    }
    if (result) await recordMapRan(context, result, open !== null);
    if (values.json) {
      io.out(
        JSON.stringify(result ? { map: result.map, fixtures: result.fixtures } : null, null, 2)
      );
    } else if (result) {
      sayMap(context, result);
    } else {
      const recipe = recipeOf(environment);
      io.out(
        `No discoverer reads ${recipe ? `a ${recipe.name} app` : "this repo's stack"} yet, so ${ROUGH_DIR}/${MAP_FILE} is the map run's to write: roughbook map --agent <id>.`
      );
    }
    if (!values.agent) {
      if (!values.json) {
        io.out(
          `Next: roughbook doctor, with the app running, renders every section and asks every page; roughbook map --agent <id> has your agent name them, add what was missed and write fixtures.`
        );
      }
      return 0;
    }
    return startMapRun(context, repoRoot, link, environment, result ?? fallback(repoRoot), {
      agent: values.agent,
      model: values.model ?? null,
      yes: values.yes
    });
  }
};

/**
 * `map.ran` (B2's contract), when the designer agreed: how much the map lists, whether a map run's
 * work is in it, and how long the discoverers took. Counts only, never a name.
 */
async function recordMapRan(context: CommandContext, result: MapResult, agent: boolean) {
  const { map } = result;
  const count = (value: number, max = 100_000) => Math.min(max, Math.max(0, Math.round(value)));
  await recordEvent(context, 'map.ran', {
    pages: count(map.pages.length),
    components: count(map.components.length),
    missed: count(map.missed.length),
    unplaced: count(map.unplaced.length),
    agent,
    milliseconds: count(result.ms, 86_400_000)
  }).catch(() => false);
}

/** The map already there, for a map run on a stack no discoverer reads. */
function fallback(repoRoot: string): MapResult | null {
  try {
    const read = readMap(repoRoot);
    return read
      ? {
          map: read.map,
          previous: read.map,
          by: [],
          changed: false,
          written: true,
          fixtures: [],
          ms: 0,
          renamed: [],
          went: [],
          returned: [],
          left: []
        }
      : null;
  } catch {
    return null;
  }
}
