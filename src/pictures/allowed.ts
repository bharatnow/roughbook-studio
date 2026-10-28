// Which pictures may go up (decisions 7, 21, 23 and 28 of ROUGHBOOK-BROWNFIELD-PLAN.md): those of
// a studio iteration (`local`) or a baseline (`app`), of a page adopted from the app, and of a
// page's composition made in a studio (B6), once the project's `pictures` answer is yes (decision
// 25 of ROUGHBOOK-APPLE-PLAN.md; while nobody has answered they are kept here). Never a web
// sketch's, never a page nobody adopted, and never any other screenshot the studio takes. Checked
// against the project as the backend has it now, before each picture is sent, so a setting turned
// off since a picture was queued still holds.
import type { PictureKind, ProjectTree } from '../api/types.js';

/**
 * What one picture shows: an iteration, a page's composition made here (B6), or an adopted page
 * when it names neither.
 */
export type PictureTarget = {
  orgId: string;
  project: string;
  page: string;
  component?: string;
  iteration?: string;
  composition?: string;
  kind: PictureKind;
};

/**
 * Why a picture does not go up. `PICTURES_UNASKED` alone is not for good: nobody has answered the
 * project's pictures question yet (decision 25 of the Apple plan), so the picture is kept here,
 * waiting in the outbox, and goes after a yes.
 */
export type PictureRefusal =
  'PICTURES_OFF' | 'PICTURES_UNASKED' | 'NOT_A_STUDIO_ITERATION' | 'PAGE_NOT_IN_APP';

/** Why the project takes no picture of `target` now, or null when it does. */
export function pictureRefusal(
  tree: Pick<ProjectTree, 'pages' | 'pictures'>,
  target: Pick<PictureTarget, 'page' | 'component' | 'iteration' | 'composition'>
): PictureRefusal | null {
  if (tree.pictures === false) return 'PICTURES_OFF';
  const refusal = subjectRefusal(tree, target);
  // Only a picture the project would take waits for the answer.
  if (refusal) return refusal;
  return tree.pictures === null ? 'PICTURES_UNASKED' : null;
}

/** Why the project takes no picture of this subject at all, whatever the answer. */
function subjectRefusal(
  tree: Pick<ProjectTree, 'pages'>,
  target: Pick<PictureTarget, 'page' | 'component' | 'iteration' | 'composition'>
): PictureRefusal | null {
  const page = (tree.pages ?? []).find(item => item.slug === target.page);
  // A composition is made only of the page's records, so the page is the project's.
  if (target.composition) return page ? null : 'PAGE_NOT_IN_APP';
  if (!target.component || !target.iteration) {
    return page?.inApp ? null : 'PAGE_NOT_IN_APP';
  }
  const iteration = page?.components
    .find(item => item.slug === target.component)
    ?.iterations.find(item => item.id === target.iteration);
  // A backend that does not say an iteration's origin takes no pictures either.
  return iteration?.origin === 'local' || iteration?.origin === 'app'
    ? null
    : 'NOT_A_STUDIO_ITERATION';
}
