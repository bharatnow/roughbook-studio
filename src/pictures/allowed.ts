// Which pictures may go up (decisions 7, 21, 23 and 28 of ROUGHBOOK-BROWNFIELD-PLAN.md): those of
// a studio iteration (`local`) or a baseline (`app`), and of a page adopted from the app, while the
// project's `pictures` setting is on. Never a web sketch's, never a page nobody adopted, and never
// any other screenshot the studio takes. Checked against the project as the backend has it now,
// before each picture is sent, so a setting turned off since a picture was queued still holds.
import type { PictureKind, ProjectTree } from '../api/types.js';

/** What one picture shows: an iteration, or an adopted page when it names no component. */
export type PictureTarget = {
  orgId: string;
  project: string;
  page: string;
  component?: string;
  iteration?: string;
  kind: PictureKind;
};

export type PictureRefusal = 'PICTURES_OFF' | 'NOT_A_STUDIO_ITERATION' | 'PAGE_NOT_IN_APP';

/** Why the project takes no picture of `target` now, or null when it does. */
export function pictureRefusal(
  tree: Pick<ProjectTree, 'pages' | 'pictures'>,
  target: Pick<PictureTarget, 'page' | 'component' | 'iteration'>
): PictureRefusal | null {
  if (tree.pictures === false) return 'PICTURES_OFF';
  const page = (tree.pages ?? []).find(item => item.slug === target.page);
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
