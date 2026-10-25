// What a fork is asked to do (B3): what it changes, what it keeps as the parent has it, and
// whether it starts clean. The CLI's `--intent`, `--keep` and `--radical` and the local UI's Fork
// both go through here, so the backend gets the same fields from either.
import type { ForkIntent } from './types.js';

/**
 * The most things one fork is asked to keep, and how long each and the change may be: the
 * backend's limits for a fork, as a web fork has them, said here before anything is posted.
 */
export const MAX_KEPT = 12;
export const KEPT_LENGTH = 80;
export const CHANGE_LENGTH = 2000;

/** A fork's fields for `POST /runs`, from what the designer wrote; throws in words for them. */
export function forkFields(input: {
  change?: string | null;
  remain?: readonly string[] | null;
  radical?: boolean | null;
}): { intent?: ForkIntent; radical?: true } {
  const change = (input.change ?? '').trim();
  const remain = [...new Set((input.remain ?? []).map(item => item.trim()).filter(Boolean))];
  if (remain.length > MAX_KEPT)
    throw new Error(
      `Keep at most ${MAX_KEPT} things in one fork; this one lists ${remain.length}.`
    );
  if (remain.some(item => item.length > KEPT_LENGTH)) {
    throw new Error(`Say each thing to keep in ${KEPT_LENGTH} characters or fewer.`);
  }
  if (change.length > CHANGE_LENGTH) {
    throw new Error(`Say what to change in ${CHANGE_LENGTH} characters or fewer.`);
  }
  if (remain.length && !change) {
    throw new Error('Say what the fork changes beside what it keeps.');
  }
  return {
    ...(change ? { intent: { remain, change } } : {}),
    ...(input.radical ? { radical: true as const } : {})
  };
}

/** A comma-separated `--keep` list. */
export function keptList(text: string | undefined): string[] {
  return (text ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}
