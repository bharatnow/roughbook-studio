// Where a new section's file goes (ROUGHBOOK-BROWNFIELD-PLAN.md, decision 56): beside the page's
// own sections, named like them. It reads only the map, so it names no stack: the folder most of
// the page's sections' defining files are in, their naming style, their extension, and whether
// each is a folder with an index file.
import type { MapComponent, RepoMap } from './types.js';

/** How a stack's files are named: `pricing-section`, `PricingSection`, `pricingSection`, `pricing_section`. */
export type NameStyle = 'kebab' | 'pascal' | 'camel' | 'snake';

/** The styles a name fits: one lowercase word fits three, and a mixed name none. */
export function nameStyle(name: string): NameStyle[] {
  if (/^[a-z][a-z0-9]*$/.test(name)) return ['kebab', 'camel', 'snake'];
  if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(name)) return ['kebab'];
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(name)) return ['snake'];
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(name)) return ['camel'];
  if (/^[A-Z][A-Za-z0-9]*$/.test(name)) return ['pascal'];
  return [];
}

/** A slug's words in a style: `logo-wall` becomes `LogoWall`, `logoWall` or `logo_wall`. */
function styled(slug: string, style: NameStyle | null): string {
  const words = slug.split('-').filter(Boolean);
  const upper = (word: string) => word[0]!.toUpperCase() + word.slice(1);
  switch (style) {
    case 'pascal':
      return words.map(upper).join('');
    case 'camel':
      return words.map((word, index) => (index ? upper(word) : word)).join('');
    case 'snake':
      return words.join('_');
    default:
      return slug;
  }
}

/** A section's defining file, as where it sits: its folder, its name, its extension. */
type Entry = { dir: string; name: string; extension: string; index: boolean };

function entryOf(file: string): Entry {
  const parts = file.split('/');
  const base = parts.pop()!;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : '';
  // A section that is a folder with an index file sits in its folder's parent, by its folder's name.
  if (stem === 'index' && parts.length) {
    const name = parts.pop()!;
    return { dir: parts.join('/'), name, extension, index: true };
  }
  return { dir: parts.join('/'), name: stem, extension, index: false };
}

/** The most common value, a tie going to the one seen first. */
function most<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0] as T;
  for (const value of values) if (counts.get(value)! > counts.get(best)!) best = value;
  return best;
}

/**
 * The repo-relative file a new section `slug` of `page` is written to, beside the page's own
 * sections and named like them; null when none of them has a file, so the caller keeps its own
 * place. Shared parts and atoms are left out.
 */
export function newSectionFile(map: RepoMap, page: string, slug: string): string | null {
  const mapPage = map.pages.find(item => item.slug === page);
  if (!mapPage) return null;
  const bySlug = new Map(map.components.map(item => [item.slug, item]));
  const entries = [...new Set(mapPage.sections)]
    .map(item => bySlug.get(item))
    .filter((item): item is MapComponent => item?.kind === 'section' && !!item.files[0])
    .map(item => entryOf(item.files[0]!));
  if (!entries.length) return null;
  const dir = most(entries.map(entry => entry.dir));
  const here = entries.filter(entry => entry.dir === dir);
  const styles = here
    .map(entry => nameStyle(entry.name))
    .reduce((left, right) => left.filter(style => right.includes(style)));
  const name = styled(slug, styles.length === 1 ? styles[0]! : null);
  const extension = most(here.map(entry => entry.extension));
  const folder = most(here.map(entry => entry.index));
  const file = folder ? `${name}/index${extension}` : `${name}${extension}`;
  return dir ? `${dir}/${file}` : file;
}
