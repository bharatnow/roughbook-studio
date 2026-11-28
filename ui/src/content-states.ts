// What a card or the stage shows of an iteration the studio's agent makes (reports/Content states
// audit.md in the roughbook repo, "The pattern"), read into one of @roughbook/ui's content states
// from what the studio knows: the iteration's newest run and whether its files exist. The studio
// has no run stages, so a run at work is being made with no stage. The rest (the frame and its
// failures, the pictures) the shared frame and cards read for themselves.
import type { ContentState } from '@roughbook/ui';
import { runRunning } from './runs.ts';
import type { RunView } from './types.ts';

/** The words a run that did not make its iteration left: its failure, else the unattended agent's error. */
function failureWords(run: RunView): string | null {
  return run.failure?.message.trim() || run.headless?.error?.trim() || null;
}

/**
 * The state of an iteration's content, or undefined when there is nothing to say over its picture.
 * `pending` is its files not existing yet; `run` its newest run here. A run still open is being made;
 * one that failed or was stopped before the files existed was not made, with its failure's words. A
 * failed run on an iteration that has files says nothing of it (the files are from before), and a
 * pending iteration with no run, or whose run completed before the project read caught up, keeps
 * the card as it is.
 */
export function runContent({
  pending,
  run
}: {
  pending: boolean;
  run: RunView | null;
}): ContentState | undefined {
  if (!run) return undefined;
  if (run.status === 'started') return { kind: 'generating', stage: null };
  if (!pending) return undefined;
  if (run.outcome === 'cancelled') {
    return { kind: 'generation-failed', message: failureWords(run), stopped: true };
  }
  if (run.outcome === 'failed') return { kind: 'generation-failed', message: failureWords(run) };
  return undefined;
}

/**
 * What the run card says beside its indicator while the run's agent is at work, or null when the
 * run is open with no agent at work (waiting for Done). The agent's own lines show below it.
 */
export function runDoing(run: Pick<RunView, 'status' | 'terminal' | 'headless'>): string | null {
  return run.status === 'started' && runRunning(run) ? 'Your agent is making it' : null;
}
