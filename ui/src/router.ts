import { focusForKey, focusFromPath, pathForFocus, type CanvasFocus } from '@roughbook/ui/canvas';
import { useEffect, useState } from 'react';

// Screens live in the address's fragment, with the web's paths: a component's base is
// /<page>/<component>, so @roughbook/ui's links (`${base}/iterations`, `${base}/<iteration>`,
// `${base}/iterations/compare?ids=`) land on the same screens here. The project, a page, a
// component and its iterations are the canvas focused on them (ROUGHBOOK-QUIET-UI-PLAN.md, U5);
// a card is its iterations' address with the card after a second `#`, as on the web.

export type Route =
  /** `session`: a terminal to show in the dock, from the address its own screen had. */
  | { screen: 'canvas'; focus: CanvasFocus; session?: string }
  | { screen: 'compare'; page: string; component: string; ids: string[] }
  | { screen: 'iteration'; page: string; component: string; iteration: string; refine: boolean }
  /** An adopted page's own view in the app, with its markers (B5): `/<page>?view=page`. */
  | { screen: 'page'; page: string }
  /** A page's composition editor (B6): `/<page>/compose`, from a composition with `?from=`. */
  | { screen: 'compose'; page: string; from: string | null }
  /** A page's composition's own view (B6): `/<page>/compositions/<composition>`. */
  | { screen: 'composition'; page: string; id: string }
  | { screen: 'missing' };

const ITERATION = /^iteration-\d{2,}$/;
const COMPOSITION = /^composition-\d{2,}$/;

export function parseRoute(hash: string): Route {
  const address = hash.replace(/^#/, '');
  // The card after the second `#` is the canvas's; the query is a screen's.
  const [beforeCard = '', card = ''] = address.split(/#(.*)/s, 2);
  const [path = '', search = ''] = beforeCard.split('?');
  const query = new URLSearchParams(search);
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'terminals' && parts[1] && parts.length === 2) {
    return { screen: 'canvas', focus: { kind: 'project' }, session: parts[1] };
  }
  const [page, component, third, fourth] = parts;
  if (page && parts.length === 1 && query.get('view') === 'page') return { screen: 'page', page };
  if (page && component === 'compose' && parts.length === 2) {
    const from = query.get('from');
    return { screen: 'compose', page, from: from && COMPOSITION.test(from) ? from : null };
  }
  if (
    page &&
    component === 'compositions' &&
    third &&
    COMPOSITION.test(third) &&
    parts.length === 3
  ) {
    return { screen: 'composition', page, id: third };
  }
  if (page && component && third === 'iterations' && fourth === 'compare' && parts.length === 4) {
    return {
      screen: 'compare',
      page,
      component,
      ids: (query.get('ids') ?? '').split(',').filter(Boolean)
    };
  }
  if (page && component && third && ITERATION.test(third) && parts.length === 3) {
    return { screen: 'iteration', page, component, iteration: third, refine: query.has('refine') };
  }
  const focus = focusFromPath(card ? `${parts.join('/')}#${card}` : parts.join('/'));
  return focus ? { screen: 'canvas', focus } : { screen: 'missing' };
}

/** The address of what the canvas selects: its item's route, or the project's for nothing. */
export function addressFor(key: string | null): string {
  return `#/${pathForFocus(focusForKey(key))}`;
}

export function navigate(href: string): void {
  window.location.hash = href;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
