import { useEffect, useState } from 'react';

// Screens live in the address's fragment, with the web's paths: a component's base is
// /<page>/<component>, so @roughbook/ui's links (`${base}/iterations`, `${base}/<iteration>`,
// `${base}/iterations/compare?ids=`) land on the same screens here.

export type Route =
  | { screen: 'overview' }
  | { screen: 'component'; page: string; component: string }
  | { screen: 'compare'; page: string; component: string; ids: string[] }
  | { screen: 'iteration'; page: string; component: string; iteration: string; refine: boolean }
  | { screen: 'terminal'; id: string }
  | { screen: 'missing' };

export function parseRoute(hash: string): Route {
  const [path = '', search = ''] = hash.replace(/^#/, '').split('?');
  const query = new URLSearchParams(search);
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { screen: 'overview' };
  if (parts[0] === 'terminals' && parts[1]) return { screen: 'terminal', id: parts[1] };
  const [page, component, third, fourth] = parts;
  if (!page || !component) return { screen: 'missing' };
  if (!third || (third === 'iterations' && !fourth))
    return { screen: 'component', page, component };
  if (third === 'iterations' && fourth === 'compare') {
    return {
      screen: 'compare',
      page,
      component,
      ids: (query.get('ids') ?? '').split(',').filter(Boolean)
    };
  }
  if (/^iteration-\d{2,}$/.test(third) && !fourth) {
    return { screen: 'iteration', page, component, iteration: third, refine: query.has('refine') };
  }
  return { screen: 'missing' };
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
