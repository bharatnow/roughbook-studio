// The plain verbs, run on this machine (ROUGHBOOK-APPLE-PLAN.md, A7 steps 3 and 5): More like
// this, Something different and Polish start runs as the canvas's Fork and Refine do; Not this and
// Pick this one decide at once, through the outbox like any decision. What's wrong? is for web
// sketches (decision 41) and Use in my code is the canvas's Promote, so neither is served here.
//
// Each verb answers `{ ok, message, made, undo }`, and `undo` takes it back (decision 33): Not this
// is unrejected and a pick goes back to what was picked before, through `/studio` routes; a run
// is cancelled when its agent has not started, otherwise stopped, and either way its iteration is
// archived. The studio never deletes files an agent wrote in rough/.
import type { Decision, ReviewTarget } from '../runs/reviews.js';
import { assertTarget } from '../runs/slots.js';
import type { Launched, LocalStudio, RunBody, RunView } from './studio.js';

export type ServedVerb = 'more' | 'different' | 'polish' | 'not-this' | 'pick-this';

/** The verbs this server runs, in the toolbar's order. */
export const STUDIO_SERVED_VERBS: readonly ServedVerb[] = [
  'more',
  'different',
  'polish',
  'not-this',
  'pick-this'
];

/** Each verb's words, as the Undo bar says them ("Undo Not this"); @roughbook/ui's VERB_LABELS. */
const LABELS: Record<ServedVerb, string> = {
  more: 'More like this',
  different: 'Something different',
  polish: 'Polish',
  'not-this': 'Not this',
  'pick-this': 'Pick this one'
};

type HowFar = 'conservative' | 'balanced' | 'high' | 'wild';

/**
 * How far Something different goes. A local fork has no strength, only a clean start, so the
 * nearer two are forks that say how far, and the farther two start clean.
 */
const HOW_FAR: Record<HowFar, { radical: boolean; change: string | null }> = {
  conservative: {
    radical: false,
    change: 'Make it a little different: the same idea, a new take on its layout and details.'
  },
  balanced: {
    radical: false,
    change: 'Make it quite different: keep the brief, change the layout, type scale and imagery.'
  },
  high: { radical: true, change: null },
  wild: {
    radical: true,
    change: 'Make it wildly different: an approach the earlier iterations have not tried.'
  }
};

/** The polish preset's focus, as the backend's methods catalog says it. */
const POLISH_FOCUS =
  'Finish a structurally settled iteration to a measurable craft floor: alignment, consistent sizes, radii, shadows, heading spacing and wraps, focus rings and selection, changing only those details with existing tokens.';

/** The reasons Not this posts at once; "Custom" sends the designer's own words. */
const CUSTOM = 'Custom';

export type VerbAnswer =
  | { kind: 'run'; body: RunBody }
  | { kind: 'decide'; decision: Decision }
  | { kind: 'refused'; message: string };

function field(fields: Record<string, unknown>, name: string): string {
  const value = fields[name];
  return typeof value === 'string' ? value.trim() : '';
}

/** Where a run goes: the page's agent and terminal when it says, interactive here by default. */
function runPlace(fields: Record<string, unknown>) {
  const mode = field(fields, 'mode');
  const terminal = field(fields, 'terminal');
  const agent = field(fields, 'agent');
  const cols = Number(fields.cols);
  const rows = Number(fields.rows);
  return {
    ...(agent ? { agent } : {}),
    mode: (mode === 'headless' || mode === 'editor' ? mode : 'interactive') as RunBody['mode'],
    ...(terminal === 'external' || terminal === 'builtin'
      ? { terminal: terminal as 'external' | 'builtin' }
      : {}),
    ...(Number.isInteger(cols) && cols > 0 ? { cols } : {}),
    ...(Number.isInteger(rows) && rows > 0 ? { rows } : {})
  };
}

/** What a verb asks of the studio, or why it cannot be done here. */
export function verbRun(
  verb: string,
  target: ReviewTarget,
  fields: Record<string, unknown>
): VerbAnswer {
  const at = { page: target.page, component: target.component, ...runPlace(fields) };
  switch (verb) {
    case 'more': {
      const words = field(fields, 'words');
      return {
        kind: 'run',
        body: {
          ...at,
          kind: 'fork',
          parent: target.iteration,
          ...(words ? { intent: { remain: [], change: words } } : {})
        }
      };
    }
    case 'different': {
      const asked = field(fields, 'howFar') as HowFar;
      const far = HOW_FAR[asked] ?? HOW_FAR.high;
      return {
        kind: 'run',
        body: {
          ...at,
          kind: 'fork',
          parent: target.iteration,
          ...(far.change ? { intent: { remain: [], change: far.change } } : {}),
          ...(far.radical ? { radical: true } : {})
        }
      };
    }
    case 'polish':
      return {
        kind: 'run',
        body: {
          ...at,
          kind: 'refine',
          parent: target.iteration,
          preset: 'polish',
          intent: POLISH_FOCUS
        }
      };
    case 'not-this': {
      const preset = field(fields, 'reasonPreset');
      const reason = preset === CUSTOM ? field(fields, 'reasonCustom') : preset;
      if (!reason)
        return { kind: 'refused', message: 'Say why: choose a reason or write your own.' };
      if (reason.length > 500)
        return { kind: 'refused', message: 'Say why in 500 characters or fewer.' };
      return { kind: 'decide', decision: { kind: 'reject', reason } };
    }
    case 'pick-this':
      return { kind: 'decide', decision: { kind: 'select', reason: field(fields, 'reason') } };
    case 'wrong':
      return {
        kind: 'refused',
        message: "What's wrong? reads web sketches. Review this one here, or ask your agent."
      };
    case 'use':
      return { kind: 'refused', message: 'Use in my code is Promote here: open it on the canvas.' };
    default:
      return { kind: 'refused', message: 'That is not something the studio does to an iteration.' };
  }
}

/**
 * How Undo takes back a local run: cancelled when its agent has not started (no session or
 * unattended job here), stopped when it has, and left as it is once finished. Its iteration is
 * archived in every case.
 */
export function undoRunPlan(run: RunView | undefined): 'cancel' | 'stop' | 'archive' {
  if (!run || run.status !== 'started') return 'archive';
  return run.terminal || run.headless ? 'stop' : 'cancel';
}

/** Where a run's agent went, in words. */
export function launchWords(launched: Launched): string {
  switch (launched.kind) {
    case 'builtin':
      return 'Its agent is at work in the terminal below.';
    case 'external':
      return `Its agent is at work in ${launched.terminal}.`;
    case 'headless':
      return 'Its agent is at work unattended.';
    case 'manual':
      return `${launched.reason} Run this in a terminal: ${launched.commands.join(' ; ')}`;
    default:
      return 'Its prompt is open in your editor; its agent starts from there.';
  }
}

function made(verb: 'more' | 'different' | 'polish', from: string, iteration: string | undefined) {
  const what =
    verb === 'more'
      ? `Making one more like ${from}`
      : verb === 'different'
        ? `Making something different from ${from}`
        : `Polishing ${from}`;
  return iteration ? `${what} as ${iteration}.` : `${what}.`;
}

/** What the local UI may run the verbs through: the studio's own runs and decisions. */
export type VerbStudio = Pick<LocalStudio, 'startRuns' | 'runs' | 'stopRun' | 'done' | 'decide'>;

type UndoBody = {
  kind?: unknown;
  label?: unknown;
  target?: { project?: unknown; page?: unknown; component?: unknown; iteration?: unknown };
  status?: unknown;
};

type Result = {
  ok: boolean;
  message: string;
  made?: string[];
  undo?: {
    kind: 'unreject' | 'discard' | 'unselect';
    label: string;
    target: { project: string; page: string; component: string; iteration: string };
  } | null;
};

function readTarget(value: UndoBody['target']): ReviewTarget | null {
  if (!value || typeof value !== 'object') return null;
  const goal = {
    page: String(value.page ?? ''),
    component: String(value.component ?? ''),
    iteration: String(value.iteration ?? '')
  };
  try {
    assertTarget(goal.page, goal.component, goal.iteration);
  } catch {
    return null;
  }
  return goal;
}

function failed(error: unknown): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : String(error) };
}

/**
 * The verbs' local routes. Registered in app.ts beside the others:
 *
 *   ...verbRoutes(studio).map(item =>
 *     route(item.method, item.path, async (request, params) =>
 *       item.handle(params, await readBody(request))
 *     )
 *   ),
 *
 * A verb's body is its fields (`howFar`, `words`, `reasonPreset`, `reasonCustom`, `reason`), the
 * project's slug for the answer's undo, `previous` (the component's pick before Pick this one),
 * and where a run goes (`agent`, `mode`, `terminal`, `cols`, `rows`). Undo's body is the `undo`
 * the verb answered. A refusal is an answer with `ok: false`, not an error, so the page says it.
 */
export function verbRoutes(studio: VerbStudio): {
  method: 'POST';
  path: string;
  handle: (params: Record<string, string>, body: Record<string, unknown>) => Promise<Result>;
}[] {
  return [
    {
      method: 'POST',
      path: '/api/iterations/:page/:component/:iteration/verbs/:verb',
      handle: async (params, body) => {
        const goal = readTarget(params);
        const verb = params.verb ?? '';
        if (!goal) return { ok: false, message: 'Name the iteration.' };
        const project = field(body, 'project');
        const undoTarget = (iteration: string) => ({ project, ...goal, iteration });
        const answer = verbRun(verb, goal, body);
        if (answer.kind === 'refused') return { ok: false, message: answer.message };
        try {
          if (answer.kind === 'run') {
            const started = await studio.startRuns(answer.body);
            const ids = started.runs.map(item => item.iteration);
            const first = ids[0];
            return {
              ok: true,
              message: `${made(verb as 'more', goal.iteration, first)} ${launchWords(started.launched)}`,
              made: ids,
              undo: first
                ? { kind: 'discard', label: LABELS[verb as ServedVerb], target: undoTarget(first) }
                : null
            };
          }
          if (answer.decision.kind === 'select') {
            const previous = field(body, 'previous');
            // Selecting the pick again would clear it: Pick this one leaves it as it is.
            if (previous === goal.iteration) {
              return { ok: true, message: `${goal.iteration} is the pick already.`, undo: null };
            }
            const { status } = await studio.decide(goal, answer.decision);
            return {
              ok: true,
              message: `Picked ${goal.iteration}.${queued(status)}`,
              // Selecting the earlier pick again restores it; with none, selecting this clears it.
              undo: {
                kind: 'unselect',
                label: LABELS['pick-this'],
                target: undoTarget(previous || goal.iteration)
              }
            };
          }
          const { status } = await studio.decide(goal, answer.decision);
          const reason = answer.decision.kind === 'reject' ? answer.decision.reason : '';
          return {
            ok: true,
            message: `Set ${goal.iteration} aside: ${reason}.${queued(status)}`,
            undo: {
              kind: 'unreject',
              label: LABELS['not-this'],
              target: undoTarget(goal.iteration)
            }
          };
        } catch (error) {
          return failed(error);
        }
      }
    },
    {
      method: 'POST',
      path: '/api/verbs/undo',
      handle: async (_params, body: UndoBody) => {
        const goal = readTarget(body.target);
        if (!goal) return { ok: false, message: 'That undo names no iteration.' };
        const label = typeof body.label === 'string' && body.label ? body.label : 'it';
        try {
          switch (body.kind) {
            case 'unreject':
              await studio.decide(goal, {
                kind: 'unreject',
                ...(typeof body.status === 'string' && body.status ? { status: body.status } : {})
              });
              break;
            case 'unselect':
              await studio.decide(goal, { kind: 'select', reason: '' });
              break;
            case 'discard': {
              const run = (await studio.runs())
                .filter(
                  item =>
                    item.page === goal.page &&
                    item.component === goal.component &&
                    item.iteration === goal.iteration
                )
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
              const plan = undoRunPlan(run);
              if (plan === 'cancel') await studio.done(run!.runId, 'cancelled');
              if (plan === 'stop') studio.stopRun(run!.runId);
              await studio.decide(goal, { kind: 'discard' });
              break;
            }
            default:
              return { ok: false, message: 'The studio cannot take that back.' };
          }
        } catch (error) {
          return failed(error);
        }
        return { ok: true, message: `Took back ${label}.` };
      }
    }
  ];
}

/** Said after a decision the server could not be reached for. */
function queued(status: 'sent' | 'queued'): string {
  return status === 'queued' ? ' It waits in the outbox until the server can be reached.' : '';
}
