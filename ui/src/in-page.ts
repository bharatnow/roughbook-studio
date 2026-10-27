// The in-page view in the local UI (B5 of ROUGHBOOK-BROWNFIELD-PLAN.md): an iteration of an adopted
// component shown in its real page beside Alone, and an adopted page's own view with its markers,
// where Pick selects the clicked section on the canvas. The studio's server says where each is on
// the app (`local.inPage`); these turn that into the frame's addresses and the canvas's.
import { addressFor } from './router.ts';
import type { ProjectView } from './types.ts';

type Local = Pick<ProjectView['local'], 'inPage' | 'inPageNote'>;

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

/** What the in-page view covers on this stack, beside In its page where the frame offers it. */
export function inPageNote(local: Local, key: string): string | null {
  return local.inPage?.[key] ? (local.inPageNote ?? null) : null;
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

/**
 * Turbopack's lost lazy import (B7b of the brownfield plan, decision 68): the app's dev server
 * restarted onto its old development cache. The server's words, for the notice when a preview
 * posts the error itself (the server says it from the app's log when the studio started the app).
 */
export const LAZY_IMPORT_NOTICE = `"Lazily compiled dynamic import … was not activated" is Turbopack losing a module it compiles only when a page asks for it, most often after the app's dev server restarted onto its old development cache with files changed while it was down. Restart the app's dev server, then ask again. If the repo's switch is behind, roughbook setup --upgrade turns that cache off so it does not happen again.`;

/** The notice for a message a preview posted, when its error is Turbopack's lost lazy import; null otherwise. */
export function lazyImportNotice(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { roughbook, message } = data as { roughbook?: unknown; message?: unknown };
  return roughbook === 'error' &&
    typeof message === 'string' &&
    message.includes('Lazily compiled dynamic import') &&
    message.includes('was not activated')
    ? LAZY_IMPORT_NOTICE
    : null;
}
