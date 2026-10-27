// How a run is said where there is room for a word, not a sentence (DESIGN.md in the roughbook
// repo, "Quiet"): the run card's badge, the inspector's Made by row, a making card's status.
import type { RunView } from './types.ts';

const OUTCOMES: Record<NonNullable<RunView['outcome']>, string> = {
  completed: 'Completed',
  completed_with_warnings: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled'
};

const FINISHED_BY: Record<
  NonNullable<RunView['finishedBy']>,
  { word: string; sentence: string }
> = {
  agent: { word: 'Agent', sentence: 'The agent finished it through the Roughbook MCP tools.' },
  done: { word: 'Command', sentence: 'Finished with roughbook done.' },
  'local-ui': { word: 'Studio', sentence: 'Finished with Done in the studio.' },
  headless: { word: 'Unattended', sentence: 'Finished when the unattended agent exited.' }
};

/** Its agent is at work. */
export function runRunning(run: Pick<RunView, 'terminal' | 'headless'>): boolean {
  return run.terminal?.status === 'running' || run.headless?.status === 'running';
}

/** Working or Waiting (for Done) while open; how it ended once finished. */
export function runWord(run: RunView): string {
  if (run.status === 'started') return runRunning(run) ? 'Working' : 'Waiting';
  return run.outcome ? OUTCOMES[run.outcome] : 'Finished';
}

/** Who finished it, as one word and the sentence for its tooltip; null while open. */
export function finishedBy(run: RunView): { word: string; sentence: string } | null {
  return run.finishedBy ? FINISHED_BY[run.finishedBy] : null;
}

/**
 * Whether a run open before is finished now: the project is read again at once, so a view open
 * on it, such as the composition editor waiting for a new section's first iteration, has it.
 */
export function runFinishedSince(
  before: Pick<RunView, 'runId' | 'status'>[],
  after: Pick<RunView, 'runId' | 'status'>[]
): boolean {
  const open = new Set(before.filter(run => run.status === 'started').map(run => run.runId));
  return after.some(run => open.has(run.runId) && run.status !== 'started');
}
