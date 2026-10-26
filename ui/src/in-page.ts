// The in-page view in the local UI (B5 of ROUGHBOOK-BROWNFIELD-PLAN.md): an iteration of an adopted
// component shown in its real page beside Alone, and an adopted page's own view with its markers,
// where Pick selects the clicked section on the canvas. The studio's server says where each is on
// the app (`local.inPage`); these turn that into the frame's addresses and the canvas's.
import { addressFor } from './router.ts';
import type { ProjectView } from './types.ts';

type Local = Pick<ProjectView['local'], 'inPage'>;

/** An address on the app, on the dev server the frame asks: null without one. */
function onApp(address: string | undefined, devUrl: string): string | null {
  if (!address) return null;
  try {
    return new URL(address, devUrl.endsWith('/') ? devUrl : `${devUrl}/`).toString();
  } catch {
    return null;
  }
}

/** The page with `key` (`<page>/<component>/<iteration>`) swapped in, for In its page; null when not offered. */
export function inPageSrc(local: Local, devUrl: string, key: string): string | null {
  return onApp(local.inPage?.[key], devUrl);
}

/** An adopted page's own view, with its markers; null when the page has none here. */
export function pageViewSrc(local: Local, devUrl: string, page: string): string | null {
  return onApp(local.inPage?.[page], devUrl);
}

/** The pages with a view of their own here, for the canvas's In the app action. */
export function pagesWithView(local: Local): string[] {
  return Object.keys(local.inPage ?? {}).filter(key => !key.includes('/'));
}

/** Where an adopted page's own view is in the local UI. */
export function pageViewAddress(page: string): string {
  return `/${encodeURIComponent(page)}?view=page`;
}

/**
 * The canvas's address for the section a click on the page picked, `<page>/<component>` as its
 * marker names it: the canvas with that component selected. Null for anything else.
 */
export function pickedAddress(key: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)
    ? addressFor(`component:${key}`)
    : null;
}
