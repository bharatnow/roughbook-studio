// The in-page view (B5 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 41 and 42): an iteration of an
// adopted component shown in its real page, with the page's real data, in place of the app's own
// component, and each adopted component marked so a click on the page finds its section. Each
// recipe with the hook has its own development-only switch; what they share is here: which
// adopted sections there are and the iterations each has, the address that asks for a swap, and
// the words every switch uses (the parameters, the marker, the sentinel the gate looks for).
import fs from 'node:fs';
import path from 'node:path';
import { readMap } from '../map/file.js';
import { SHARED_PAGE, type MapComponent, type MapPage, type RepoMap } from '../map/types.js';
import { ITERATION, SLUG } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import type { ContextPreview, Recipe } from './types.js';

/** `?roughbook-swap=<page>/<component>/<iteration>`: the iteration shown where the component was. */
export const SWAP_PARAM = 'roughbook-swap';
/** `?roughbook-pick=1`: a click names its section to the frame instead of following the page. */
export const PICK_PARAM = 'roughbook-pick';
/** `?roughbook-markers=0`: the page without its markers, for doctor's comparison of the pictures. */
export const MARKERS_PARAM = 'roughbook-markers';
/** The marker's element and attributes (decision 42). */
export const MARKER_ELEMENT = 'roughbook-section';
export const SECTION_ATTRIBUTE = 'data-roughbook-section';
/** On a marker whose iteration was swapped in: the iteration's key, so doctor can tell it did. */
export const SWAPPED_ATTRIBUTE = 'data-roughbook-swap';
/** What every file of a switch holds, so the gate can prove none of it reached production. */
export const CONTEXT_SENTINEL = 'roughbook-context-switch';
/** The baseline, which is the app's own component: never swapped in, it is what shows without a swap. */
const BASELINE = 'iteration-00';

/** One of the iterations a section can show in its page. */
export type ContextIteration = {
  /** `<page>/<component>/<iteration>`. */
  key: string;
  iteration: string;
  /**
   * The file the swap renders, repo-relative: the copy of the component's own file in a fork from
   * the app (its `.base/base.json` says which), else the iteration's entry.
   */
  shown: string;
};

/** An adopted component on a page, as the switch marks it. */
export type ContextSection = {
  /** `<page>/<component>`, as its marker names it. */
  key: string;
  page: string;
  component: string;
  /** The page's address in the stack's own words; null for Shared, whose parts are on every page. */
  address: string | null;
  /** The component as the map has it: its files and the export the stack renders it by. */
  source: MapComponent;
  /** Its iterations besides the baseline, which the switch can show in its place. */
  iterations: ContextIteration[];
};

function folders(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** The copy of `source` a fork from the app keeps in its folder, repo-relative, or null. */
function copyOf(repo: string, folder: string, source: string | undefined): string | null {
  if (!source) return null;
  try {
    const base = JSON.parse(
      fs.readFileSync(path.join(repo, ...folder.split('/'), '.base', 'base.json'), 'utf8')
    ) as { files?: { path: string; copy: string | null }[] };
    const copy = base.files?.find(file => file.path === source)?.copy;
    return copy && fs.existsSync(path.join(repo, ...folder.split('/'), ...copy.split('/')))
      ? `${folder}/${copy}`
      : null;
  } catch {
    return null;
  }
}

/**
 * The adopted sections and shared parts in this repo, with their iterations: each component on a
 * page of the map that has its baseline in rough/<page>/<component>/iteration-00/, in the map's
 * order. Atoms adopted by hand count too: they are adopted onto a page.
 */
export function contextSections(repo: string, entry: string, known?: RepoMap): ContextSection[] {
  let map = known;
  if (!map) {
    try {
      map = readMap(repo)?.map;
    } catch {
      map = undefined;
    }
  }
  if (!map) return [];
  const bySlug = new Map(map.components.map(component => [component.slug, component]));
  const sections: ContextSection[] = [];
  for (const page of map.pages) {
    const pageDir = path.join(repo, ROUGH_DIR, page.slug);
    // In the page's order; an atom adopted by hand, on no page's list, after its sections.
    const order = (name: string) => {
      const at = page.sections.indexOf(name);
      return at === -1 ? page.sections.length : at;
    };
    const adopted = folders(pageDir)
      .filter(name => SLUG.test(name))
      .sort((a, b) => order(a) - order(b));
    for (const component of adopted) {
      const source = bySlug.get(component);
      if (!source) continue;
      const dir = path.join(pageDir, component);
      const iterations = folders(dir).filter(name => ITERATION.test(name));
      if (!iterations.includes(BASELINE)) continue;
      sections.push({
        key: `${page.slug}/${component}`,
        page: page.slug,
        component,
        address: page.address,
        source,
        iterations: iterations
          .filter(name => name !== BASELINE && fs.existsSync(path.join(dir, name, entry)))
          .map(iteration => {
            const folder = `${ROUGH_DIR}/${page.slug}/${component}/${iteration}`;
            return {
              key: `${page.slug}/${component}/${iteration}`,
              iteration,
              shown: copyOf(repo, folder, source.files[0]) ?? `${folder}/${entry}`
            };
          })
      });
    }
  }
  return sections;
}

/** Whether an address has a segment only an example fills: `[slug]`, `{post}`, `:id`. */
function dynamicSegment(part: string): boolean {
  return /^\[.*\]$|^\{.*\}$|^:/.test(part);
}

/**
 * Where a section is seen in its page: its page's example or address; for Shared, whose parts are
 * on every page, the first page anyone may see at a fixed address. Null when no page shows it.
 */
export function contextAddress(map: RepoMap, section: Pick<ContextSection, 'page'>): string | null {
  const open = (page: MapPage) => {
    if (page.signIn === 'yes') return null;
    const address = page.example ?? page.address;
    return address && !address.split('/').some(dynamicSegment) ? address : null;
  };
  const page = map.pages.find(item => item.slug === section.page);
  if (page && page.slug !== SHARED_PAGE) return open(page);
  for (const other of map.pages) {
    const address = open(other);
    if (address) return address;
  }
  return null;
}

/** A page's address with what the frame asks of the switch, the page's own query kept. */
export function swapAddress(
  address: string,
  options: { swap?: string | null; pick?: boolean; markers?: boolean } = {}
): string {
  const [pathname, query = ''] = address.split('?') as [string, string?];
  const search = new URLSearchParams(query);
  if (options.swap) search.set(SWAP_PARAM, options.swap);
  if (options.pick) search.set(PICK_PARAM, '1');
  if (options.markers === false) search.set(MARKERS_PARAM, '0');
  const text = search.toString().replace(/%2F/gi, '/');
  return text ? `${pathname}?${text}` : pathname;
}

/**
 * The marker's key for a component a request shows, among the pages it is adopted on: the page
 * whose address the request's path matches, else the first. Each switch does the same in its own
 * language; this is the rule they follow, and the one their tests check.
 */
export function sectionKeyFor(
  keys: { key: string; address: string | null }[],
  pathname: string
): string | null {
  const matches = (address: string | null) => {
    if (address === null) return false;
    const want = address.replace(/\/+$/, '').split('/');
    const have = pathname.replace(/\/+$/, '').split('/');
    return (
      want.length === have.length &&
      want.every((part, index) => dynamicSegment(part) || part === have[index])
    );
  };
  return (keys.find(item => matches(item.address)) ?? keys[0])?.key ?? null;
}

/**
 * The switch's words for doctor: the recipe's own hook, or, for a setup the setup run built (no
 * recipe), the words the setup prompt gives the agent: the same address, nothing of the studio's
 * to write, and the parameter's name as the sentinel no production output may hold. Null for a
 * recipe with no switch, whose components are shown alone.
 */
export function contextSwitch(recipe: Recipe | null): ContextPreview | null {
  if (recipe) return recipe.contextPreview ?? null;
  return AGENT_SWITCH;
}

const AGENT_SWITCH: ContextPreview = {
  // Its files are the setup's own, listed in setupFiles with their templates: doctor's setup-files
  // check has them.
  files: () => [],
  edits: () => [],
  generated: [],
  missing: () => [],
  address: (address, swap, options) => swapAddress(address, { swap, ...options }),
  sentinel: SWAP_PARAM
};
