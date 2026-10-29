// The canvas's empty-state actions in the studio's UiHost (ROUGHBOOK-APPLE-PLAN.md, A12 step 1):
// `addPage`, `generateDirections` and `generateInFrame`, over the studio's existing flows. A page
// here is adopted from the app's own pages, so Add a page opens that list (the canvas's sheet);
// Generate is the toolbar's, the canvas's prompt with the component selected. Generate directions
// does that for the first component, and is not offered when there is none, so an empty canvas
// shows Add a page alone.
// No JSX and no React, so the tests can call it.
import { addressFor } from './router.ts';

type Tree = { tree: { pages: { slug: string; components: { slug: string }[] }[] } };

/** A project's first component, by page and component slug, or null when it has none. */
export function firstComponent(project: Tree | null): { page: string; component: string } | null {
  const page = project?.tree.pages.find(item => item.components.length);
  return page ? { page: page.slug, component: page.components[0]!.slug } : null;
}

export type EmptyHostDeps = {
  /** The project's first component (`firstComponent`), or null when it has none. */
  firstComponent: { page: string; component: string } | null;
  navigate: (href: string) => void;
  /** Puts the keyboard in the canvas's prompt, as the toolbar's Generate does. */
  focusPrompt: () => void;
  /** Opens the canvas's list of the app's pages. */
  openPageList: () => void;
};

export function emptyHostActions(deps: EmptyHostDeps) {
  const generate = (page: string, component: string) => {
    deps.navigate(addressFor(`component:${page}/${component}`));
    deps.focusPrompt();
  };
  const first = deps.firstComponent;
  return {
    addPage: (_input: { project: string }) => deps.openPageList(),
    generateInFrame: ({ page, component }: { project: string; page: string; component: string }) =>
      generate(page, component),
    generateDirections: first
      ? (_input: { project: string }) => generate(first.page, first.component)
      : undefined
  };
}

// The canvas owns its sheet of the app's pages; the host asks for it here. Asked with no canvas
// open (as from another screen), the ask waits for the next canvas to listen.
const listeners = new Set<() => void>();
let waiting = false;

/** Asks the canvas for its list of the app's pages: true when an open canvas took it. */
export function requestPageList(): boolean {
  if (!listeners.size) {
    waiting = true;
    return false;
  }
  for (const open of listeners) open();
  return true;
}

/** The canvas listens while it is open; a waiting ask is answered at once. */
export function onPageListRequest(open: () => void): () => void {
  listeners.add(open);
  if (waiting) {
    waiting = false;
    open();
  }
  return () => {
    listeners.delete(open);
  };
}
