// The plain verbs in the studio's UiHost (ROUGHBOOK-APPLE-PLAN.md, A7): `runVerb`, `verbs` and
// `undoVerb`, sent to the local server's verb routes (src/server/verbs.ts). Spread into the host's
// actions: `actions: { ...verbHostActions({ post, project: () => project, refresh }), … }`.
// No JSX and no React, so the tests can call it.
import type { IterationTarget, VerbId, VerbResult, VerbUndo } from '@roughbook/ui';
import { iterationPath } from './api.ts';
import type { ProjectView } from './types.ts';

/** The verbs `runVerb` runs here: What's wrong? is for web sketches (decision 41), and Use in my
 * code is the canvas's Promote. */
export const HOST_VERBS: readonly VerbId[] = [
  'more',
  'different',
  'polish',
  'not-this',
  'pick-this'
];

/** Where a run goes, as the page's run options say it; the server's defaults when left out. */
export type RunPlace = {
  agent?: string;
  mode?: 'interactive' | 'headless' | 'editor';
  terminal?: 'builtin' | 'external';
};

/** The component's pick now, by id, or null. */
export function currentPick(
  project: ProjectView | null,
  page: string,
  component: string
): string | null {
  const found = project?.tree.pages
    .find(item => item.slug === page)
    ?.components.find(item => item.slug === component);
  if (!found || found.selectedIteration === null) return null;
  return found.iterations.find(item => item.number === found.selectedIteration)?.id ?? null;
}

function words(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The studio did not answer.';
}

export function verbHostActions(deps: {
  post: <T>(path: string, body?: unknown) => Promise<T>;
  /** The project as last read, for the pick before Pick this one. */
  project: () => ProjectView | null;
  /** Reads the project again after a verb changed it. */
  refresh: () => Promise<void>;
  /** Where a run goes, from the run options; the server's defaults when left out. */
  place?: () => RunPlace;
}): {
  runVerb: (
    verb: VerbId,
    target: IterationTarget,
    fields?: Record<string, string>
  ) => Promise<VerbResult>;
  verbs: readonly VerbId[];
  undoVerb: (undo: VerbUndo) => Promise<{ ok: boolean; message: string }>;
} {
  return {
    verbs: HOST_VERBS,
    runVerb: async (verb, target, fields = {}) => {
      if (!HOST_VERBS.includes(verb)) {
        return { ok: false, message: 'The studio does not do that to an iteration.', undo: null };
      }
      const previous =
        verb === 'pick-this' ? currentPick(deps.project(), target.page, target.component) : null;
      let result: VerbResult;
      try {
        result = await deps.post<VerbResult>(
          `${iterationPath(target.page, target.component, target.iteration)}/verbs/${encodeURIComponent(verb)}`,
          {
            ...fields,
            project: target.project,
            ...(previous ? { previous } : {}),
            ...(deps.place?.() ?? {})
          }
        );
      } catch (error) {
        return { ok: false, message: words(error), undo: null };
      }
      if (result.ok) await deps.refresh();
      return result;
    },
    undoVerb: async undo => {
      let result: { ok: boolean; message: string };
      try {
        result = await deps.post<{ ok: boolean; message: string }>('/api/verbs/undo', undo);
      } catch (error) {
        return { ok: false, message: words(error) };
      }
      if (result.ok) await deps.refresh();
      return result;
    }
  };
}
