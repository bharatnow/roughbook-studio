// What a Vite app with React has (B1 of the brownfield plan): its entry from index.html, its
// pages from the router its code declares (React Router's <Route path element> and route objects),
// read through the same transform as every module stack, and Shared from what the app renders
// around its routes. With no router the app is one page. A router configured some other way (file
// routes, a router built at run time) is the map run's to read.
import path from 'node:path';
import { discoverModules, type ModuleRoutes } from '../modules/discover.js';
import {
  buildGraph,
  definingExport,
  readModule,
  reachable,
  resolveImport,
  type ComponentRef
} from '../modules/graph.js';
import type { Discovered, DiscoverInput } from '../../map/types.js';
import { readText } from '../../map/walk.js';
import { PAGE } from './preview.js';

/** The app's own entry module, from the script tag of its index.html. */
function entryOf(repo: string): string | null {
  const html = readText(repo, 'index.html');
  const src =
    html && /<script[^>]*type=["']module["'][^>]*src=["']\/?([^"'?]+)["']/.exec(html)?.[1];
  return src ? path.posix.normalize(src) : null;
}

/** The component an element names in a module, followed to the file that defines it. */
function refFor(
  repo: string,
  graph: Awaited<ReturnType<typeof buildGraph>>,
  file: string,
  name: string
): ComponentRef | null {
  const info = readModule(repo, file);
  const imported = info?.imports.get(name.split('.')[0]!);
  if (!info || !imported) return info?.declared.has(name) ? { file, export: name } : null;
  const target = resolveImport(graph, file, imported.spec);
  return target
    ? definingExport(repo, graph, target, imported.name === '*' ? 'default' : imported.name)
    : null;
}

export async function discoverVite(given: DiscoverInput): Promise<Discovered> {
  const input = { ...given, own: [...given.own, PAGE] };
  const { repo } = input;
  const routes: ModuleRoutes = {
    by: 'vite',
    pages: [],
    layouts: [],
    others: [],
    unread: [],
    missed: [],
    pageRoots: [],
    isRoute: () => false
  };
  const entry = entryOf(repo);
  if (!entry || !readModule(repo, entry)) {
    if (entry)
      routes.missed.push({ what: 'index.html', why: `its entry ${entry} could not be read` });
    return discoverModules(input, routes);
  }
  // The entry is the app's, never a component left unplaced.
  routes.others.push(entry);
  const graph = await buildGraph(repo, [entry]);
  const seen = new Set<string>();
  /** Route definitions in the app's code: a path, and the element or component shown at it. */
  for (const file of [...reachable(graph, [entry])].sort()) {
    const info = readModule(repo, file);
    if (!info) continue;
    for (const match of info.code.matchAll(/\bpath:\s*"([^"]*)"/g)) {
      const around = info.code.slice(match.index, match.index + 400).split(/\bpath:\s*"/)[1] ?? '';
      const element =
        /\belement:\s*(?:\/\*[^*]*\*\/\s*)?__rb\(\s*([\w$.]+)/.exec(around)?.[1] ??
        /\bComponent:\s*([\w$]+)/.exec(around)?.[1];
      const ref = element ? refFor(repo, graph, file, element) : null;
      if (!ref) continue;
      const address = match[1]!.startsWith('/') ? match[1]! : `/${match[1]}`;
      if (seen.has(address)) continue;
      seen.add(address);
      // A layout route renders an <Outlet /> for its children: its parts are Shared's.
      const outlet = readModule(repo, ref.file)?.code.includes('Outlet');
      if (outlet) routes.layouts.push(ref);
      else routes.pages.push({ file: ref.file, address, export: ref.export });
      routes.pageRoots!.push(ref);
    }
  }
  // The app the entry renders: around the routes, Shared; with no routes, the one page.
  const main = readModule(repo, entry)!;
  const rendered = main.calls
    .map(call => call.name)
    .filter((name): name is string => Boolean(name))
    .map(name => refFor(repo, graph, entry, name))
    .find((ref): ref is ComponentRef => Boolean(ref));
  if (rendered) {
    if (routes.pages.length) routes.layouts.unshift(rendered);
    else routes.pages.push({ file: rendered.file, address: '/', export: rendered.export });
  }
  return discoverModules(input, routes);
}
