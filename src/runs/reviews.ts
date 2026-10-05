// Review decisions on local iterations: select, reject with a reason, a review with
// observations, notes, or a status. They go to the backend through the outbox, so they are kept while offline and
// reach the server before the next run asks for a prompt, which is where rejection memory works.
import { iterationPath, type RequestBody, type StudioApi } from '../api/client.js';
import type { Outbox } from '../api/outbox.js';
import type { RepoLink } from '../repo/link.js';
import { assertTarget } from './slots.js';

export type ReviewTarget = { page: string; component: string; iteration: string };

export type Decision =
  /** Selects the iteration, or clears the selection when it is already the selected one. */
  | { kind: 'select'; reason?: string }
  /** A preset reason or the designer's own words, and why. */
  | { kind: 'reject'; reason: string; why?: string }
  | {
      kind: 'review';
      decision?: 'explore' | 'refine' | 'select' | 'reject';
      reason?: string;
      observations?: string[];
      /** The review's questions, by key, as on the web. */
      fields?: Record<string, string>;
      /** What the designer looked at, by key. */
      checklist?: Record<string, boolean>;
    }
  /** Compare's likes and dislikes and the designer's notes; each replaces its own part. */
  | { kind: 'notes'; likes?: string[]; dislikes?: string[]; designerNotes?: string }
  /** Promising or archived, or back to exploring. Select and reject have their own kinds. */
  | { kind: 'status'; status: 'draft' | 'exploring' | 'promising' | 'archived' };

function request(decision: Decision): { route: string; body: RequestBody } {
  switch (decision.kind) {
    case 'select':
      return { route: 'select', body: { reason: decision.reason ?? '' } };
    case 'reject':
      return {
        route: 'reject',
        body: { reason: decision.reason, ...(decision.why ? { why: decision.why } : {}) }
      };
    case 'review': {
      const { kind: _kind, ...review } = decision;
      return { route: 'reviews', body: review };
    }
    case 'notes': {
      const { kind: _kind, ...notes } = decision;
      return { route: 'feedback', body: notes };
    }
    case 'status':
      return { route: 'status', body: { status: decision.status } };
  }
}

/** Sends one decision with the server's answer, or queues it when the server cannot be reached. */
export async function sendDecision(
  api: StudioApi,
  outbox: Outbox,
  link: RepoLink,
  target: ReviewTarget,
  decision: Decision
): Promise<{ status: 'sent'; data: unknown } | { status: 'queued' }> {
  assertTarget(target.page, target.component, target.iteration);
  const { route, body } = request(decision);
  const path = `${iterationPath(link.orgId, link.project, target.page, target.component, target.iteration)}/${route}`;
  return outbox.send(api, path, body);
}
