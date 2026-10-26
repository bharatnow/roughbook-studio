// Saving a page's composition and making a new section for it (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md,
// decisions 46, 47, 51 and 52), from `roughbook section`, the composition command or the local UI's
// editor. The backend makes the records (a component from its name, a composition's number) from
// slugs, ids and short text alone; the studio writes the folders in rough/, takes the composed
// preview's pictures where the recipe composes, and sends them through the outbox.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import type { Outbox } from '../api/outbox.js';
import type { RepoEnvironment } from '../environment/types.js';
import { BASELINE } from '../map/adopt.js';
import { componentSlug } from '../map/build.js';
import { readMap } from '../map/file.js';
import { refreshMap } from '../map/run.js';
import type { RepoMap } from '../map/types.js';
import {
  shareCompositionPictures,
  type PictureReport,
  type PictureShot
} from '../pictures/share.js';
import { COMPOSE_PARAM } from '../recipes/context.js';
import { recipeFor } from '../recipes/index.js';
import { SLUG, iterationDir } from '../repo/iterations.js';
import type { RepoLink } from '../repo/link.js';
import { ROUGH_DIR } from '../repo/root.js';
import { headCommit } from '../runs/base.js';
import { recordOwnWritesForOpenRuns } from '../runs/snapshot.js';
import { iterationHash } from '../screenshot/iteration.js';
import {
  COMPOSITION_ID,
  appOrder,
  compositionId,
  compositionProblems,
  formatSections,
  planComposition,
  type Composition,
  type CompositionPlan,
  type CompositionSection
} from './composition.js';
import {
  COMPOSITIONS_DIR,
  COMPOSITION_FILE,
  compositionDir,
  missingSections,
  readComposition,
  writeComposition
} from './store.js';

/** A name the backend takes for a section or a composition: short text the designer typed. */
const MAX_NAME = 120;

function toDisk(repoRoot: string, relative: string): string {
  return path.join(repoRoot, ...relative.split('/'));
}

/** The map, refreshed first when the app's sources changed since it was written (decision 52). */
export async function freshMap(
  repoRoot: string,
  environment: RepoEnvironment,
  link: RepoLink | null
): Promise<RepoMap> {
  try {
    await refreshMap(repoRoot, environment, link);
  } catch {
    // The map as it is still says the page's order; doctor names what went wrong.
  }
  const map = readMap(repoRoot)?.map;
  if (!map) throw new Error(`There is no ${ROUGH_DIR}/map.md yet. Run roughbook map first.`);
  return map;
}

/** The components adopted on a page here: each with its baseline in rough/. */
export function adoptedOn(repoRoot: string, page: string, map: RepoMap): Set<string> {
  return new Set(
    map.components
      .map(item => item.slug)
      .filter(slug => fs.existsSync(toDisk(repoRoot, iterationDir(page, slug, BASELINE))))
  );
}

/**
 * The composed preview's address on the preview server, for a recipe that composes (decision 54),
 * or null where the sections are shown one under another instead.
 */
export function composedAddress(
  environment: Pick<RepoEnvironment, 'preview' | 'recipe' | 'mode'>,
  page: string,
  sections: CompositionSection[]
): string | null {
  if (environment.mode !== 'live' || !recipeFor(environment.recipe)?.composes) return null;
  const route = environment.preview.replaceAll('{key}', page);
  return `${route}${route.includes('?') ? '&' : '?'}${COMPOSE_PARAM}=${formatSections(sections)}`;
}

/**
 * What a composition's pictures show: each section's iteration as its screenshots are hashed (a
 * baseline with the app's files it points at), in order. Null when a section is not in this repo.
 */
export function compositionHash(
  repoRoot: string,
  page: string,
  composition: Composition,
  environment: Pick<RepoEnvironment, 'viewports' | 'variants' | 'overlays'>
): string | null {
  const hash = createHash('sha256').update(`composition\0${page}\0`);
  for (const section of composition.sections) {
    const one = iterationHash(repoRoot, { page, ...section }, environment);
    if (!one) return null;
    hash.update(`${section.component}\0${section.iteration}\0${one}\0`);
  }
  return hash.digest('hex');
}

export type SavedComposition = {
  page: string;
  id: string;
  number: number;
  /** Its folder, repo-relative. */
  folder: string;
  composition: Composition;
  /** The plan against the app's own order, as it was when it was saved. */
  plan: CompositionPlan;
};

/**
 * Saves a composition of a page: checked against the map's order (read fresh) and the folders in
 * rough/, numbered by the backend, then written with the page's files in `.base/`. Throws in
 * words before anything is asked or written.
 */
export async function saveComposition(
  repoRoot: string,
  api: StudioApi,
  link: RepoLink,
  environment: RepoEnvironment,
  input: { page: string; sections: CompositionSection[]; name?: string; parent?: string }
): Promise<SavedComposition> {
  const { page, sections } = input;
  if (!SLUG.test(page)) throw new Error(`${page} is not a page's slug.`);
  const name = input.name?.trim() ?? '';
  if (name.length > MAX_NAME) {
    throw new Error(`A composition's name holds at most ${MAX_NAME} characters.`);
  }
  if (input.parent !== undefined) {
    if (!COMPOSITION_ID.test(input.parent) || !readComposition(repoRoot, page, input.parent)) {
      throw new Error(
        `${input.parent} is not one of ${page}'s compositions in this repo (${ROUGH_DIR}/${page}/${COMPOSITIONS_DIR}/).`
      );
    }
  }
  const map = await freshMap(repoRoot, environment, link);
  const current = appOrder(map, page);
  const problems = [
    ...compositionProblems(
      sections,
      current,
      new Set(map.components.map(item => item.slug)),
      adoptedOn(repoRoot, page, map)
    ),
    ...missingSections(repoRoot, environment.entry, page, sections)
  ];
  if (problems.length) throw new Error(problems.join('\n'));
  const pageRecord = map.pages.find(item => item.slug === page)!;

  const created = await api.createComposition(link.orgId, link.project, page, {
    sections,
    ...(name ? { name } : {}),
    ...(input.parent ? { parent: input.parent } : {})
  });
  if (!Number.isInteger(created.number) || created.id !== compositionId(created.number)) {
    throw new Error(
      `The server numbered the composition ${created.id}, which the studio cannot read.`
    );
  }
  const composition: Composition = { name, parent: input.parent ?? null, sections };
  await writeComposition(repoRoot, pageRecord, created.id, composition, await headCommit(repoRoot));
  const folder = compositionDir(page, created.id);
  // Runs still open did not write it, so their Done does not count it.
  await recordOwnWritesForOpenRuns(repoRoot, [
    `${folder}/${COMPOSITION_FILE}`,
    ...pageRecord.files.map(file => `${folder}/.base/${file}`),
    `${folder}/.base/base.json`
  ]);
  return {
    page,
    id: created.id,
    number: created.number,
    folder,
    composition,
    plan: planComposition(current, sections)
  };
}

/**
 * A new section of a page (decision 47): made on the backend from its name, and its folder in
 * rough/. Its first iteration is a run like any other. Throws in words.
 */
export async function makeSection(
  repoRoot: string,
  api: StudioApi,
  link: RepoLink,
  environment: RepoEnvironment,
  input: { page: string; name: string }
): Promise<{ page: string; slug: string; name: string; folder: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('Name the new section: --name "Customer logos".');
  if (name.length > MAX_NAME) {
    throw new Error(`A section's name holds at most ${MAX_NAME} characters.`);
  }
  if (componentSlug(name) === COMPOSITIONS_DIR) {
    throw new Error(
      `A section cannot be named ${name}: ${ROUGH_DIR}/${input.page}/${COMPOSITIONS_DIR}/ holds the page's compositions.`
    );
  }
  const map = await freshMap(repoRoot, environment, link);
  if (!map.pages.some(item => item.slug === input.page)) {
    throw new Error(
      `${ROUGH_DIR}/map.md has no page ${input.page}. A new section joins one of the app's pages; run roughbook map, then try again.`
    );
  }
  const made = await api.createSection(link.orgId, link.project, input.page, name);
  if (!SLUG.test(made.slug) || made.slug === COMPOSITIONS_DIR) {
    throw new Error(`The server made the section as ${made.slug}, which the studio cannot use.`);
  }
  if (map.components.some(item => item.slug === made.slug)) {
    throw new Error(
      `The server made the section as ${made.slug}, the slug of one of the app's components. Name it differently.`
    );
  }
  const folder = `${ROUGH_DIR}/${input.page}/${made.slug}`;
  fs.mkdirSync(toDisk(repoRoot, folder), { recursive: true });
  return { page: input.page, slug: made.slug, name: made.name ?? name, folder };
}

/**
 * Takes a composition's pictures at its composed preview on `base` and sends them through the
 * outbox, as an iteration's are; a report, or why none were taken.
 */
export async function shareComposition(
  input: {
    repoRoot: string;
    api: StudioApi;
    outbox: Outbox;
    link: RepoLink;
    environment: RepoEnvironment;
    shoot: PictureShot;
    force?: boolean;
  },
  target: { page: string; id: string },
  base: string
): Promise<PictureReport> {
  const empty = (skipped: string): PictureReport => ({
    sent: [],
    queued: [],
    unchanged: [],
    skipped,
    warning: null
  });
  const kept = readComposition(input.repoRoot, target.page, target.id);
  if (!kept) return empty('NOT_IN_REPO');
  const address = composedAddress(input.environment, target.page, kept.composition.sections);
  if (!address)
    return empty('not pictured: this stack’s preview does not render a page’s composition yet');
  const hash = compositionHash(input.repoRoot, target.page, kept.composition, input.environment);
  if (!hash) return empty('NOT_IN_REPO');
  return shareCompositionPictures(
    input,
    { page: target.page, composition: target.id },
    `${base.replace(/\/+$/, '')}${address}`,
    hash
  );
}
