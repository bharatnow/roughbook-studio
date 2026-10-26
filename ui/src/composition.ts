// A page's compositions in the local UI (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 46 to 52):
// the project read and rough/ as @roughbook/ui's CompositionEditor and CompositionSections take
// them. The editor starts from the map's order on baselines (decision 52); a section is one of the
// page's components with an iteration in this repo; the composed preview is the recipe's route,
// where it composes (decision 54).
import { BASELINE } from './canvas-input.ts';
import type { CompositionView, ProjectView } from './types.ts';

/** One of the page's components a section may be, with its iterations in this repo. */
export type ComposerComponent = {
  slug: string;
  name: string;
  iterations: { id: string; name: string; status?: string }[];
  selected?: string | null;
};

/** A section while it is composed; a new section has no iteration until its first run. */
export type DraftSection = { component: string; iteration: string | null };

/** A saved section as CompositionSections lists it. */
export type SectionItem = {
  component: string;
  iteration: string;
  name?: string;
  iterationName?: string;
  /** Whether its component is the app's own; false marks it New. */
  inApp?: boolean;
  href?: string;
};

/** The parameter the composed preview reads: `roughbook-compose=<component>:<iteration>,…`. */
export const COMPOSE_PARAM = 'roughbook-compose';

/** An adopted page of the map, the only kind a composition is made of (B6's contract). */
export function canCompose(project: ProjectView, page: string): boolean {
  const adopted = project.tree.pages.find(item => item.slug === page)?.inApp === true;
  return adopted && Boolean(project.local.map?.pages.some(item => item.slug === page));
}

/**
 * The page's components a composition may hold: the app's sections in the page's order, then the
 * page's other components (new sections made here, or the app's adopted on it), each with its
 * iterations in this repo. A section of the map that is not adopted here has no baseline to show.
 */
export function compositionComponents(project: ProjectView, page: string): ComposerComponent[] {
  const record = project.tree.pages.find(item => item.slug === page);
  const map = project.local.map;
  const own = map?.pages.find(item => item.slug === page)?.sections ?? [];
  const here = new Set(project.local.iterations);
  const slugs = [
    ...new Set([...own, ...(record?.components.map(component => component.slug) ?? [])])
  ];
  return slugs.flatMap(slug => {
    const component = record?.components.find(item => item.slug === slug);
    const iterations = (component?.iterations ?? [])
      .filter(item => here.has(`${page}/${slug}/${item.id}`))
      .map(item => ({ id: item.id, name: item.name, status: item.status }));
    if (!component) return [];
    const selected = component.iterations.find(
      item => item.number === component.selectedIteration
    )?.id;
    return [
      {
        slug,
        name: component.name,
        iterations,
        ...(selected ? { selected } : {})
      }
    ];
  });
}

/** Where the editor starts: the app's own order, each section on its baseline here. */
export function appSections(project: ProjectView, page: string): DraftSection[] {
  const here = new Set(project.local.iterations);
  return (project.local.map?.pages.find(item => item.slug === page)?.sections ?? [])
    .filter(slug => here.has(`${page}/${slug}/${BASELINE}`))
    .map(component => ({ component, iteration: BASELINE }));
}

/** The sections as the composed preview's parameter carries them, those with an iteration. */
export function composeValue(sections: DraftSection[]): string {
  return sections
    .filter(section => section.iteration)
    .map(section => `${section.component}:${section.iteration}`)
    .join(',');
}

/**
 * The composed preview's address on the app for any sections, or null where the recipe does not
 * compose: the editor's preview follows the choice as it is made.
 */
export function composedSrc(
  project: ProjectView,
  devUrl: string,
  page: string
): ((sections: DraftSection[]) => string | null) | null {
  const template = project.local.composeTemplate;
  if (!template) return null;
  return sections => {
    const value = composeValue(sections);
    return value ? `${devUrl}${template.replaceAll('{page}', page)}${value}` : null;
  };
}

/** The preview's key for a page's composition: what its route says ready with, as the editor's. */
export function composedKey(page: string): string {
  return `${page}/composition`;
}

/** A composition's name, or its number's when the designer gave none. */
export function compositionName(view: Pick<CompositionView, 'name' | 'number'>): string {
  return view.name.trim() || `Composition ${view.number}`;
}

/** A composition of a page kept here, by id. */
export function findComposition(
  project: ProjectView,
  page: string,
  id: string
): CompositionView | null {
  return project.local.compositions?.find(item => item.page === page && item.id === id) ?? null;
}

/** A saved composition's sections, named, marked and linked to their iterations here. */
export function sectionItems(project: ProjectView, view: CompositionView): SectionItem[] {
  const record = project.tree.pages.find(item => item.slug === view.page);
  const inApp = new Set(project.local.map?.components.map(item => item.slug) ?? []);
  const here = new Set(project.local.iterations);
  return view.sections.map(section => {
    const component = record?.components.find(item => item.slug === section.component);
    const iteration = component?.iterations.find(item => item.id === section.iteration);
    const key = `${view.page}/${section.component}/${section.iteration}`;
    return {
      ...section,
      name: component?.name ?? section.component,
      ...(iteration && section.iteration !== BASELINE ? { iterationName: iteration.name } : {}),
      inApp: inApp.has(section.component),
      ...(here.has(key) ? { href: `/${key}` } : {})
    };
  });
}

/** The editor's address for a page, starting from a composition when one is named. */
export function composeAddress(page: string, from?: string | null): string {
  return `/${page}/compose${from ? `?from=${from}` : ''}`;
}

/** A composition's own view. */
export function compositionAddress(page: string, id: string): string {
  return `/${page}/compositions/${id}`;
}
