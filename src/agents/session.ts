import type { Session } from '../launch/terminal.js';
import { sessionTitle } from '../launch/terminal.js';
import type { Executable } from '../launch/which.js';
import { handoffLine } from '../runs/slots.js';
import type { RunRecord } from '../runs/types.js';
import type { RunTarget, TerminalAdapter } from './types.js';

/** A run as an adapter sees it. The run id doubles as the agent's session id, so it can resume. */
export function runTarget(repoRoot: string, run: RunRecord, model: string | null): RunTarget {
  return {
    repoRoot,
    targetFolder: run.targetFolder,
    promptFile: run.promptFile,
    instruction: handoffLine(run.promptFile, run.mode !== 'headless'),
    sessionId: run.runId,
    model,
    title: sessionTitle(`${run.component} ${run.iteration}`)
  };
}

/** One terminal session per run, each started with its one-line instruction. */
export function terminalSessions(
  adapter: TerminalAdapter,
  executable: Executable,
  repoRoot: string,
  runs: RunRecord[],
  model: string | null
): Session[] {
  return runs.map(run => {
    const target = runTarget(repoRoot, run, model);
    return {
      title: target.title,
      command: executable.command,
      args: [...executable.prefixArgs, ...adapter.interactiveArgs(target)]
    };
  });
}
