// A page's composition promoted into the app (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 12, 50,
// 51, 53 and 56): the page's own files arranged in the composition's order, and each new section
// written as a new component file beside the page's own sections, by the designer's agent. The
// start refreshes the map, finds drift against the composition's `.base/` (in place, or a merge),
// snapshots the page's files and the new sections' files, puts the change on a branch when asked,
// sends slugs alone (`current`, the app's own order) and fills in the paths the server never sees.
// The finish is B4's (src/runs/promotion.ts); after a done one, the whole page is adopted again.
import fs from 'node:fs';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import type { ProjectTree } from '../api/types.js';
import { hasEnvironmentFile, readEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { BASELINE } from '../map/adopt.js';
import type { RepoMap } from '../map/types.js';
import { recipeOf } from '../recipes/index.js';
import { iterationDir } from '../repo/iterations.js';
import type { RepoLink } from '../repo/link.js';
import { ROUGH_DIR } from '../repo/root.js';
import { BASE_DIR, sameText } from '../runs/base.js';
import { hasExtension } from '../runs/checks.js';
import {
  checkTargetFile,
  fillInPrompt,
  newComponentFile,
  promoteWords,
  publicDirFor,
  referencedAssets,
  type AssetName
} from '../runs/promote.js';
import {
  checkAppFile,
  createBranch,
  planBranch,
  promoteFinishingSection,
  savePromotion,
  type PromoteTarget,
  type PromotionRecord
} from '../runs/promotion.js';
import { recordOwnWritesForOpenRuns, takeSnapshot } from '../runs/snapshot.js';
import { assertRunId } from '../runs/store.js';
import { appOrder, planComposition, type CompositionPlan } from './composition.js';
import { freshMap } from './save.js';
import { COMPOSITIONS_DIR, compositionDir, readComposition, readPageBase } from './store.js';

/** The stand-ins the backend writes in a page composition's promote prompt (B6's contract). */
export const PAGE_FILES_PLACEHOLDER = '{{roughbook:page-files}}';
export const NEW_SECTIONS_PLACEHOLDER = '{{roughbook:new-sections}}';

/** The branch a page's promote goes on unless the designer names one (decision 18). */
export function defaultPageBranch(page: string, composition: string): string {
  return `roughbook/${page}-${composition}`;
}

/** Where a page composition's promote prompt is written: beside its compositions, never in one. */
export function pagePromptFile(page: string, promotionId: string): string {
  return `${ROUGH_DIR}/${page}/${COMPOSITIONS_DIR}/prompts/promote-${assertRunId(promotionId)}.md`;
}

function toDisk(repoRoot: string, relative: string): string {
  return path.join(repoRoot, ...relative.split('/'));
}

function readBytes(repoRoot: string, file: string): Buffer | null {
  try {
    return fs.readFileSync(toDisk(repoRoot, file));
  } catch {
    return null;
  }
}

/** Every file under `dir` with one of the environment's source extensions. */
function textFiles(dir: string, sources: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === BASE_DIR ? [] : textFiles(full, sources);
    return hasExtension(entry.name, sources) ? [full] : [];
  });
}

/** `{{roughbook:new-sections}}`: one "new file ← iteration folder" pair per line. */
export function newSectionLines(page: string, targets: PromoteTarget[]): string {
  return targets
    .filter(target => target.section)
    .map(
      target =>
        `${target.path} ← ${iterationDir(page, target.section!.component, target.section!.iteration)}`
    )
    .join('\n');
}

/** The page prompt's stand-ins with this machine's paths. */
export function fillPageStandIns(
  prompt: string,
  page: string,
  composition: string,
  targets: PromoteTarget[],
  placeholders: { pageFiles?: string; newSections?: string; base?: string } = {}
): string {
  const pageFiles = targets
    .filter(target => !target.section)
    .map(target => target.path)
    .join('\n');
  return prompt
    .replaceAll(placeholders.pageFiles ?? PAGE_FILES_PLACEHOLDER, () => pageFiles)
    .replaceAll(placeholders.newSections ?? NEW_SECTIONS_PLACEHOLDER, () =>
      newSectionLines(page, targets)
    )
    .replaceAll(
      placeholders.base ?? '{{roughbook:base}}',
      () => `${compositionDir(page, composition)}/${BASE_DIR}/`
    );
}

export type PreparedPagePromotion = {
  promotionId: string;
  promptFile: string;
  how: 'in-place' | 'merge';
  /** The page's files, then each new section's file. */
  targets: PromoteTarget[];
  plan: CompositionPlan;
  /** Sections on an iteration that is not in the app: the app's version stays (decision 50). */
  keepsApp: { component: string; iteration: string; name: string }[];
  copied: string[];
  missing: AssetName[];
  branch: PromotionRecord['branch'];
};

export type PagePromoteOptions = {
  page: string;
  composition: string;
  /** Put the change on a new branch: its name, or true for `roughbook/<page>-<composition>`. */
  branch?: string | true;
  publicDir?: string;
  now?: () => Date;
};

/** What a page composition's promote would do, worked out here alone: no request, no write. */
export type PagePromotePlan = {
  how: 'in-place' | 'merge';
  /** The page's files, then each new section's file. */
  targets: PromoteTarget[];
  plan: CompositionPlan;
  keepsApp: PreparedPagePromotion['keepsApp'];
  /** The app's own order, from the map. */
  current: string[];
};

/**
 * Where a page composition's promote writes and whether the page moved since it was saved (B6):
 * the page's files, each against its copy in the composition's `.base/`, and a new file for each
 * new section beside the page's own sections. Throws in words when the composition or its
 * base is not here, a page file is gone, a new section's iteration is missing, or its file would
 * overwrite one.
 */
export function planPagePromote(
  repoRoot: string,
  environment: RepoEnvironment,
  map: RepoMap,
  tree: Pick<ProjectTree, 'pages' | 'delivery'>,
  publicDir: string,
  target: { page: string; composition: string }
): PagePromotePlan {
  const { page, composition: id } = target;
  const kept = readComposition(repoRoot, page, id);
  if (!kept) {
    throw new Error(`${compositionDir(page, id)} is not in this repo, so it cannot be promoted.`);
  }
  const folder = compositionDir(page, id);
  const base = readPageBase(repoRoot, page, id);
  if (!base) {
    throw new Error(
      `${folder}/${BASE_DIR}/ is missing, so the studio cannot tell whether the page changed since the composition was saved. Save a new composition of the page as it is now.`
    );
  }
  const current = appOrder(map, page);
  const mapPage = map.pages.find(item => item.slug === page)!;
  const inApp = new Set(map.components.map(item => item.slug));
  const plan = planComposition(current, kept.composition.sections);

  // The page's files, each against its copy in `.base/`, line endings set aside; a file the map
  // lists now that the composition did not keep is one the page gained since: a merge.
  const targets: PromoteTarget[] = [];
  for (const file of [...new Set([...base.files.map(item => item.path), ...mapPage.files])]) {
    const problem = checkAppFile(file, environment.ignore);
    if (problem) throw new Error(`${folder} cannot be promoted: ${problem}`);
    const now = readBytes(repoRoot, file);
    if (!now) {
      throw new Error(
        `${file} is no longer in the app, so ${page}'s ${id} cannot be written into it. Save a new composition of the page as it is now.`
      );
    }
    const original = base.files.some(item => item.path === file)
      ? readBytes(repoRoot, `${folder}/${BASE_DIR}/${file}`)
      : null;
    if (base.files.some(item => item.path === file) && !original) {
      throw new Error(
        `${folder}/${BASE_DIR}/${file} is missing, so the studio cannot tell whether the page changed since the composition was saved. Save a new composition of the page as it is now.`
      );
    }
    targets.push({
      path: file,
      copy: null,
      child: false,
      drifted: original === null || !sameText(now, original)
    });
  }

  // Each new section, not in the app, gets a new file.
  const names = new Map(
    (tree.pages.find(item => item.slug === page)?.components ?? []).map(item => [
      item.slug,
      item.name
    ])
  );
  const extensions = environment.promote.extensions;
  for (const section of plan.sections.filter(item => !inApp.has(item.component))) {
    const relative = iterationDir(page, section.component, section.iteration);
    if (!fs.existsSync(path.join(toDisk(repoRoot, relative), environment.entry))) {
      throw new Error(
        `${relative} has no ${environment.entry} in this repo, so ${section.component}'s file cannot be written from it.`
      );
    }
    const name = names.get(section.component) ?? section.component;
    // Beside the page's own sections, named like them (decision 56).
    const file = newComponentFile(repoRoot, environment, tree, map, {
      page,
      component: section.component,
      name
    });
    const problem = checkTargetFile(file, publicDir, extensions, environment.ignore);
    if (problem) throw new Error(`${name}: ${problem}`);
    if (fs.existsSync(toDisk(repoRoot, file)) || targets.some(target => target.path === file)) {
      throw new Error(
        `${file}, where ${name} would be written, already exists; Roughbook never overwrites the app's code. Rename the section, or move that file.`
      );
    }
    targets.push({
      path: file,
      copy: null,
      child: false,
      drifted: false,
      section: { component: section.component, iteration: section.iteration, name }
    });
  }
  const how = targets.some(target => target.drifted) ? 'merge' : 'in-place';
  const keepsApp = plan.sections
    .filter(item => inApp.has(item.component) && item.iteration !== BASELINE)
    .map(item => ({
      component: item.component,
      iteration: item.iteration,
      name: names.get(item.component) ?? item.component
    }));
  return { how, targets, plan, keepsApp, current };
}

/**
 * Starts a page composition's promote. Throws in words, before anything is asked or written, when
 * the composition or its base is not here, a page file is gone, a new section's iteration is
 * missing or its file would overwrite one, or the branch cannot be made.
 */
export async function preparePagePromotion(
  repoRoot: string,
  api: StudioApi,
  link: RepoLink,
  tree: ProjectTree,
  options: PagePromoteOptions
): Promise<PreparedPagePromotion> {
  const { page, composition: id } = options;
  const environment = await readEnvironment(repoRoot, link);
  const recipe = recipeOf(environment);
  const publicDir = publicDirFor(repoRoot, link, tree, options.publicDir, environment.assets.dir);
  // The app's own order, read fresh (decision 52).
  const map = await freshMap(repoRoot, environment, link);
  const { how, targets, plan, keepsApp, current } = planPagePromote(
    repoRoot,
    environment,
    map,
    tree,
    publicDir,
    options
  );

  // Refused before anything is asked or written: not git, a dirty target, a taken name.
  const plannedBranch =
    options.branch === undefined
      ? null
      : await planBranch(
          repoRoot,
          options.branch === true ? defaultPageBranch(page, id) : options.branch,
          [
            ...targets.map(target => target.path),
            ...(environment.copy.kind === 'localized' ? [environment.copy.file] : [])
          ]
        );

  const sources = targets
    .filter(target => target.section)
    .flatMap(target =>
      textFiles(
        toDisk(repoRoot, iterationDir(page, target.section!.component, target.section!.iteration)),
        environment.sources
      )
    )
    .map(file => fs.readFileSync(file, 'utf8'));
  const promotion = await api.promotePage(link.orgId, link.project, {
    page,
    composition: id,
    current,
    how,
    family: environment.family,
    assets: referencedAssets(sources, link.project)
  });
  assertRunId(promotion.promotionId);

  // Before anything is written, so revert puts the targets back whatever the agent does.
  await takeSnapshot(
    repoRoot,
    [promotion.promotionId],
    environment.ignore,
    targets.map(target => target.path)
  );
  if (plannedBranch) await createBranch(repoRoot, plannedBranch.name, plannedBranch.commit);

  const copied: string[] = [];
  const missing: AssetName[] = [...promotion.missingAssets];
  for (const asset of promotion.assets) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.file)) continue;
    const to = `${publicDir}/rough/${page}/${id}/${asset.file}`;
    const bytes = await api.file(link.orgId, link.project, asset.scope, asset.file);
    fs.mkdirSync(path.dirname(toDisk(repoRoot, to)), { recursive: true });
    fs.writeFileSync(toDisk(repoRoot, to), bytes);
    copied.push(to);
  }
  // A new section's approved copy, beside its iterations, as a component's promote writes it.
  const copies: string[] = [];
  for (const made of promotion.newSections ?? []) {
    if (made.copyMarkdown === null || !targets.some(t => t.section?.component === made.component)) {
      continue;
    }
    const file = `${ROUGH_DIR}/${page}/${made.component}/copy.md`;
    fs.writeFileSync(toDisk(repoRoot, file), made.copyMarkdown);
    copies.push(file);
  }

  const promptFile = pagePromptFile(page, promotion.promotionId);
  fs.mkdirSync(path.dirname(toDisk(repoRoot, promptFile)), { recursive: true });
  const words = promoteWords(environment, recipe, publicDir, {
    hasEnvironmentFile: hasEnvironmentFile(repoRoot)
  });
  const prompt = fillPageStandIns(
    fillInPrompt(promotion, targets[0]!.path, publicDir, words),
    page,
    id,
    targets,
    promotion.placeholders
  );
  fs.writeFileSync(
    toDisk(repoRoot, promptFile),
    `${prompt.trimEnd()}\n\n${promoteFinishingSection(promotion.promotionId, how)}`
  );
  await recordOwnWritesForOpenRuns(repoRoot, [...copied, ...copies, promptFile]);
  const branch = plannedBranch
    ? { name: plannedBranch.name, from: plannedBranch.from, commit: plannedBranch.commit }
    : null;
  await savePromotion(repoRoot, {
    promotionId: promotion.promotionId,
    orgId: link.orgId,
    project: link.project,
    page,
    component: COMPOSITIONS_DIR,
    iteration: id,
    subject: 'page',
    how,
    targets,
    studioWrites: copied,
    promptFile,
    branch,
    startedAt: (options.now?.() ?? new Date()).toISOString(),
    status: 'started',
    finishedAt: null,
    result: null,
    commit: null
  });
  return {
    promotionId: promotion.promotionId,
    promptFile,
    how,
    targets,
    plan,
    keepsApp,
    copied,
    missing,
    branch
  };
}

/** What the start found, as the terminal says it: the plan, the files, and the branch. */
export function describePageStart(
  prepared: PreparedPagePromotion,
  page: string,
  id: string,
  name: (slug: string) => string
): string[] {
  const lines = [
    prepared.how === 'merge'
      ? `Promoting ${page}'s ${id} into the page as a merge: the page changed since the composition was saved, so the agent keeps both changes, or writes nothing and says where they conflict.`
      : `Promoting ${page}'s ${id} into the page, in place: its files are as they were when it was saved.`
  ];
  for (const target of prepared.targets) {
    lines.push(
      target.section
        ? `  + ${target.path}: ${target.section.name}, a new section, from ${iterationDir(page, target.section.component, target.section.iteration)}`
        : `  ${target.path}${target.drifted ? ': changed in the app since the composition was saved' : ''}`
    );
  }
  const { counts } = prepared.plan;
  lines.push(
    `  ${counts.kept} kept, ${counts.moved} moved, ${counts.added} added, ${counts.removed} removed.`
  );
  for (const item of prepared.keepsApp) {
    lines.push(
      `  ${name(item.component)} keeps the app's own version here; roughbook promote ${page}/${item.component} --iteration ${item.iteration} ships ${item.iteration}.`
    );
  }
  if (prepared.branch) {
    lines.push(
      `  On a new branch, ${prepared.branch.name}, from ${prepared.branch.from ?? 'the current commit'}; the studio commits there only on your yes, and never pushes.`
    );
  }
  return lines;
}
