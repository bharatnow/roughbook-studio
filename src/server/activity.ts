// What the open runs' agents are doing, for the status button (A8 step 5 of
// ROUGHBOOK-APPLE-PLAN.md). Pure: the runs, their sessions' activity from Terminals, and the time.
// "Waiting" is read from silence plus terminal bells (decision 37): a bell, OSC 9 or OSC 777 since
// the last keystroke is attention; a session silent for QUIET_MS may be waiting for the designer.
import type { RunMode, RunRecord } from '../runs/types.js';

/** What Terminals knows of one session's output. */
export type TerminalActivity = {
  id: string;
  runId: string | null;
  status: 'running' | 'exited';
  /** When it started, in ms: its silence counts from here until it first prints. */
  startedAt: number;
  /** When it last printed, in ms, or null before it first prints. */
  lastOutputAt: number | null;
  /** A bell, OSC 9 or OSC 777 since the last keystroke. */
  bell: boolean;
};

export type ActivityRun = Pick<RunRecord, 'runId' | 'status'> & {
  mode: RunMode;
  /** The studio's own unattended job for the run, if it has one. */
  headless: { status: 'running' | 'finished' } | null;
};

export type ActivityState = 'idle' | 'working' | 'waiting' | 'attention';

export type Activity = {
  state: ActivityState;
  /**
   * Where the run it is about lives: the built-in terminal, the studio's unattended job, or the
   * designer's own terminal or editor, which the studio cannot hear (always idle).
   */
  where: 'builtin' | 'headless' | 'terminal' | 'editor' | null;
  runId: string | null;
};

/** How long a working agent's session may print nothing before it may be waiting. */
export const QUIET_MS = 15_000;

const RANK: Record<ActivityState, number> = { idle: 0, working: 1, waiting: 2, attention: 3 };

export function activityOf(
  runs: ActivityRun[],
  terminals: TerminalActivity[],
  state: { now: number; quietMs?: number }
): Activity {
  const quiet = state.quietMs ?? QUIET_MS;
  let heard: Activity | null = null;
  let elsewhere: Activity | null = null;
  const consider = (activity: Activity) => {
    if (!heard || RANK[activity.state] > RANK[heard.state]) heard = activity;
  };
  for (const run of runs) {
    if (run.status !== 'started') continue;
    const sessions = terminals.filter(item => item.runId === run.runId);
    if (sessions.length) {
      for (const session of sessions) {
        if (session.status !== 'running') continue;
        const since = state.now - (session.lastOutputAt ?? session.startedAt);
        const word: ActivityState = session.bell
          ? 'attention'
          : since >= quiet
            ? 'waiting'
            : 'working';
        consider({ state: word, where: 'builtin', runId: run.runId });
      }
    } else if (run.headless) {
      if (run.headless.status === 'running') {
        consider({ state: 'working', where: 'headless', runId: run.runId });
      }
    } else if (!elsewhere && (run.mode === 'interactive' || run.mode === 'editor')) {
      elsewhere = {
        state: 'idle',
        where: run.mode === 'editor' ? 'editor' : 'terminal',
        runId: run.runId
      };
    }
  }
  return heard ?? elsewhere ?? { state: 'idle', where: null, runId: null };
}
