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

/** The names a tab's title is made from: the project's tree, as the server reads it. */
export type TitleNames = {
  name: string;
  pages: {
    slug: string;
    name: string;
    components: { slug: string; name: string; iterations: { id: string; name: string }[] }[];
  }[];
};

const PRODUCT = 'Roughbook studio';
const SEPARATOR = ' · ';

/** "iteration-03" as "Iteration 03", "composition-02" as "Composition 02"; anything else as it is. */
function numbered(id: string): string {
  const match = /^(iteration|composition)-(\d+)$/.exec(id);
  return match ? `${match[1] === 'iteration' ? 'Iteration' : 'Composition'} ${match[2]}` : id;
}

function named(name: string | undefined, fallback: string): string {
  return (name ?? '').trim() || fallback;
}

/** Which document a route shows, as the web's `TitledPlace` names it. */
type Place =
  | { kind: 'project' }
  | { kind: 'page'; page: string }
  | { kind: 'component' | 'iterations' | 'compare'; page: string; component: string }
  | { kind: 'iteration'; page: string; component: string; iteration: string }
  | { kind: 'composer'; page: string }
  | { kind: 'composition'; page: string; composition: string };

/** A card on the canvas is its component's iterations, as on the web, whose server cannot see it. */
function placeOf(route: Route): Place | null {
  switch (route.screen) {
    case 'canvas':
      return route.focus.kind === 'iteration'
        ? { kind: 'iterations', page: route.focus.page, component: route.focus.component }
        : route.focus;
    case 'compare':
      return { kind: 'compare', page: route.page, component: route.component };
    case 'iteration':
      return {
        kind: 'iteration',
        page: route.page,
        component: route.component,
        iteration: route.iteration
      };
    case 'page':
      return { kind: 'page', page: route.page };
    case 'compose':
      return { kind: 'composer', page: route.page };
    case 'composition':
      return { kind: 'composition', page: route.page, composition: route.id };
    default:
      return null;
  }
}

/** The document's name, then what holds it, without the project. */
function documentParts(names: TitleNames | null, place: Place): string[] {
  if (place.kind === 'project') return [];
  const page = names?.pages.find(item => item.slug === place.page);
  const pageName = named(page?.name, place.page);
  switch (place.kind) {
    case 'page':
      return [pageName];
    case 'composer':
      return ['Composition', pageName];
    case 'composition':
      return [numbered(place.composition), pageName];
  }
  const component = page?.components.find(item => item.slug === place.component);
  const componentName = named(component?.name, place.component);
  switch (place.kind) {
    case 'component':
      return [componentName, pageName];
    case 'iterations':
      return [`${componentName} iterations`, pageName];
    case 'compare':
      return [`Compare ${componentName}`, pageName];
  }
  const iteration = component?.iterations.find(item => item.id === place.iteration);
  return [named(iteration?.name, numbered(place.iteration)), componentName];
}

/**
 * What the tab says for a route (ROUGHBOOK-APPLE-PLAN.md, A8 step 4), as the web's
 * `documentTitle()` has it: the document's own name first, then what holds it, then the project,
 * then " / Roughbook studio". Before the project is read, slugs stand for the names and the
 * project is left out.
 */
export function titleFor(route: Route, names?: TitleNames | null): string {
  const place = placeOf(route);
  const parts = place ? documentParts(names ?? null, place) : ['Nothing here'];
  if (names) parts.push(named(names.name, 'Untitled project'));
  return parts.length ? `${parts.join(SEPARATOR)} / ${PRODUCT}` : PRODUCT;
}

/** Keeps the tab's title on the route's document as the address and the names change. */
export function useDocumentTitle(route: Route, names?: TitleNames | null): void {
  const title = titleFor(route, names);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
