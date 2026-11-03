// A page's compositions in the local UI (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 46 to 52),
// which read as the page's versions: Save version keeps the page as the canvas shows it, each
// section on the iteration it shows, in one click, named by the date and time (decided 3 November
// 2026, reports/Composite audit.md section 15); a section is one of the page's components with an
// iteration in this repo; the composed preview is the recipe's route, where it composes (decision
// 54).
import { pageComposite, slotRuns } from '@roughbook/ui/canvas';
import { BASELINE, type StudioCanvas } from './canvas-input.ts';
import type { CompositionView, ProjectView } from './types.ts';

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
  /** When the map found its component gone from the app (B7): its baseline is marked gone. */
  gone?: string | null;
  href?: string;
};

/** The parameter the composed preview reads: `roughbook-compose=<component>:<iteration>,…`. */
export const COMPOSE_PARAM = 'roughbook-compose';

/** The map's components gone from the app (B7), with the day each went. */
function goneOf(project: ProjectView): Map<string, string> {
  return new Map(
    (project.local.map?.components ?? []).flatMap(item =>
      item.gone ? [[item.slug, item.gone] as const] : []
    )
  );
}

/** An adopted page of the map, the only kind a composition is made of (B6's contract). */
export function canCompose(project: ProjectView, page: string): boolean {
  const adopted = project.tree.pages.find(item => item.slug === page)?.inApp === true;
  return adopted && Boolean(project.local.map?.pages.some(item => item.slug === page));
}

/**
 * A version's name: the day and the time it was saved, in the viewer's locale ("3 Nov, 14:05" in
 * British English). `locale` is for the tests; the viewer's own is used without it.
 */
export function versionName(at: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(at);
}

/**
 * The page as the canvas shows it, to save as a version: each section on the iteration it shows
 * (its chosen one, or what stands in without a choice), top to bottom. Every one must be an
 * iteration in this repo, since a version is kept in rough/; otherwise why not, in words.
 */
export function versionOf(
  canvas: StudioCanvas,
  page: string
): { sections: { component: string; iteration: string }[] } | { problem: string } {
  const section = canvas.input.sections.find(item => item.id === page);
  const slots = section ? pageComposite(section).filter(slotRuns) : [];
  if (!slots.length) return { problem: 'The page has no sections to save yet.' };
  const problems: string[] = [];
  const sections = slots.map(slot => {
    const iteration = slot.card!.id;
    const facts = canvas.cards[`iteration:${page}/${slot.component}/${iteration}`];
    if (facts?.kind === 'map') {
      problems.push(`${slot.name} is the app's, not adopted yet: adopt it first.`);
    } else if (facts?.kind === 'sketch') {
      problems.push(`${slot.name} shows a web sketch: pull it into this repo first.`);
    } else if (facts?.kind !== 'local' || !facts.generated || facts.run) {
      problems.push(`${slot.name} is still being made: save once it is done.`);
    }
    return { component: slot.component, iteration };
  });
  return problems.length
    ? { problem: `A version keeps the page in this repo. ${problems.join(' ')}` }
    : { sections };
}

/** A page's versions kept here, newest first. */
export function pageVersions(project: ProjectView, page: string): CompositionView[] {
  return (project.local.compositions ?? [])
    .filter(item => item.page === page)
    .sort((a, b) => b.number - a.number);
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

/** Where a frame on this page shows a snapshot stack's page, from its rendered images. */
export function snapshotPageSrc(page: string, sections: DraftSection[], shotKey: string): string {
  return `${webPageSrc(page, sections, shotKey)}&source=snapshots`;
}

/** Where a frame on this page runs a page's web sketches: this server sends it to the sandbox. */
export function webPageSrc(page: string, sections: DraftSection[], shotKey: string): string {
  const value = encodeURIComponent(composeValue(sections));
  return `/api/pages/${page}/composed?sections=${value}&key=${encodeURIComponent(shotKey)}`;
}

/**
 * A page's sections as they run: the repo's on the app and the rest on the sandbox, each run of them
 * one frame, in order. One address when one frame holds them all; null when any cannot run.
 */
export function pageParts(
  page: string,
  sections: { component: string; iteration: string }[],
  runners: {
    here: ReadonlySet<string>;
    local: ((sections: DraftSection[]) => string | null) | null;
    web: ((sections: DraftSection[]) => string | null) | null;
  }
): string | { src: string; sections: { component: string; iteration: string }[] }[] | null {
  const isLocal = (section: { component: string; iteration: string }) =>
    runners.here.has(`${page}/${section.component}/${section.iteration}`);
  const runs: { local: boolean; sections: typeof sections }[] = [];
  for (const section of sections) {
    const last = runs.at(-1);
    if (last && last.local === isLocal(section)) last.sections.push(section);
    else runs.push({ local: isLocal(section), sections: [section] });
  }
  const parts = runs.map(run => ({
    src: (run.local ? runners.local : runners.web)?.(run.sections) ?? null,
    sections: run.sections
  }));
  if (!parts.length || parts.some(part => part.src === null)) return null;
  const ready = parts as { src: string; sections: typeof sections }[];
  return ready.length === 1 ? ready[0]!.src : ready;
}

/** The preview's key for a page's composition: what its route says ready with, as the editor's. */
export function composedKey(page: string): string {
  return `${page}/composition`;
}

/** A composition's name, or its number's when the designer gave none. */
export function compositionName(view: Pick<CompositionView, 'name' | 'number'>): string {
  return view.name.trim() || `Version ${view.number}`;
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
  const gone = goneOf(project);
  return view.sections.map(section => {
    const component = record?.components.find(item => item.slug === section.component);
    const iteration = component?.iterations.find(item => item.id === section.iteration);
    const key = `${view.page}/${section.component}/${section.iteration}`;
    return {
      ...section,
      name: component?.name ?? section.component,
      ...(iteration && section.iteration !== BASELINE ? { iterationName: iteration.name } : {}),
      inApp: inApp.has(section.component),
      ...(gone.has(section.component) ? { gone: gone.get(section.component)! } : {}),
      ...(here.has(key) ? { href: `/${key}` } : {})
    };
  });
}

/** A composition's own view. */
export function compositionAddress(page: string, id: string): string {
  return `/${page}/compositions/${id}`;
}
