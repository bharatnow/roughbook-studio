// The map built from what the discoverers found (B1 of the brownfield plan): their results merged,
// pages by address and components by file and export; the studio's slugs, which stay put when a
// file moves (B7 builds renames on them); and what the map run or the designer wrote in the map
// before (names, kinds, fixtures, examples, sign-ins, what renders alone, a page's sections while
// its code reads the same, and the pages and components it added), kept over what the
// discoverers can know.
import { formatJson } from '../fs/json.js';
import { ROUGH_DIR } from '../repo/root.js';
import { MAP_FIXTURES } from './file.js';
import {
  SHARED_PAGE,
  type ComponentKind,
  type Discovered,
  type FoundComponent,
  type FoundPage,
  type Known,
  type MapComponent,
  type MapPage,
  type Missed,
  type RepoMap
} from './types.js';

/** Slugs are short enough for a folder name and the server's 100 characters. */
const SLUG_LENGTH = 60;

function words(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function clip(slug: string): string {
  return slug.slice(0, SLUG_LENGTH).replace(/-+$/, '');
}

/** A component's slug from its name in the code: `PricingTable` and `pricing_table` give `pricing-table`. */
export function componentSlug(name: string): string {
  return clip(words(name).join('-').toLowerCase()) || 'component';
}

/** A page's slug from its address: `/` is home, `/blog/[slug]` is blog-slug. */
export function pageSlug(address: string): string {
  return (
    clip(
      address
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    ) || 'home'
  );
}

/** A name as the canvas shows it: `PricingTable` is "Pricing table", `FAQ` stays "FAQ". */
export function humanName(name: string): string {
  const parts = words(name).map((word, index) => {
    if (word.length > 1 && word === word.toUpperCase()) return word;
    const lower = word.toLowerCase();
    return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return parts.join(' ') || name;
}

/** A page's name from its address, until the map run names it: `/blog/[slug]` is "Blog / [slug]". */
export function addressName(address: string): string {
  const segments = address.split('?')[0]!.split('/').filter(Boolean);
  if (!segments.length) return 'Home';
  return segments
    .map(segment => (/^[[{:]/.test(segment) ? segment : humanName(segment)))
    .join(' / ');
}

function keyOf(component: { files: string[]; export: string }): string {
  return `${component.files[0] ?? ''}#${component.export}`;
}

function better(current: Known, next: Known): Known {
  return current === 'unknown' ? next : current;
}

function union(into: string[], items: string[]): void {
  for (const item of items) if (!into.includes(item)) into.push(item);
}

/** Every discoverer's pages, one per address, and every component, one per file and export. */
function merge(found: Discovered[]): { pages: FoundPage[]; components: FoundComponent[] } {
  const pages = new Map<string, FoundPage>();
  const components = new Map<string, FoundComponent>();
  for (const result of found) {
    for (const page of result.pages) {
      const key = page.address ?? '';
      const current = pages.get(key);
      if (!current) {
        pages.set(key, { ...page, files: [...page.files], sections: [...page.sections] });
        continue;
      }
      union(current.files, page.files);
      union(current.sections, page.sections);
      current.signIn = better(current.signIn, page.signIn);
      current.example ??= page.example;
      current.name ??= page.name;
    }
    for (const component of result.components) {
      const current = components.get(component.key);
      if (!current) components.set(component.key, { ...component, files: [...component.files] });
      else {
        union(current.files, component.files);
        current.fixture ??= component.fixture;
        current.fixtureFrom ??= component.fixtureFrom;
      }
    }
  }
  return { pages: [...pages.values()], components: [...components.values()] };
}

/** The folder that tells two components of one name apart: the nearest one that says something. */
const PLAIN_FOLDERS = new Set([
  'src',
  'app',
  'components',
  'component',
  'resources',
  'views',
  'js',
  'ts',
  'lib',
  'shared',
  'common',
  'sections',
  'parts',
  'patterns',
  'snippets',
  'templates'
]);

function folderSlug(file: string): string | null {
  const folders = file.split('/').slice(0, -1).reverse();
  const telling = folders.find(folder => !PLAIN_FOLDERS.has(folder.toLowerCase()));
  return telling ? componentSlug(telling) : null;
}

export type BuildOptions = {
  /** The file an iteration holds its fixture in (the environment's), or null when it takes none. */
  fixture: string | null;
  /** Whether a file of the repo is still there, for what the map run added. All are, if not given. */
  exists?: (file: string) => boolean;
  /**
   * The sections the discoverers found for each page, by slug, when the map was last written. A
   * page whose sections in the map differ from these was set by the map run or the designer, and
   * keeps them while the discoverers read its code the same.
   */
  lastFound?: Record<string, string[]>;
};

export type BuiltMap = {
  map: RepoMap;
  /** Fixtures read from the app's stories, to write inside rough/ where none is yet. */
  fixtures: { file: string; content: string }[];
  /** The sections the discoverers found for each page, by slug: the next build's `lastFound`. */
  found: Record<string, string[]>;
};

export function buildMap(
  found: Discovered[],
  previous: RepoMap | null,
  options: BuildOptions
): BuiltMap {
  const exists = options.exists ?? (() => true);
  const merged = merge(found);
  const before = previous ?? { pages: [], components: [], by: [] as string[] };

  // Where each component sits decides its kind: in Shared, on a page, or neither (an atom).
  const placed = new Map<string, ComponentKind>();
  for (const page of merged.pages) {
    for (const key of page.sections) {
      if (page.address === null) placed.set(key, 'shared');
      else if (!placed.has(key)) placed.set(key, 'section');
    }
  }

  // Slugs: the one the map gave the same file and export before, then the name's, told apart
  // by folder when two components share a name.
  const previousByKey = new Map(before.components.map(item => [keyOf(item), item]));
  const foundKeys = new Set(merged.components.map(item => item.key));
  const keptAgent = before.components.filter(
    item =>
      item.byAgent && !foundKeys.has(keyOf(item)) && (!item.files.length || item.files.some(exists))
  );
  const taken = new Set<string>(keptAgent.map(item => item.slug));
  const slugs = new Map<string, string>();
  for (const component of merged.components) {
    const earlier = previousByKey.get(component.key);
    if (earlier && !taken.has(earlier.slug)) {
      slugs.set(component.key, earlier.slug);
      taken.add(earlier.slug);
    }
  }
  const fresh = merged.components.filter(item => !slugs.has(item.key));
  const byBase = new Map<string, FoundComponent[]>();
  for (const component of fresh) {
    const base = componentSlug(component.name);
    byBase.set(base, [...(byBase.get(base) ?? []), component]);
  }
  for (const [base, group] of byBase) {
    const crowded = group.length > 1 || taken.has(base);
    for (const component of [...group].sort((a, b) => a.key.localeCompare(b.key))) {
      const folder = crowded ? folderSlug(component.files[0] ?? '') : null;
      let slug = crowded && folder ? clip(`${folder}-${base}`) : base;
      for (let count = 2; taken.has(slug); count += 1) slug = clip(`${base}-${count}`);
      slugs.set(component.key, slug);
      taken.add(slug);
    }
  }

  const previousBySlug = new Map(before.components.map(item => [item.slug, item]));
  const fixtures: BuiltMap['fixtures'] = [];
  const components = new Map<string, MapComponent>();
  for (const component of merged.components) {
    const slug = slugs.get(component.key)!;
    // The same component, or the one that moved: a slug the map had for a file no longer found.
    const bySlug = previousBySlug.get(slug);
    const earlier =
      previousByKey.get(component.key) ??
      (bySlug && !foundKeys.has(keyOf(bySlug)) ? bySlug : undefined);
    let fixture = earlier?.fixture ?? null;
    if (!fixture && component.fixture && options.fixture) {
      fixture = `${ROUGH_DIR}/${MAP_FIXTURES}/${slug}/${options.fixture}`;
      fixtures.push({ file: fixture, content: formatJson(component.fixture) });
    }
    components.set(slug, {
      slug,
      name: earlier?.name ?? humanName(component.name),
      kind: earlier?.kind ?? placed.get(component.key) ?? component.kind,
      files: component.files,
      export: component.export,
      fixture,
      alone: earlier?.alone ?? 'unknown',
      why: earlier?.why ?? null,
      byAgent: false
    });
  }
  for (const item of keptAgent) components.set(item.slug, item);

  // Pages: the slug the map had for the address, the discoverer's name, or the address's.
  const previousPages = new Map(
    before.pages.filter(page => page.address !== null).map(page => [page.address!, page])
  );
  const sharedBefore = before.pages.find(page => page.slug === SHARED_PAGE);
  const pageSlugs = new Set<string>([SHARED_PAGE]);
  const pages: MapPage[] = [];
  const foundSections: Record<string, string[]> = {};
  const toSlugs = (keys: string[]) =>
    keys.map(key => slugs.get(key)).filter((slug): slug is string => Boolean(slug));
  for (const page of merged.pages) {
    const earlier = page.address === null ? sharedBefore : previousPages.get(page.address);
    let slug: string;
    if (page.address === null) slug = SHARED_PAGE;
    else if (earlier && !pageSlugs.has(earlier.slug)) slug = earlier.slug;
    else {
      const base = page.name ? componentSlug(page.name) : pageSlug(page.address);
      slug = base === SHARED_PAGE ? `${SHARED_PAGE}-page` : base;
      for (let count = 2; pageSlugs.has(slug); count += 1) slug = clip(`${base}-${count}`);
    }
    pageSlugs.add(slug);
    const discovered = toSlugs(page.sections);
    foundSections[slug] = discovered;
    pages.push({
      slug,
      name:
        earlier?.name ??
        page.name ??
        (page.address === null ? 'Shared' : addressName(page.address)),
      address: page.address,
      example: earlier?.example ?? page.example,
      signIn: earlier && earlier.signIn !== 'unknown' ? earlier.signIn : page.signIn,
      files: page.files,
      sections: keptSections(
        discovered,
        earlier?.sections ?? [],
        earlier ? options.lastFound?.[earlier.slug] : undefined,
        components
      ),
      byAgent: false
    });
  }
  for (const page of before.pages) {
    if (!page.byAgent || pageSlugs.has(page.slug)) continue;
    if (page.files.length && !page.files.some(exists)) continue;
    pageSlugs.add(page.slug);
    pages.push({ ...page, sections: page.sections.filter(slug => components.has(slug)) });
  }
  pages.sort((a, b) => {
    if (a.slug === SHARED_PAGE || b.slug === SHARED_PAGE) return a.slug === SHARED_PAGE ? -1 : 1;
    return (a.address ?? '￿').localeCompare(b.address ?? '￿');
  });

  // Components in the order the pages show them, then the rest as they were found.
  const ordered: MapComponent[] = [];
  const seen = new Set<string>();
  for (const slug of [...pages.flatMap(page => page.sections), ...components.keys()]) {
    if (seen.has(slug) || !components.has(slug)) continue;
    seen.add(slug);
    ordered.push(components.get(slug)!);
  }

  const placedFiles = new Set(ordered.flatMap(item => item.files));
  const agentFiles = new Set([
    ...keptAgent.flatMap(item => item.files),
    ...pages.filter(page => page.byAgent).flatMap(page => page.files)
  ]);
  const missed: Missed[] = [];
  for (const item of found.flatMap(result => result.missed)) {
    if (
      agentFiles.has(item.what) ||
      missed.some(other => other.what === item.what && other.why === item.why)
    ) {
      continue;
    }
    missed.push(item);
  }
  const unplaced: string[] = [];
  for (const file of found.flatMap(result => result.unplaced)) {
    if (!placedFiles.has(file) && !unplaced.includes(file)) unplaced.push(file);
  }
  const by = [...new Set(found.map(result => result.by))];
  if (before.by.includes('agent')) by.push('agent');
  return {
    map: { version: 1, by, pages, components: ordered, missed, unplaced },
    fixtures,
    found: foundSections
  };
}

/**
 * A page's sections. While the discoverers read its code as they did when the map was last written
 * (`base`), the map's own, as the map run or the designer set them. Otherwise the discoverers' new
 * reading, without what the map left out of theirs, and with what it added kept at its place: after
 * the section that came before it, or first. With no earlier reading to tell an edit by, what the
 * map run added is the components it added.
 */
function keptSections(
  found: string[],
  earlier: string[],
  base: string[] | undefined,
  components: Map<string, MapComponent>
): string[] {
  const kept = earlier.filter(slug => components.has(slug));
  if (base && base.join() === found.join()) return kept;
  const added = (slug: string) =>
    base ? !base.includes(slug) : Boolean(components.get(slug)?.byAgent);
  const sections = base
    ? found.filter(slug => !base.includes(slug) || earlier.includes(slug))
    : [...found];
  kept.forEach((slug, index) => {
    if (sections.includes(slug) || !added(slug)) return;
    const after = kept
      .slice(0, index)
      .reverse()
      .find(item => sections.includes(item));
    sections.splice(after ? sections.indexOf(after) + 1 : 0, 0, slug);
  });
  return sections;
}
