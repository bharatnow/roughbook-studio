import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { StudioApi } from '../api/client.js';
import { exitCodeFor, redactedReport, renderReport, runDoctor } from '../doctor/run.js';
import type { DoctorReport } from '../doctor/types.js';
import { readEnvironment } from '../environment/read.js';
import { currentOs } from '../launch/platform.js';
import { readLocalLink, requireRepoLink, type RepoLink } from '../repo/link.js';
import { openSetup, saveSetup } from '../runs/setup.js';
import { openApi, type Command, type CommandContext } from './context.js';
import { devUrl } from './done.js';
import { approveEnvironment, doctorReportFile } from './setup.js';

/**
 * Runs doctor the way the command does: asks to approve the environment's commands when someone
 * can answer, runs the checks, writes the report for `setup --fix`, ends the open setup run with
 * the outcome, and tells the server how it went (tokens and check ids only). Shared with `init`.
 */
export async function runDoctorHere(
  context: CommandContext,
  repoRoot: string,
  link: RepoLink,
  options: {
    devUrl?: string;
    skipBuild?: boolean;
    yes?: boolean;
    json?: boolean;
    /** Measure the speed budgets too, starting the app when nothing answers at its address. */
    speed?: boolean;
  }
): Promise<DoctorReport> {
  const { io } = context;
  // An environment that cannot be read is doctor's first finding, not a crash here.
  const environment = await readEnvironment(repoRoot, link).catch(() => null);
  if (environment && !options.json) {
    await approveEnvironment(context, repoRoot, environment, options.yes ?? false);
  }
  const url = devUrl(options.devUrl, context.env, environment?.start.url);
  const report = await runDoctor(repoRoot, {
    devUrl: url,
    skipBuild: options.skipBuild,
    approve: options.yes,
    speed: options.speed,
    startApp: options.speed,
    tools: context.doctorTools
  });
  if (options.json) io.out(JSON.stringify(report, null, 2));
  else for (const line of renderReport(report)) io.out(line);

  // The report for `setup --fix` and for a support ticket: the checks and the versions, no path.
  const file = doctorReportFile(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(redactedReport(report, { node: process.version, os: currentOs(context.platform) }), null, 2)}\n`
  );

  const setup = await openSetup(repoRoot);
  if (setup) {
    await saveSetup(repoRoot, {
      ...setup,
      finishedAt: new Date().toISOString(),
      doctor: report.outcome
    });
  }
  await tellServer(context, link, report);
  return report;
}

/** Doctor's result goes to the server with the stack tokens (decision 15); quietly, as a courtesy. */
async function tellServer(context: CommandContext, link: RepoLink, report: DoctorReport) {
  try {
    const local = await readLocalLink(context.repoRoot!);
    const { api } = await openApi(context);
    if (!local || !api.signedIn) return;
    await (api as StudioApi).withTimeout(5000).reportDoctor(link.orgId, local.linkId, {
      outcome: report.outcome,
      mode: report.environment.mode,
      family: report.environment.family,
      stack: report.environment.stack,
      failed: report.checks.filter(check => check.status === 'fail').map(check => check.id)
    });
  } catch {
    // The report on the screen is what matters; the server hears about it next time.
  }
}

export const doctor: Command = {
  name: 'doctor',
  summary: "Check this repo's preview setup against the contract, and say what to fix",
  usage: 'doctor [--json] [--report] [--skip-build] [--speed] [--yes] [--dev-url <url>]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values } = parseArgs({
      args,
      options: {
        json: { type: 'boolean', default: false },
        report: { type: 'boolean', default: false },
        'skip-build': { type: 'boolean', default: false },
        speed: { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
        'dev-url': { type: 'string' }
      }
    });
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const report = await runDoctorHere(context, repoRoot, link, {
      devUrl: values['dev-url'],
      skipBuild: values['skip-build'],
      speed: values.speed,
      yes: values.yes,
      json: values.json
    });
    if (values.report) {
      io.out(
        `Report written to ${doctorReportFile(repoRoot)}: the checks and the versions, no path and nothing from the repo.`
      );
    }
    return exitCodeFor(report.outcome);
  }
};
