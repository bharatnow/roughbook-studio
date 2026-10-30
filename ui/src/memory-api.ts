// What Roughbook learned about the designer and this brand (A10 step 3 of ROUGHBOOK-APPLE-PLAN.md),
// through the local server, which asks `/studio`. Forget is the UI host's `forgetSentence`;
// @roughbook/ui's LearnedSentences takes a forgotten sentence off its list itself.
import type { LearnedSentence } from '@roughbook/ui';
import { Failure, get, post } from './api.ts';

/** The taste screen's lists: the person's sentences, and the linked project's brand's. */
export type Learned = { project: string; you: LearnedSentence[]; brand: LearnedSentence[] };

export function loadLearned(): Promise<Learned> {
  return get<Learned>('/api/learned');
}

/** Said to a viewer, whom the backend refuses these lists. */
export const LEARNED_REFUSED_LINE =
  "Only the project's owners and editors can see what Roughbook learned.";

/** Whether the read failed because this person may not read it, not because something broke. */
export function learnedRefused(error: unknown): boolean {
  return error instanceof Failure && error.status === 403;
}

/** The local server's Forget for a sentence: its scope and id, nothing else. */
export function forgetPath(sentence: Pick<LearnedSentence, 'scope' | 'id'>): string {
  return `/api/learned/${sentence.scope}/${encodeURIComponent(sentence.id)}/forget`;
}

/** Forgets a sentence: its choices are never read again. Answers in words either way. */
export async function forgetSentence(
  sentence: LearnedSentence
): Promise<{ ok: boolean; message: string }> {
  try {
    await post(forgetPath(sentence));
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Failure ? error.message : 'Could not forget it. Try again.'
    };
  }
  return { ok: true, message: 'Forgotten. The choices behind it are never read again.' };
}
