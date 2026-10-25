// What the module stacks share once their routes are known (Next.js, Expo, Vite with React): the
// graph from every route and layout, each page's sections in order, Shared from the layouts, the
// atoms the routes reach, fixtures from the stories, and the component files nothing renders.
import path from 'node:path';
import {
  buildGraph,
  componentName,
  forgetModules,
  readModule,
  reachable,
  refKey,
  rendered,
  type Analysis,
  type ComponentRef
} from './graph.js';
import { isAtom, isToolingFile } from '../../map/kinds.js';
import { storyFixtures } from './stories.js';
import type {
  Discovered,
  DiscoverInput,
  FoundComponent,
  FoundPage,
  Missed
} from '../../map/types.js';
import { listFiles, readText } from '../../map/walk.js';

export type ModuleRoutes = {
  by: string;
  /** Each page's route file and the address it answers at. */
  pages: { file: string; address: string; export?: string }[];
  /** The files whose parts every page under them shares, outermost first. */
  layouts: (string | ComponentRef)[];
  /** Components that are pages of their own, never one of Shared's parts (a router's elements). */
  pageRoots?: ComponentRef[];
  /** Route files that render no page of their own (not-found, error): reached, so not unplaced. */
  others: string[];
  /** Pages the discoverer cannot read (an MDX page), listed with no sections. */
  unread: { file: string; address: string; why: string }[];
  missed: Missed[];
  /** Whether a file is one of the router's own, never a component left unplaced. */
  isRoute(file: string): boolean;
};

const STORY = /\.(stories|story)\.(tsx|ts|jsx|js|mjs)$/;
const COMPONENT_FILE = /\.(tsx|jsx)$/;

/** A .js file that returns an element: a component, where .tsx and .jsx files always count. */
function looksLikeComponent(repo: string, file: string): boolean {
  if (COMPONENT_FILE.test(file)) return true;
  if (!/\.(js|mjs)$/.test(file)) return false;
  const text = readText(repo, file) ?? '';
  return /\breturn\s*\(?\s*<[A-Za-z>]/.test(text);
}

/** The export a file's atom is known by: its default's own name, or the export named like it. */
function mainExport(repo: string, file: string): { export: string; name: string } | null {
  const info = readModule(repo, file);
  if (!info) return null;
  const base = path.posix.basename(file).replace(/\.[^.]+$/, '');
  const pascal = base
    .split(/[^A-Za-z0-9]+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  const exported = [
    ...info.statements
      .filter(item => item.name && /^export\s/.test(info.code.slice(item.start, item.start + 7)))
      .map(item => item.name!),
    ...info.reexports.filter(item => !item.from).map(item => item.name)
  ].filter(name => /^[A-Z]/.test(name) && name !== 'default');
  if (info.statements.some(item => item.isDefault)) {
    return { export: 'default', name: info.defaultName ?? pascal };
  }
  const named = exported.find(name => name.toLowerCase() === pascal.toLowerCase()) ?? exported[0];
  return named ? { export: named, name: named } : null;
}

function plural(names: string[], one: string, many: string): string {
  return names.length === 1 ? one : many;
}

export async function discoverModules(
  input: DiscoverInput,
  routes: ModuleRoutes
): Promise<Discovered> {
  const { repo } = input;
  // Read afresh each time: `roughbook start` maps again after the files changed.
  forgetModules();
  const files = listFiles(input);
  const stories = files.filter(file => STORY.test(file));
  const layoutRefs = routes.layouts.map(layout =>
    typeof layout === 'string' ? { file: layout, export: 'default' } : layout
  );
  const entries = [
    ...new Set([
      ...routes.pages.map(page => page.file),
      ...layoutRefs.map(layout => layout.file),
      ...routes.others
    ])
  ];
  const graph = await buildGraph(repo, [...new Set([...entries, ...stories])]);
  const analysis: Analysis = { repo, graph, isAtom: (ref, name) => isAtom(ref.file, name) };
  const missed: Missed[] = [...routes.missed];
  const components = new Map<string, FoundComponent>();
  const fixtures = storyFixtures(repo, graph, stories);
  const keep = (ref: ComponentRef, kind: FoundComponent['kind']): string => {
    const key = refKey(ref);
    if (!components.has(key)) {
      const name = componentName(repo, ref);
      const story = fixtures.get(key);
      components.set(key, {
        key,
        name,
        kind: isAtom(ref.file, name) ? 'atom' : kind,
        files: [ref.file],
        export: ref.export,
        fixture: story?.fixture ?? null,
        fixtureFrom: story?.from ?? null
      });
    }
    return key;
  };
  const read = (file: string, exported = 'default') => {
    const failure = graph.failed.get(file);
    if (failure) {
      missed.push({
        what: file,
        why: `could not be read, so its sections are not known: ${failure}`
      });
      return null;
    }
    if (!readModule(repo, file)) {
      missed.push({ what: file, why: 'could not be read, so its sections are not known' });
      return null;
    }
    return rendered(analysis, { file, export: exported }, { descend: true });
  };

  const pages: FoundPage[] = [];
  const shared: FoundPage = {
    address: null,
    name: null,
    files: [],
    sections: [],
    signIn: 'unknown',
    example: null
  };
  const hidden = new Map<string, ComponentRef>();
  const pageRoots = new Set((routes.pageRoots ?? []).map(refKey));
  for (const layout of layoutRefs) {
    const made = read(layout.file, layout.export);
    if (!made) continue;
    for (const ref of made.hidden) hidden.set(refKey(ref), ref);
    for (const ref of made.items) keep(ref, 'atom');
    const parts = made.sections.filter(ref => !pageRoots.has(refKey(ref)));
    // A layout that only provides (a context, a guard) gives Shared nothing, and is none of its files.
    if (!parts.length) continue;
    for (const file of made.files) if (!shared.files.includes(file)) shared.files.push(file);
    for (const ref of parts) {
      const key = keep(ref, 'shared');
      if (!shared.sections.includes(key)) shared.sections.push(key);
    }
  }
  if (shared.sections.length || shared.files.length) pages.push(shared);
  for (const page of routes.pages) {
    const made = read(page.file, page.export);
    const sections = (made?.sections ?? []).map(ref => keep(ref, 'section'));
    for (const ref of made?.hidden ?? []) hidden.set(refKey(ref), ref);
    for (const ref of made?.items ?? []) keep(ref, 'atom');
    const reasons: string[] = [];
    if (made?.inline.length) {
      const names = made.inline;
      reasons.push(
        `${names.join(', ')} ${plural(names, 'is', 'are')} defined inside the page file, so ${plural(names, 'it is', 'they are')} part of the page and cannot be shown alone`
      );
    }
    if (made?.blocks.length) {
      const containers = [...new Set(made.blocks)];
      const count = made.blocks.length;
      reasons.push(
        `${count} block${count === 1 ? '' : 's'} of its content ${count === 1 ? 'is' : 'are'} written inline inside ${containers.join(', ')}, part of the page rather than sections of their own`
      );
    }
    if (made && !sections.length && !reasons.length) {
      const code = readModule(repo, page.file)?.code ?? '';
      reasons.push(
        made.elements === 0
          ? /\b(redirect|permanentRedirect|replace|push)\s*\(/.test(code)
            ? 'it redirects, and renders nothing of its own'
            : 'it renders nothing the discoverer could read'
          : 'its content is written inline in the page, from atoms and HTML, so it has no section of its own to show alone'
      );
    }
    if (reasons.length) missed.push({ what: page.file, why: reasons.join('; ') });
    pages.push({
      address: page.address,
      name: null,
      files: made?.files ?? [page.file],
      sections,
      signIn: 'unknown',
      example: null
    });
  }
  for (const page of routes.unread) {
    missed.push({ what: page.file, why: page.why });
    pages.push({
      address: page.address,
      name: null,
      files: [page.file],
      sections: [],
      signIn: 'unknown',
      example: null
    });
  }

  for (const ref of hidden.values()) {
    missed.push({
      what: ref.file,
      why: `${componentName(repo, ref)} shows nothing on the page (a script, metadata or an effect), so it is no section`
    });
  }

  // The atoms the app's routes reach, by their folders or their names.
  const reached = reachable(graph, entries);
  for (const file of [...reached].sort()) {
    if (!looksLikeComponent(repo, file) || routes.isRoute(file) || isToolingFile(file)) continue;
    const main = mainExport(repo, file);
    if (main && isAtom(file, main.name)) keep({ file, export: main.export }, 'atom');
  }

  const unplaced = files.filter(
    file =>
      !reached.has(file) &&
      !routes.isRoute(file) &&
      !isToolingFile(file) &&
      looksLikeComponent(repo, file)
  );
  pages.sort((a, b) =>
    a.address === null ? -1 : b.address === null ? 1 : a.address.localeCompare(b.address)
  );
  return {
    by: routes.by,
    pages,
    components: [...components.values()],
    missed,
    unplaced
  };
}
