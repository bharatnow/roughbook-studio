// The prompt's `understand` (I1 of the chat audit): a message goes to `POST /api/understand` with
// the current selection's slugs, saying the page has the fact sheet (U5 of the fact-change plan). Anything that goes wrong reads as "this could not be read", which
// PromptBar shows with Draw anyway, so a failed read never loses the words or blocks a run.
import type { Understand, Understanding } from '@roughbook/ui';

/** The answer for a read that failed, as the backend's own `read: false`. Nothing is charged. */
export const NOT_READ: Understanding = {
  read: false,
  intent: 'unclear',
  target: null,
  targetName: null,
  directions: [],
  instructions: '',
  assumptions: [],
  confidence: 'low',
  question: null,
  reply: null,
  rule: null,
  ruleScope: null,
  requestId: null,
  credits: 0,
  upToCredits: 0
};

type Selection = { page: string | null; component: string | null; iteration: string | null };

/**
 * The prompt's reader for this selection; `post` is the local server's call. `onKept` hears of a
 * message that left a line in the record, which the history then reads at once.
 */
export function understandFrom(
  selection: Selection,
  post: (path: string, body: unknown) => Promise<unknown>,
  onKept?: () => void
): Understand {
  return async input => {
    try {
      // This host has the fact sheet (U5), so a change of a fact may be read as `fact`.
      const reading = (await post('/api/understand', {
        ...selection,
        ...input,
        facts: true
      })) as Understanding;
      if (reading.requestId) onKept?.();
      return reading;
    } catch {
      return NOT_READ;
    }
  };
}
