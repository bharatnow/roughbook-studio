// Promote, the studio's half: a selected local iteration becomes a production component in this
// repo. The backend renders the prompt from the brief; the studio copies the assets the iteration
// uses into the app's public folder and the approved copy beside the reference, fills in the
// paths the server never sees, and hands the prompt to the designer's agent. Ported from roughbook
// src/lib/delivery/promote.ts (v2-local). The studio never edits the app's code itself, and
// commits only on a branch the designer asked for, on their yes (B4, in promotion.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import type { AssetScope, ComponentRecord, Promotion, ProjectTree } from '../api/types.js';
import { ENVIRONMENT_LINE, hasEnvironmentFile, readEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { fallbackRecipe, recipeOf } from '../recipes/index.js';
import type { Recipe } from '../recipes/types.js';
import { iterationDir } from '../repo/iterations.js';
import type { RepoLink } from '../repo/link.js';
import { pascalCase } from '../repo/names.js';
import { ROUGH_DIR } from '../repo/root.js';
import { readBase, recordChildren } from './base.js';
import { hasExtension } from './checks.js';
import {
  createBranch,
  defaultBranch,
  fillPromoteStandIns,
  planBranch,
  planTargets,
  promoteFinishingSection,
  savePromotion,
  type PromoteHow,
  type PromoteTarget,
  type PromotionRecord
} from './promotion.js';
import { assertTarget } from './slots.js';
import { recordOwnWritesForOpenRuns, takeSnapshot } from './snapshot.js';
import { assertRunId } from './store.js';

export type AssetName = { scope: AssetScope; file: string };

const ASSET_URL = /\/api\/files\/(project\/([a-z0-9][a-z0-9-]*)|library)\/([A-Za-z0-9._%-]+)/g;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The project and library asset files an iteration's source refers to, each once. */
export function referencedAssets(sources: string[], projectSlug: string): AssetName[] {
  const seen = new Map<string, AssetName>();
  for (const source of sources) {
    for (const match of source.matchAll(ASSET_URL)) {
      const scope: AssetScope = match[1] === 'library' ? 'library' : 'project';
      // Another project's files are not this client's to ship.
      if (scope === 'project' && match[2] !== projectSlug) continue;
      let file: string;
      try {
        file = decodeURIComponent(match[3]!);
      } catch {
        continue;
      }
      if (FILE_NAME.test(file)) seen.set(`${scope}/${file}`, { scope, file });
    }
  }
  return [...seen.values()];
}

/** The ignored folder `file` is in, or null: what the environment's `ignore` names. */
function ignoredFolder(file: string, ignore: string[]): string | null {
  for (const item of ignore) {
    const folder = item.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
    if (folder && (file === folder || file.startsWith(`${folder}/`))) return folder;
  }
  return null;
}

/**
 * A file promote may write: a path inside the repo, outside rough/, the public folder and the
 * folders the environment ignores (a dependency folder, a build's output, an in-tree mirror),
 * with one of the extensions the environment's `promote` names (decision 31); the problem, or
 * null.
 */
export function checkTargetFile(
  file: string,
  publicDir: string,
  extensions: string[] = fallbackRecipe.promoteExtensions,
  ignore: string[] = []
): string | null {
  const normalized = file.replace(/\\/g, '/');
  if (!/^[A-Za-z0-9_@()[\]./-]+$/.test(normalized) || !hasExtension(normalized, extensions)) {
    const named = extensions.map(extension => `${extension}`).join(' or ');
    return `The component file must be a ${named} path inside the repo.`;
  }
  if (
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    return 'The component file must be a relative path inside the repo.';
  }
  if (normalized.startsWith(`${ROUGH_DIR}/`) || normalized.startsWith(`${publicDir}/`)) {
    return 'The component cannot live in rough/ or the public folder.';
  }
  const ignored = ignoredFolder(normalized, ignore);
  if (ignored) {
    return `The component cannot live in ${ignored}/, which rough/environment.md ignores: nothing there is the app's own code.`;
  }
  return null;
}

/**
 * Where approved copy lands in a repo that keeps it localized (decision 34): a file inside the
 * repo, outside rough/ and the ignored folders; the problem, or null.
 */
export function checkCopyFile(file: string, ignore: string[] = []): string | null {
  const normalized = file.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    return 'The localized copy file must be a relative path inside the repo.';
  }
  if (normalized === ROUGH_DIR || normalized.startsWith(`${ROUGH_DIR}/`)) {
    return "The localized copy file is the app's own, never one in rough/.";
  }
  const ignored = ignoredFolder(normalized, ignore);
  if (ignored) return `The localized copy file cannot be in ${ignored}/, which the repo ignores.`;
  return null;
}

/** A folder inside the repo, relative with forward slashes, or null. */
function repoFolder(text: string): string | null {
  const folder = text.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
  if (!folder || folder.split('/').includes('..') || /^[a-z]:/i.test(folder)) return null;
  return folder;
}

/**
 * What the promote prompt says of the repo's stack, as the backend's stand-ins ask (F7 of the
 * frameworks plan): the environment line, what to read first, where approved copy lands, how an
 * asset is used, the stack's own rules and how the component is used. For a repo of the fallback
 * recipe with no environment file, the words the prompt always had.
 */
export type PromoteWords = {
  environment: string;
  read: string;
  keepCopy: string;
  except: string;
  assetIntro: string;
  assetBase: string;
  rules: string;
  usage: string;
};

/** What a repo set up by no recipe is told: nothing of any one stack. */
const NEUTRAL_WORDS: NonNullable<Recipe['promoteWords']> = {
  read: 'its manifests, how styling is done (stylesheets, a theme\nor design tokens)',
  rules: [],
  usage: 'how this stack includes it and what it takes'
};

export function promoteWords(
  environment: RepoEnvironment,
  recipe: Recipe | null,
  publicDir: string,
  options: { hasEnvironmentFile: boolean }
): PromoteWords {
  const own = recipe?.promoteWords ?? NEUTRAL_WORDS;
  const copy = environment.copy;
  const served = environment.assets.url;
  return {
    environment: options.hasEnvironmentFile ? `${ENVIRONMENT_LINE}\n` : '',
    read: own.read,
    keepCopy:
      copy.kind === 'localized'
        ? `The approved copy, word for word, in ${copy.file}: add each string there under keys of this component's own, in that file's own format, and use them from the component. Do not rewrite, shorten or add claims.`
        : 'The approved copy, word for word. Do not rewrite, shorten or add claims.',
    except: copy.kind === 'localized' ? `, except ${copy.file}, where the approved copy goes` : '',
    assetIntro:
      served === null
        ? 'Each studio URL in the reference is a file already copied into this repo: use that file\nthe way this stack uses a file that ships with its code:'
        : 'Replace each studio URL in the reference with its public path in this repo:',
    // Bundled assets are used as the files they are; served ones from the folder's address.
    assetBase: served === null ? `${publicDir}/` : served === '/' ? '/' : `${served}/`,
    rules: own.rules.map(line => `${line}\n`).join(''),
    usage: own.usage
  };
}

/**
 * The server's prompt with this repo's paths in place of its stand-ins, and what its stack
 * decides where the server left a stand-in for that: the environment line and the stack's rules
 * stand on lines of their own, which go with their line breaks when they have nothing to say.
 */
export function fillInPrompt(
  promotion: Promotion,
  targetFile: string,
  publicDir: string,
  words?: PromoteWords
): string {
  const { placeholders } = promotion;
  // Functions, so a "$" in a path is not read as a replacement pattern.
  let prompt = promotion.prompt
    .replaceAll(placeholders.targetFile, () => targetFile)
    .replaceAll(placeholders.targetDir, () => path.posix.dirname(targetFile))
    .replaceAll(placeholders.publicDir, () => publicDir);
  if (!words) return prompt;
  for (const key of ['environment', 'rules'] as const) {
    const standIn = placeholders[key];
    if (standIn) prompt = prompt.replaceAll(`${standIn}\n`, () => words[key]);
  }
  for (const key of ['read', 'keepCopy', 'except', 'assetIntro', 'assetBase', 'usage'] as const) {
    const standIn = placeholders[key];
    if (standIn) prompt = prompt.replaceAll(standIn, () => words[key]);
  }
  return prompt;
}

export function promotePromptFile(page: string, component: string, promotionId: string): string {
  return `${ROUGH_DIR}/${page}/${component}/prompts/promote-${assertRunId(promotionId)}.md`;
}

function toDisk(repoRoot: string, relative: string): string {
  return path.join(repoRoot, ...relative.split('/'));
}

/** Every file under `dir` with one of the environment's source extensions. */
function textFiles(dir: string, sources: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return textFiles(full, sources);
    return hasExtension(entry.name, sources) ? [full] : [];
  });
}

export function findComponent(tree: ProjectTree, page: string, component: string): ComponentRecord {
  const found = tree.pages
    .find(item => item.slug === page)
    ?.components.find(item => item.slug === component);
  if (!found) throw new Error(`${page}/${component} is not a component of ${tree.name}.`);
  return found;
}

/** The iteration to promote: the one named, or the component's selected one. */
export function iterationToPromote(component: ComponentRecord, named?: string): string {
  if (named) return named;
  if (component.selectedIteration === null) {
    throw new Error(
      `No iteration of ${component.name} is selected. Select one first, or name it with --iteration.`
    );
  }
  return `iteration-${String(component.selectedIteration).padStart(2, '0')}`;
}

export type PromoteOptions = {
  page: string;
  component: string;
  iteration: string;
  /** The component file to write; the project's components folder and the component's name by default. */
  targetFile?: string;
  /** The app's public folder, repo-relative; `public` beside the app's package.json by default. */
  publicDir?: string;
  /**
   * Put the change on a new branch (decision 18): its name, or true for
   * `roughbook/<page>-<component>-<iteration>`.
   */
  branch?: string | true;
  now?: () => Date;
};

export type PreparedPromotion = {
  promotionId: string;
  promptFile: string;
  targetFile: string;
  publicDir: string;
  /** Repo-relative paths of the asset files copied in. */
  copied: string[];
  /** Assets the iteration refers to that neither the project nor the library has. */
  missing: AssetName[];
  wroteCopy: boolean;
  /** The localized file approved copy lands in, when the environment says so (decision 34). */
  copyFile: string | null;
  /** A new file, the component's own files, or a merge with the app's changes since the fork (B4). */
  how: PromoteHow;
  /** The app files the promote writes, each with the iteration's copy of it. */
  targets: PromoteTarget[];
  /** The branch it is on, when the designer asked for one. */
  branch: PromotionRecord['branch'];
};

/** The app's public folder: given, beside the app's package.json, or the project's. */
export function publicDirFor(
  repoRoot: string,
  link: RepoLink,
  tree: ProjectTree,
  given?: string,
  environmentDir: string | null = null
): string {
  if (given !== undefined) {
    const folder = repoFolder(given);
    if (!folder) throw new Error('The public folder must be a folder inside the repo.');
    return folder;
  }
  // The environment's assets folder decides (decision 31); the project's delivery is the default.
  if (environmentDir) return repoFolder(environmentDir) ?? 'public';
  if (link.appDir) {
    let dir = toDisk(repoRoot, link.appDir);
    while (dir.startsWith(repoRoot) && !fs.existsSync(path.join(dir, 'package.json'))) {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    const relative = path.relative(repoRoot, dir).split(path.sep).join('/');
    if (!relative.startsWith('..')) return relative ? `${relative}/public` : 'public';
  }
  return repoFolder(tree.delivery.publicDir) ?? 'public';
}

export async function preparePromotion(
  repoRoot: string,
  api: StudioApi,
  link: RepoLink,
  tree: ProjectTree,
  options: PromoteOptions
): Promise<PreparedPromotion> {
  const { page, component, iteration } = options;
  assertTarget(page, component, iteration);
  const record = findComponent(tree, page, component);
  const environment = await readEnvironment(repoRoot, link);
  const recipe = recipeOf(environment);
  const folder = toDisk(repoRoot, iterationDir(page, component, iteration));
  if (!fs.existsSync(path.join(folder, environment.entry))) {
    throw new Error(
      `${iterationDir(page, component, iteration)} has no ${environment.entry} in this repo.`
    );
  }

  const publicDir = publicDirFor(repoRoot, link, tree, options.publicDir, environment.assets.dir);
  const relative = iterationDir(page, component, iteration);
  // A fork or refine of the app's own component goes back into the component's own files, with
  // each child it copied in (B4); its children are looked for again first (decision 39). --to
  // still makes it a new file.
  if (options.targetFile === undefined && readBase(repoRoot, relative)) {
    await recordChildren(repoRoot, { page, component, iteration });
  }
  const base = options.targetFile === undefined ? readBase(repoRoot, relative) : null;
  let how: PromoteHow = 'new';
  let targets: PromoteTarget[];
  let targetFile: string;
  if (base) {
    ({ how, targets } = planTargets(repoRoot, relative, base, environment));
    targetFile = targets[0]!.path;
  } else {
    // Where components go and what they are named: the environment's promote field decides
    // (decision 31); the project's delivery is the default, through the recipe for a recipe repo.
    const extensions = environment.promote.extensions;
    const componentsDir = environment.promote.dir ?? tree.delivery.componentsDir;
    targetFile = (
      options.targetFile ??
      (recipe
        ? recipe.promoteDefault(
            componentsDir,
            record.name,
            folder =>
              fs.statSync(toDisk(repoRoot, folder), { throwIfNoEntry: false })?.isDirectory() ??
              false
          )
        : `${componentsDir}/${pascalCase(record.name)}${extensions[0] ?? ''}`)
    ).replace(/\\/g, '/');
    const problem = checkTargetFile(targetFile, publicDir, extensions, environment.ignore);
    if (problem) throw new Error(problem);
    if (fs.existsSync(toDisk(repoRoot, targetFile))) {
      throw new Error(
        `${targetFile} already exists. Choose another file with --to; Roughbook never overwrites the app's code.`
      );
    }
    targets = [{ path: targetFile, copy: null, child: false, drifted: false }];
  }
  if (environment.copy.kind === 'localized') {
    const wrong = checkCopyFile(environment.copy.file, environment.ignore);
    if (wrong) throw new Error(wrong);
  }
  // Refused before anything is asked or written: not git, a dirty target, a taken name.
  const plannedBranch =
    options.branch === undefined
      ? null
      : await planBranch(
          repoRoot,
          options.branch === true ? defaultBranch(page, component, iteration) : options.branch,
          targets.map(target => target.path)
        );

  const sources = textFiles(folder, environment.sources).map(file => fs.readFileSync(file, 'utf8'));
  const promotion = await api.promote(link.orgId, link.project, {
    page,
    component,
    iteration,
    assets: referencedAssets(sources, link.project),
    // What the prompt says of the stack is then left for this studio to fill (F7).
    family: environment.family,
    how
  });
  assertRunId(promotion.promotionId);

  // Before anything is written, so revert puts the targets back whatever the agent does; their
  // copies are kept, since a commit on the branch moves HEAD past them.
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
    if (!FILE_NAME.test(asset.file)) continue;
    const to = `${publicDir}/rough/${page}/${component}/${asset.file}`;
    const bytes = await api.file(link.orgId, link.project, asset.scope, asset.file);
    fs.mkdirSync(path.dirname(toDisk(repoRoot, to)), { recursive: true });
    fs.writeFileSync(toDisk(repoRoot, to), bytes);
    copied.push(to);
  }

  const workspace = `${ROUGH_DIR}/${page}/${component}`;
  if (promotion.copyMarkdown !== null) {
    fs.writeFileSync(toDisk(repoRoot, `${workspace}/copy.md`), promotion.copyMarkdown);
  }
  const promptFile = promotePromptFile(page, component, promotion.promotionId);
  fs.mkdirSync(path.dirname(toDisk(repoRoot, promptFile)), { recursive: true });
  let prompt = fillInPrompt(
    promotion,
    targetFile,
    publicDir,
    promoteWords(environment, recipe, publicDir, {
      hasEnvironmentFile: hasEnvironmentFile(repoRoot)
    })
  );
  if (base) prompt = fillPromoteStandIns(prompt, relative, targets, promotion.placeholders);
  fs.writeFileSync(
    toDisk(repoRoot, promptFile),
    `${prompt.trimEnd()}\n\n${promoteFinishingSection(promotion.promotionId, how)}`
  );
  // Runs still open did not write these, so their Done does not count them.
  await recordOwnWritesForOpenRuns(repoRoot, [
    ...copied,
    ...(promotion.copyMarkdown !== null ? [`${workspace}/copy.md`] : []),
    promptFile
  ]);
  const branch = plannedBranch
    ? { name: plannedBranch.name, from: plannedBranch.from, commit: plannedBranch.commit }
    : null;
  await savePromotion(repoRoot, {
    promotionId: promotion.promotionId,
    orgId: link.orgId,
    project: link.project,
    page,
    component,
    iteration,
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
    how,
    targets,
    branch,
    promotionId: promotion.promotionId,
    promptFile,
    targetFile,
    publicDir,
    copied,
    missing,
    wroteCopy: promotion.copyMarkdown !== null,
    copyFile: environment.copy.kind === 'localized' ? environment.copy.file : null
  };
}
