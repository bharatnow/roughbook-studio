import { parseArgs } from 'node:util';
import type { TerminalAdapter } from '../agents/types.js';
import type { StudioApi } from '../api/client.js';
import type { DoctorReport } from '../doctor/types.js';
import {
  ENVIRONMENT_FILE,
  SETUP_DIR,
  hasEnvironmentFile,
  readEnvironment
} from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { confirm } from '../io.js';
import { manualCommand, planTerminal, sessionTitle, type Session } from '../launch/terminal.js';
import { detectStack } from '../recipes/detect.js';
import { recipeFor } from '../recipes/index.js';
import {
  approveCommands,
  describeCommand,
  readApprovals,
  unapprovedCommands
} from '../repo/approvals.js';
import { readJson } from '../fs/json.js';
import { requireRepoLink, type RepoLink } from '../repo/link.js';
import { applyPrep, planPrep } from '../repo/prep.js';
import { ROUGH_DIR, statePath } from '../repo/root.js';
import { applySetup, planSetup, type SetupStep } from '../repo/setup.js';
import {
  fillSetupPrompt,
  fixSection,
  guessText,
  newSetupId,
  recipeNotesText,
  ruleFilesText,
  saveSetup,
  setupFinishingSection,
  setupPromptFile,
  type SetupKind
} from '../runs/setup.js';
import { handoffLine, writePrompt } from '../runs/slots.js';
import { takeSnapshot } from '../runs/snapshot.js';
import { requireApi, type Command, type CommandContext } from './context.js';
import { chooseAgent, openInEditor, sayEditorLaunch } from './shared.js';

/** Where doctor leaves its last report, which `setup --fix` reads. */
export function doctorReportFile(repoRoot: string): string {
  return statePath(repoRoot, 'doctor-report.json');
}

/** The templates as they would be applied, one line each, for the designer to see first. */
export function describeSetupSteps(steps: SetupStep[]): string[] {
  return steps.map(step => {
    const what =
      step.action === 'create'
        ? '+'
        : step.action === 'replace'
          ? '~'
          : step.action === 'append'
            ? '+'
            : step.action === 'unchanged'
              ? '='
              : '!';
    const verb =
      step.action === 'create'
        ? `write ${step.file.path} from ${step.template}`
        : step.action === 'replace'
          ? `rewrite ${step.file.path} from ${step.template}`
          : step.action === 'append'
            ? `add the lines of ${step.template} to ${step.file.path}`
            : step.action === 'unchanged'
              ? `${step.file.path} is already in place`
              : step.reason!;
    return `  ${what} ${verb}`;
  });
}

/**
 * Applies the templates in rough/setup/ to this repo, showing them first: `init` on a clone,
 * `setup --apply`. Returns false when the designer said no.
 */
export async function applyTemplates(
  context: CommandContext,
  repoRoot: string,
  environment: RepoEnvironment,
  yes: boolean
): Promise<boolean> {
  const { io } = context;
  const steps = planSetup(repoRoot, environment);
  if (!steps.length) {
    io.out(
      `${ROUGH_DIR}/${ENVIRONMENT_FILE} lists no setup files outside ${ROUGH_DIR}/; nothing to apply.`
    );
    return true;
  }
  const pending = steps.filter(step => step.action !== 'unchanged');
  io.out(`The preview setup from ${ROUGH_DIR}/${SETUP_DIR}/:`);
  for (const line of describeSetupSteps(steps)) io.out(line);
  if (!pending.some(step => step.action !== 'cannot')) {
    if (pending.length) io.err('Some templates cannot be applied; see above.');
    return !pending.length;
  }
  if (!yes) {
    const answer = await io.ask(`Apply ${pending.length === 1 ? 'it' : 'them'}? [Y/n] `);
    if (answer === null || (answer && !/^y(es)?$/i.test(answer))) {
      io.out('Nothing was written. Run again with --yes to apply the templates.');
      return false;
    }
  }
  const written = applySetup(repoRoot, steps);
  io.out(
    `Applied ${written.length} file${written.length === 1 ? '' : 's'}: ${written.join(', ')}.`
  );
  return true;
}

/**
 * Shows the environment's commands not yet approved on this machine, with their shell, and asks
 * (decision 18). Returns whether every command is approved afterwards.
 */
export async function approveEnvironment(
  context: CommandContext,
  repoRoot: string,
  environment: RepoEnvironment,
  yes: boolean
): Promise<boolean> {
  const { io } = context;
  const pending = unapprovedCommands(environment, await readApprovals(repoRoot));
  if (!pending.length) return true;
  io.out(
    `${ROUGH_DIR}/${ENVIRONMENT_FILE} names ${pending.length === 1 ? 'a command' : `${pending.length} commands`} the studio runs on this machine:`
  );
  for (const item of pending) io.out(`  ${describeCommand(item)}`);
  if (!yes) {
    const approved = await confirm(
      io,
      'Approve them here? The approval is kept in rough/.roughbook/ and asked again if a command changes.',
      true
    );
    if (!approved) {
      io.out(
        'Not approved. The studio runs none of them until you approve them (roughbook doctor asks again).'
      );
      return false;
    }
  }
  await approveCommands(repoRoot, pending);
  io.out(`Approved ${pending.length} command${pending.length === 1 ? '' : 's'} on this machine.`);
  return true;
}

/** The agent's session that follows the setup prompt. */
function setupSession(
  adapter: TerminalAdapter,
  executable: { command: string; prefixArgs: string[] },
  repoRoot: string,
  promptFile: string,
  id: string,
  model: string | null,
  kind: SetupKind
): Session {
  const title = sessionTitle(kind === 'fix' ? 'Roughbook setup fix' : 'Roughbook setup');
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
 * Starts a setup run: writes the prompt with the stand-ins filled, snapshots the repo so doctor
 * can tell what the run changed outside rough/, records it, and opens the designer's agent on it.
 */
export async function startSetupRun(
  context: CommandContext,
  api: StudioApi,
  repoRoot: string,
  link: RepoLink,
  options: { kind: SetupKind; agent?: string; model?: string | null; report?: DoctorReport | null }
): Promise<number> {
  const { io } = context;
  const detected = detectStack(repoRoot);
  const recipe = recipeFor(detected.recipe);
  const environment = hasEnvironmentFile(repoRoot)
    ? await readEnvironment(repoRoot, link).catch(() => null)
    : null;
  const { adapter, detection } = await chooseAgent(context, options.agent);
  const fetched = await api.setupPrompt(link.orgId, link.project);
  const id = newSetupId();
  const promptFile = setupPromptFile(id);
  let prompt = fillSetupPrompt(fetched.prompt, fetched.placeholders, {
    guess: guessText(detected),
    recipeNotes: recipeNotesText(recipe),
    ruleFiles: ruleFilesText(detected.ruleFiles)
  }).trimEnd();
  if (options.kind === 'fix' && options.report) {
    prompt = `${prompt}\n\n${fixSection(options.report, environment)}`;
  }
  // Before the prompt is written, so writing it counts as the run's own change.
  await takeSnapshot(repoRoot, [id], environment?.ignore ?? detected.ignore);
  writePrompt(repoRoot, promptFile, `${prompt.trimEnd()}\n\n${setupFinishingSection(id)}`);
  await saveSetup(repoRoot, {
    id,
    kind: options.kind,
    agent: adapter.id,
    mode: adapter.kind === 'editor' ? 'editor' : 'interactive',
    promptFile,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    doctor: null
  });
  io.out(`${options.kind === 'fix' ? 'Setup fix' : 'Setup run'}: ${promptFile}`);
  io.out(
    `  ${detected.guess ? `Detected ${detected.guess}` : 'No stack recognized'}${recipe ? `; the ${recipe.name} recipe fits` : '; no recipe fits, so your agent builds the preview setup'}.`
  );

  if (adapter.kind === 'editor') {
    sayEditorLaunch(
      io,
      await openInEditor(context, adapter, detection, repoRoot, [promptFile], { finish: false }),
      [promptFile]
    );
    io.out(sayNext());
    return 0;
  }
  const session = setupSession(
    adapter,
    detection.executable!,
    repoRoot,
    promptFile,
    id,
    options.model ?? null,
    options.kind
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
      io.out(
        `Opened ${adapter.name} in ${plan.terminal}. Watch it: a setup run writes outside ${ROUGH_DIR}/ and may run the app's commands.`
      );
      io.out(sayNext());
      return 0;
    } catch (error) {
      io.err(`${plan.terminal} could not be opened: ${(error as Error).message}`);
    }
  } else {
    io.out(plan.reason);
  }
  io.out(`Run this in a terminal: ${manualCommand(context.platform, repoRoot, session)}`);
  io.out(sayNext());
  return 0;
}

function sayNext(): string {
  return `When the agent says the setup is ready, start the app and run roughbook doctor; roughbook setup --fix takes its findings back to the agent.`;
}

export const setup: Command = {
  name: 'setup',
  summary:
    "Have your agent build this repo's preview setup, fix what doctor found, or apply the templates",
  usage: 'setup [--fix | --apply | --upgrade] [--agent <id>] [--model <m>] [--yes]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values } = parseArgs({
      args,
      options: {
        fix: { type: 'boolean', default: false },
        apply: { type: 'boolean', default: false },
        upgrade: { type: 'boolean', default: false },
        agent: { type: 'string' },
        model: { type: 'string' },
        yes: { type: 'boolean', short: 'y', default: false },
        headless: { type: 'boolean', default: false }
      }
    });
    if ([values.fix, values.apply, values.upgrade].filter(Boolean).length > 1) {
      throw new Error('Choose one of --fix, --apply and --upgrade.');
    }
    if (values.headless) {
      throw new Error(
        'A setup run is never unattended: it writes outside rough/ and runs commands, so you watch it (decision 8 of the frameworks plan).'
      );
    }
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);

    if (values.apply) {
      if (!hasEnvironmentFile(repoRoot)) {
        throw new Error(
          `There is no ${ROUGH_DIR}/${ENVIRONMENT_FILE} to apply templates from. Run roughbook setup first.`
        );
      }
      const environment = await readEnvironment(repoRoot, link);
      if (!(await applyTemplates(context, repoRoot, environment, values.yes))) return 1;
      await approveEnvironment(context, repoRoot, environment, values.yes);
      io.out('Now start the app and run roughbook doctor.');
      return 0;
    }

    if (values.upgrade) {
      const environment = await readEnvironment(repoRoot, link);
      const recipe = recipeFor(environment.recipe);
      if (!recipe) {
        io.out(
          `This repo's setup was written by your agent, not a recipe, so there is nothing to upgrade. Run roughbook setup to change it, or roughbook setup --apply to write its templates again.`
        );
        return 0;
      }
      const plan = planPrep(repoRoot, { link, recipe });
      if (plan.problems.length) throw new Error(plan.problems[0]);
      if (!plan.changes.length) {
        io.out(
          `The ${recipe.name} setup is up to date (version ${recipe.version}). Nothing to change.`
        );
        return 0;
      }
      io.out(`The ${recipe.name} recipe (version ${recipe.version}) would change:`);
      for (const change of plan.changes) {
        io.out(`  ${change.action === 'create' ? '+' : '~'} ${change.file}: ${change.summary}`);
      }
      for (const step of plan.manual) io.out(`  ! By hand: ${step}`);
      if (!values.yes) {
        const answer = await io.ask(
          `Apply ${plan.changes.length === 1 ? 'this change' : `these ${plan.changes.length} changes`}? [Y/n] `
        );
        if (answer === null || (answer && !/^y(es)?$/i.test(answer))) {
          io.out('Nothing was written.');
          return answer === null ? 1 : 0;
        }
      }
      applyPrep(plan);
      io.out(
        `Applied ${plan.changes.length} change${plan.changes.length === 1 ? '' : 's'}; review them with git diff, then run roughbook doctor.`
      );
      return 0;
    }

    const api = await requireApi(context);
    if (values.fix) {
      const report = await readJson<DoctorReport>(doctorReportFile(repoRoot));
      if (!report) {
        throw new Error(
          'There is no doctor report to fix from. Run roughbook doctor first, with the app running.'
        );
      }
      if (!report.checks.some(check => check.status === 'fail')) {
        io.out(
          `The last doctor run ${report.outcome === 'pass' ? 'passed' : 'found nothing to fix'}; nothing to send back.`
        );
        return 0;
      }
      return startSetupRun(context, api, repoRoot, link, {
        kind: 'fix',
        agent: values.agent,
        model: values.model ?? null,
        report
      });
    }
    return startSetupRun(context, api, repoRoot, link, {
      kind: 'setup',
      agent: values.agent,
      model: values.model ?? null
    });
  }
};
