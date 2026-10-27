// The cards the canvas shows (decision 65 of ROUGHBOOK-BROWNFIELD-PLAN.md): the local server
// takes their pictures first, so the canvas tells it which are on screen whenever that changes.
// Card keys only; the canvas draws only what is near the screen, so the elements are few.
import { useEffect, useRef } from 'react';
import { post } from './api';

/** At most this many cards are named at once, as the server takes them. */
export const SHOWN_MAX = 200;
/** How long the view must be still before the server hears what it shows. */
const SETTLE_MS = 400;

type Box = { top: number; left: number; bottom: number; right: number };

/**
 * The keys of the cards at least partly inside the viewport, top to bottom and left to right,
 * each once, at most SHOWN_MAX. Pure: the hook below measures the elements.
 */
export function shownCards(
  cards: { key: string; box: Box }[],
  viewport: { width: number; height: number }
): string[] {
  const seen = new Set<string>();
  return cards
    .filter(
      ({ box }) =>
        box.bottom > 0 &&
        box.right > 0 &&
        box.top < viewport.height &&
        box.left < viewport.width &&
        box.bottom > box.top
    )
    .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
    .map(card => card.key)
    .filter(key => !seen.has(key) && (seen.add(key), true))
    .slice(0, SHOWN_MAX);
}

/** Whether a change feed's keys say some card's pictures were taken. */
export function picturesChanged(keys: string[]): boolean {
  return keys.some(key => key.endsWith('#images'));
}

/**
 * Tells the server which cards are on screen: once the view has been still for a moment after
 * `version` changes (a pan, a zoom, new cards) or the window scrolls or resizes, and only when
 * the set changed.
 */
export function useShownCards(version: unknown): () => void {
  const last = useRef('');
  const timer = useRef<number | null>(null);
  const measure = useRef(() => {});
  measure.current = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (document.visibilityState === 'hidden') return;
      const elements = document.querySelectorAll<HTMLElement>(
        '[data-studio-canvas] [data-canvas-key^="iteration:"]'
      );
      const keys = shownCards(
        [...elements].map(element => ({
          key: element.getAttribute('data-canvas-key')!,
          box: element.getBoundingClientRect()
        })),
        { width: window.innerWidth, height: window.innerHeight }
      );
      const said = keys.join('\n');
      if (said === last.current) return;
      last.current = said;
      // Pictures are a nicety: the canvas works the same without them.
      post('/api/pictures/shown', { cards: keys }).catch(() => (last.current = ''));
    }, SETTLE_MS);
  };
  useEffect(() => {
    measure.current();
  }, [version]);
  useEffect(() => {
    const changed = () => measure.current();
    window.addEventListener('scroll', changed, { capture: true, passive: true });
    window.addEventListener('resize', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      window.removeEventListener('scroll', changed, { capture: true });
      window.removeEventListener('resize', changed);
      document.removeEventListener('visibilitychange', changed);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);
  return () => measure.current();
}
