// The studio's navigation line (reports/Pending feedback audit.md, "Studio"): when a hash link,
// `navigate()` or a hash change opens another screen, and when that screen has arrived with its
// data. Pure, so node --test can reach it; the line itself is parts/navigation-line.tsx.

/** The parts of a click the filter reads. */
export type ClickLike = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
};

/** The parts of an `<a>` the filter reads: `href` as written, so a fragment stays one. */
export type AnchorLike = {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
};

/**
 * The fragment a click on this link would open, or null when the browser goes elsewhere or not
 * at all: cancelled (the skip link moves focus instead), not the main button or with a modifier
 * (a tab or a window), into another window, a download, opted out with `data-no-progress`, or not
 * a fragment of this page (the web, the privacy page).
 */
export function clickedHash(click: ClickLike, anchor: AnchorLike): string | null {
  if (click.defaultPrevented) return null;
  if (click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  const target = (anchor.getAttribute('target') ?? '').trim().toLowerCase();
  if (target && target !== '_self') return null;
  if (anchor.hasAttribute('download') || anchor.hasAttribute('data-no-progress')) return null;
  const href = anchor.getAttribute('href') ?? '';
  return href.startsWith('#') ? href : null;
}

/** The fragment of an address, as `HashChangeEvent`'s `oldURL` and `newURL` give it. */
export function hashOf(url: string): string {
  const at = url.indexOf('#');
  return at === -1 ? '' : url.slice(at);
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * The line's one fact, whether a navigation is under way, kept outside React so a start draws
 * before the route's transition renders. Screens are compared by key (`routeKey` in router.ts).
 *
 * - `go(key, here)` starts it for a screen other than the one shown (`current`) and the one the
 *   address already names (`here`: the canvas rewrites the address as its selection moves,
 *   without a hash change, so the two can differ).
 * - `arrive(key)` says the screen rendered. It finishes then, unless a placeholder holds it.
 * - `hold()` is a placeholder waiting for its data; its release finishes an arrived navigation
 *   once nothing else holds it.
 *
 * It also finishes by itself after `timeoutMs`, so a navigation that never arrives cannot leave
 * the line running.
 */
export function createNavigationProgress({
  timeoutMs = 15_000,
  setTimer = (run: () => void, ms: number) => setTimeout(run, ms),
  clearTimer = (timer: Timer) => clearTimeout(timer)
}: {
  timeoutMs?: number;
  setTimer?: (run: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
} = {}) {
  let active = false;
  let arrived = false;
  let holds = 0;
  let current: string | null = null;
  let timer: Timer | null = null;
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }
  function disarm() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function finish() {
    disarm();
    arrived = false;
    if (!active) return;
    active = false;
    emit();
  }
  function start() {
    disarm();
    timer = setTimer(finish, timeoutMs);
    arrived = false;
    if (active) return;
    active = true;
    emit();
  }

  return {
    /** Starts the line when `key` is another screen; true when it did. */
    go(key: string, here?: string): boolean {
      if (key === current || (here !== undefined && key === here)) return false;
      start();
      return true;
    },
    arrive(key: string) {
      current = key;
      if (!active) return;
      if (holds === 0) finish();
      else arrived = true;
    },
    hold(): () => void {
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (active && arrived && holds === 0) finish();
      };
    },
    finish,
    isActive: () => active,
    current: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }
  };
}

export type NavigationProgress = ReturnType<typeof createNavigationProgress>;

/** The app's one line, which `navigate()`, the links and the placeholders all reach. */
export const appNavigation = createNavigationProgress();
