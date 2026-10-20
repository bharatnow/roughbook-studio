import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { exitCodeFor, redactedReport, renderReport, runDoctor } from '../doctor/run.js';
import { readEnvironment } from '../environment/read.js';
import { currentOs } from '../launch/platform.js';
import { requireRepoLink } from '../repo/link.js';
import { statePath } from '../repo/root.js';
import type { Command } from './context.js';
import { devUrl } from './done.js';

export const doctor: Command = {
  name: 'doctor',
  summary: "Check this repo's preview setup against the contract, and say what to fix",
  usage: 'doctor [--json] [--report] [--skip-build] [--dev-url <url>]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values } = parseArgs({
      args,
      options: {
        json: { type: 'boolean', default: false },
        report: { type: 'boolean', default: false },
        'skip-build': { type: 'boolean', default: false },
        'dev-url': { type: 'string' }
      }
    });
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    // An environment that cannot be read is doctor's first finding, not a crash here.
    const environment = await readEnvironment(repoRoot, link).catch(() => null);
    const url = devUrl(values['dev-url'], context.env, environment?.start.url);
    const report = await runDoctor(repoRoot, {
      devUrl: url,
      skipBuild: values['skip-build'],
      tools: context.doctorTools
    });
    if (values.json) io.out(JSON.stringify(report, null, 2));
    else for (const line of renderReport(report)) io.out(line);
    if (values.report) {
      const file = statePath(repoRoot, 'doctor-report.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        `${JSON.stringify(redactedReport(report, { node: process.version, os: currentOs() }), null, 2)}\n`
      );
      io.out(
        `Report written to ${file}: the checks and the versions, no path and nothing from the repo.`
      );
    }
    return exitCodeFor(report.outcome);
  }
};
