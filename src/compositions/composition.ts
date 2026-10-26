// A page's composition (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 12 and 46 to 54): the
// page's sections in order, each on its chosen iteration or its baseline. The app's own order is
// the map's `sections` for the page, read fresh when a composition starts and when one is
// promoted; it is the starting point, never a record (decision 52). The plan compares a
// composition with that order: each section kept, moved or added, and the app's sections it
// removes, a replace being one removed and one added in its place. Pure: nothing here reads or
// writes a file.
import { BASELINE } from '../map/adopt.js';
import type { RepoMap } from '../map/types.js';
import { ITERATION, SLUG } from '../repo/iterations.js';

/** One section of a composition: a component of the page, on one of its iterations. */
export type CompositionSection = { component: string; iteration: string };

/** `rough/<page>/compositions/composition-NN/composition.json` (decision 51). */
export type Composition = {
  name: string;
  /** The composition it was made from, or null for one made from the app's own order. */
  parent: string | null;
  sections: CompositionSection[];
};

/** At most this many sections in one composition (B6's contract). */
export const MAX_SECTIONS = 30;

/** A composition's id, as the backend numbers them from 1 (decision 52). */
export const COMPOSITION_ID = /^composition-\d{2,}$/;

/** The id of the composition numbered `number`: `composition-01`. */
export function compositionId(number: number): string {
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${number} is not a composition's number.`);
  }
  return `composition-${String(number).padStart(2, '0')}`;
}

/**
 * The sections a designer typed: `<component>[:<iteration>],…`, where a section without an
 * iteration is on its baseline. Throws in words on anything else; the rules of a composition are
 * checked by `compositionProblems`.
 */
export function parseSections(text: string): CompositionSection[] {
  const parts = text
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    throw new Error('Name the sections in order: --sections hero,pricing:iteration-02,faq');
  }
  return parts.map(part => {
    const [component = '', iteration = BASELINE, extra] = part.split(':').map(item => item.trim());
    if (extra !== undefined || !SLUG.test(component) || !ITERATION.test(iteration)) {
      throw new Error(
        `${part} is not a section: write <component> for its baseline, or <component>:iteration-NN.`
      );
    }
    return { component, iteration };
  });
}

/** The sections as an address carries them: `hero:iteration-00,pricing:iteration-02`. */
export function formatSections(sections: CompositionSection[]): string {
  return sections.map(section => `${section.component}:${section.iteration}`).join(',');
}

/**
 * The app's own order of a page's sections, from the map; throws in words when the map has no
 * such page.
 */
export function appOrder(map: RepoMap, page: string): string[] {
  const found = map.pages.find(item => item.slug === page);
  if (!found) {
    throw new Error(`rough/map.md has no page ${page}. Run roughbook map, then try again.`);
  }
  return [...found.sections];
}

/** Where the composition editor starts (decision 52): the app's own order, each on its baseline. */
export function startingComposition(map: RepoMap, page: string): CompositionSection[] {
  return appOrder(map, page).map(component => ({ component, iteration: BASELINE }));
}

/**
 * What is wrong with a composition of a page, in words, or an empty list: the count, repeats,
 * baselines named for a section the app does not have, and the app's components the page has not
 * adopted. `current` is the app's own order; `inApp` the components the app has anywhere (the
 * map's); `ofPage` those adopted on this page, with a baseline here, which may join it again.
 */
export function compositionProblems(
  sections: CompositionSection[],
  current: string[],
  inApp: ReadonlySet<string>,
  ofPage: ReadonlySet<string> = new Set()
): string[] {
  const problems: string[] = [];
  if (!sections.length) problems.push('A composition needs at least one section.');
  if (sections.length > MAX_SECTIONS) {
    problems.push(
      `A composition holds at most ${MAX_SECTIONS} sections; this one has ${sections.length}.`
    );
  }
  const seen = new Set<string>();
  const own = new Set(current);
  for (const section of sections) {
    if (seen.has(section.component)) {
      problems.push(`${section.component} is in it twice; a composition has each section once.`);
      continue;
    }
    seen.add(section.component);
    if (own.has(section.component) || ofPage.has(section.component)) continue;
    if (inApp.has(section.component)) {
      problems.push(
        `${section.component} is the app's, but not one of this page's components: a composition arranges the page's own sections and new ones. Adopt it on this page first.`
      );
    } else if (section.iteration === BASELINE) {
      problems.push(
        `${section.component} is a new section, not in the app, so it has no baseline: name its iteration, ${section.component}:iteration-NN.`
      );
    }
  }
  return problems;
}

/** What a composition does with one of its sections, against the app's own order. */
export type SectionStatus = 'kept' | 'moved' | 'added';

export type SectionPlan = CompositionSection & {
  status: SectionStatus;
  /** Its place in the app's own order, or null for an added section. */
  from: number | null;
  /** An added section in the place of a removed one: a replace (B6's contract). */
  replaces: string | null;
};

export type CompositionPlan = {
  sections: SectionPlan[];
  /** The app's sections the composition leaves out, in the app's order. */
  removed: string[];
  counts: { kept: number; moved: number; added: number; removed: number };
};

/**
 * The indexes of a longest increasing run of `values`, in order: the sections that keep their
 * order, so the fewest are counted as moved.
 */
function longestIncreasing(values: number[]): Set<number> {
  const tails: number[] = [];
  const previous: number[] = new Array<number>(values.length).fill(-1);
  values.forEach((value, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]!]! < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  });
  const kept = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index]!) kept.add(index);
  return kept;
}

/**
 * The plan of a composition against the app's own order (B6's contract): each section kept (it
 * keeps its order among the app's sections), moved, or added (not in the app's page), and the
 * app's sections it removes. An added section between the same neighbours as a removed one takes
 * its place: a replace.
 */
export function planComposition(
  current: string[],
  sections: CompositionSection[]
): CompositionPlan {
  const at = new Map(current.map((component, index) => [component, index]));
  const existing = sections
    .map((section, index) => ({ index, from: at.get(section.component) }))
    .filter((item): item is { index: number; from: number } => item.from !== undefined);
  const inOrder = longestIncreasing(existing.map(item => item.from));
  const kept = new Set(existing.filter((_, index) => inOrder.has(index)).map(item => item.index));
  const present = new Set(sections.map(section => section.component));
  const removed = current.filter(component => !present.has(component));

  const claimed = new Set<string>();
  const planned = sections.map((section, index): SectionPlan => {
    const from = at.get(section.component);
    if (from !== undefined) {
      return { ...section, status: kept.has(index) ? 'kept' : 'moved', from, replaces: null };
    }
    // Between its neighbours from the app, the first removed section there is the one it replaces.
    const before = sections
      .slice(0, index)
      .map(item => at.get(item.component))
      .filter((item): item is number => item !== undefined);
    const after = sections
      .slice(index + 1)
      .map(item => at.get(item.component))
      .find((item): item is number => item !== undefined);
    const low = before.length ? Math.max(...before) : -1;
    const high = after ?? current.length;
    const replaces =
      removed.find(component => {
        const place = at.get(component)!;
        return place > low && place < high && !claimed.has(component);
      }) ?? null;
    if (replaces) claimed.add(replaces);
    return { ...section, status: 'added', from: null, replaces };
  });
  const count = (status: SectionStatus) => planned.filter(item => item.status === status).length;
  return {
    sections: planned,
    removed,
    counts: {
      kept: count('kept'),
      moved: count('moved'),
      added: count('added'),
      removed: removed.length
    }
  };
}

/** The plan in a few lines for the terminal and the agent's report, by the sections' names. */
export function describePlan(plan: CompositionPlan, name: (slug: string) => string): string[] {
  const iteration = (section: CompositionSection) =>
    section.iteration === BASELINE ? 'the app’s own' : section.iteration;
  const lines = plan.sections.map((section, index) => {
    const what =
      section.status === 'added'
        ? section.replaces
          ? `added, in place of ${name(section.replaces)}`
          : 'added'
        : section.status;
    return `  ${index + 1}. ${name(section.component)} (${iteration(section)}): ${what}`;
  });
  for (const component of plan.removed) {
    if (!plan.sections.some(section => section.replaces === component)) {
      lines.push(`  - ${name(component)}: removed`);
    } else {
      lines.push(`  - ${name(component)}: removed, replaced`);
    }
  }
  return lines;
}
