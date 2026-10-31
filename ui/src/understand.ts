// The prompt's `understand` (I1 of the chat audit): a message goes to `POST /api/understand` with
// the current selection's slugs. Anything that goes wrong reads as "this could not be read", which
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
  requestId: null,
  credits: 0,
  upToCredits: 0
};

type Selection = { page: string | null; component: string | null; iteration: string | null };

/** The prompt's reader for this selection; `post` is the local server's call. */
export function understandFrom(
  selection: Selection,
  post: (path: string, body: unknown) => Promise<unknown>
): Understand {
  return async input => {
    try {
      return (await post('/api/understand', { ...selection, ...input })) as Understanding;
    } catch {
      return NOT_READ;
    }
  };
}
