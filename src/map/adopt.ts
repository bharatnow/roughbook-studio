// Adoption (B2 of ROUGHBOOK-BROWNFIELD-PLAN.md): a page or a component of the map becomes a project
// record only when the designer says so (decision 6), and then only by name, slug and kind
// (decision 7): the map's paths, fixtures and code stay here. Each adopted component's baseline,
// iteration 0, is then written here: the recipe's pointer to the real file, beside the map's
// fixture, never a copy of the code (decision 2).
import fs from 'node:fs';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import type { AdoptBody, Adopted } from '../api/types.js';
import { writeFiles } from '../doctor/checks.js';
import type { Recipe } from '../recipes/types.js';
import { iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import { readMap } from './file.js';
import type { MapComponent, MapPage, RepoMap } from './types.js';

/** An adopted component's baseline: the app's current code (decision 2). */
export const BASELINE = 'iteration-00';

/** "Adopt all" asks first past this many components (decision 29). */
export const ASK_PAST = 50;

/** The most components one adoption request takes (the contract). */
export const ADOPT_BATCH = 500;

/** The most section slugs a page's order carries on adoption (the contract, decision 55). */
export const ORDER_MAX = 500;

/** What the designer adopts: a page with its sections, one of its components, or everything. */
export type AdoptChoice = { all: true } | { page: string; component?: string };

/**
 * A page and the components adopted with it, as the map has them, and the page's own sections in
 * the app's order, which the web's order of the page follows (decision 55).
 */
export type Adoption = { page: MapPage; components: MapComponent[]; sections: string[] };

/** Reads `<page>[/<component>]`, or null for anything else. */
export function parseChoice(text: string): AdoptChoice | null {
  const match = /^([a-z0-9][a-z0-9-]*)(?:\/([a-z0-9][a-z0-9-]*))?$/.exec(text.trim());
  if (!match) return null;
  return match[2] ? { page: match[1]!, component: match[2] } : { page: match[1]! };
}

/**
 * The pages and components a choice adopts. A page brings its sections, which for Shared are the
 * parts every page shares; atoms only when named (decision 5). Throws when the map has no such
 * page or component, in words for the designer.
 */
export function chooseAdoption(map: RepoMap, choice: AdoptChoice): Adoption[] {
  const bySlug = new Map(map.components.map(component => [component.slug, component]));
  const sectionsOf = (page: MapPage) =>
    [...new Set(page.sections)]
      .map(slug => bySlug.get(slug))
      .filter((component): component is MapComponent => !!component && component.kind !== 'atom');
  const orderOf = (page: MapPage) =>
    sectionsOf(page)
      .map(component => component.slug)
      .slice(0, ORDER_MAX);
  if ('all' in choice) {
    return map.pages
      .map(page => ({ page, components: sectionsOf(page), sections: orderOf(page) }))
      .filter(item => item.components.length);
  }
  const page = map.pages.find(item => item.slug === choice.page);
  if (!page) {
    throw new Error(
      `${ROUGH_DIR}/map.md has no page ${choice.page}. The pages are: ${map.pages.map(item => item.slug).join(', ') || 'none'}.`
    );
  }
  if (!choice.component) return [{ page, components: sectionsOf(page), sections: orderOf(page) }];
  const component = bySlug.get(choice.component);
  if (!component) {
    throw new Error(`${ROUGH_DIR}/map.md has no component ${choice.component}.`);
  }
  // An atom is on no page's list, and is adopted by hand onto the page named (decision 5).
  if (component.kind !== 'atom' && !page.sections.includes(component.slug)) {
    const on = map.pages.filter(item => item.sections.includes(component.slug));
    throw new Error(
      `${component.slug} is not on ${page.slug}${on.length ? `; it is on ${on.map(item => item.slug).join(', ')}` : ''}.`
    );
  }
  return [{ page, components: [component], sections: orderOf(page) }];
}

/** How many components an adoption brings. */
export function countAdoption(adoption: Adoption[]): number {
  return adoption.reduce((sum, item) => sum + item.components.length, 0);
}

/**
 * The requests an adoption is sent in: names, slugs and kinds, and each page's order as slugs,
 * nothing else from the map, at most `ADOPT_BATCH` components each. A page larger than that is
 * split across requests, each part with the page's order. A page may go with no components, to
 * set its order alone.
 */
export function adoptBodies(adoption: Adoption[], max = ADOPT_BATCH): AdoptBody[] {
  const bodies: AdoptBody[] = [];
  let current: AdoptBody = { pages: [] };
  let count = 0;
  const flush = () => {
    if (current.pages.length) bodies.push(current);
    current = { pages: [] };
    count = 0;
  };
  for (const { page, components, sections } of adoption) {
    let rest = components;
    do {
      if (count >= max) flush();
      const room = rest.slice(0, max - count);
      current.pages.push({
        slug: page.slug,
        name: page.name,
        components: room.map(component => ({
          slug: component.slug,
          name: component.name,
          kind: component.kind
        })),
        sections
      });
      count += room.length;
      rest = rest.slice(room.length);
    } while (rest.length);
  }
  flush();
  return bodies;
}

/** Sends the adoption, a batch at a time, and puts the backend's answers together. */
export async function sendAdoption(
  api: StudioApi,
  link: { orgId: string; project: string },
  adoption: Adoption[]
): Promise<Adopted> {
  const pages: Adopted['pages'] = [];
  for (const body of adoptBodies(adoption)) {
    const answer = await api.adopt(link.orgId, link.project, body);
    for (const page of answer.pages) {
      const known = pages.find(item => item.slug === page.slug);
      if (known) known.components.push(...page.components);
      else pages.push({ ...page, components: [...page.components] });
    }
  }
  return { pages };
}

export type Baselines = {
  /** `<page>/<component>` of each baseline written now. */
  written: string[];
  /** Already in this repo: a teammate's, committed with rough/, or one written before. */
  present: string[];
  /** Adopted with no baseline here, and why. */
  unpointed: { key: string; why: string }[];
};

/**
 * Writes each adopted component's baseline that this repo does not have yet, through the recipe's
 * pointer, with the map's fixture. One already here is left as it is.
 */
export function writeBaselines(
  repoRoot: string,
  map: RepoMap,
  recipe: Recipe | null,
  adopted: Adopted
): Baselines {
  const result: Baselines = { written: [], present: [], unpointed: [] };
  const bySlug = new Map(map.components.map(component => [component.slug, component]));
  for (const page of adopted.pages) {
    for (const { slug, baseline } of page.components) {
      const key = `${page.slug}/${slug}`;
      const folder = iterationDir(page.slug, slug, baseline);
      if (fs.existsSync(path.join(repoRoot, ...folder.split('/')))) {
        result.present.push(key);
        continue;
      }
      const component = bySlug.get(slug);
      if (!component) {
        result.unpointed.push({ key, why: `${ROUGH_DIR}/map.md no longer has it` });
        continue;
      }
      if (!recipe?.pointer) {
        result.unpointed.push({
          key,
          why: `${recipe ? `the ${recipe.name} recipe` : 'a setup with no recipe'} cannot point an iteration at an existing component yet`
        });
        continue;
      }
      let fixture: string | null = null;
      if (component.fixture) {
        try {
          fixture = fs.readFileSync(path.join(repoRoot, ...component.fixture.split('/')), 'utf8');
        } catch {
          // Written without it: the component renders with its own defaults, or doctor says why not.
        }
      }
      const files = recipe.pointer(component, { iterationDir: folder, fixture });
      if (!files) {
        result.unpointed.push({ key, why: `it cannot be pointed at (${component.export})` });
        continue;
      }
      writeFiles(repoRoot, folder, files);
      result.written.push(key);
    }
  }
  return result;
}

/**
 * The real files a baseline shows, repo-relative, so its screenshots and pictures are taken again
 * when the app's code changes rather than only its pointer. None for any other iteration.
 */
export function baselineSources(
  repoRoot: string,
  target: { component: string; iteration: string }
): string[] {
  if (target.iteration !== BASELINE) return [];
  try {
    return (
      readMap(repoRoot)?.map.components.find(item => item.slug === target.component)?.files ?? []
    );
  } catch {
    return [];
  }
}
