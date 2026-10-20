// Promote, the studio's half: a selected local iteration becomes a production component in this
// repo. The backend renders the prompt from the brief; the studio copies the assets the iteration
// uses into the app's public folder and the approved copy beside the reference, fills in the
// paths the server never sees, and hands the prompt to the designer's agent. Ported from roughbook
// src/lib/delivery/promote.ts (v2-local). The studio never edits the app's code and never commits.
import fs from 'node:fs';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import type { AssetScope, ComponentRecord, Promotion, ProjectTree } from '../api/types.js';
import { readEnvironment } from '../environment/read.js';
import { fallbackRecipe, recipeFor } from '../recipes/index.js';
import { iterationDir } from '../repo/iterations.js';
import type { RepoLink } from '../repo/link.js';
import { ROUGH_DIR } from '../repo/root.js';
import { hasExtension } from './checks.js';
import { assertTarget } from './slots.js';
import { recordOwnWritesForOpenRuns } from './snapshot.js';
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

/**
 * A component path inside the repo, outside rough/ and the public folder, with one of the
 * recipe's extensions; the problem, or null.
 */
export function checkTargetFile(
  file: string,
  publicDir: string,
  extensions: string[] = fallbackRecipe.promoteExtensions
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
  return null;
}

/** A folder inside the repo, relative with forward slashes, or null. */
function repoFolder(text: string): string | null {
  const folder = text.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
  if (!folder || folder.split('/').includes('..') || /^[a-z]:/i.test(folder)) return null;
  return folder;
}

/** The server's prompt with this repo's paths in place of its stand-ins. */
export function fillInPrompt(promotion: Promotion, targetFile: string, publicDir: string): string {
  // Functions, so a "$" in a path is not read as a replacement pattern.
  return promotion.prompt
    .replaceAll(promotion.placeholders.targetFile, () => targetFile)
    .replaceAll(promotion.placeholders.targetDir, () => path.posix.dirname(targetFile))
    .replaceAll(promotion.placeholders.publicDir, () => publicDir);
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
};

/** The app's public folder: given, beside the app's package.json, or the project's. */
export function publicDirFor(
  repoRoot: string,
  link: RepoLink,
  tree: ProjectTree,
  given?: string
): string {
  if (given !== undefined) {
    const folder = repoFolder(given);
    if (!folder) throw new Error('The public folder must be a folder inside the repo.');
    return folder;
  }
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
  const recipe = recipeFor(environment.recipe) ?? fallbackRecipe;
  const folder = toDisk(repoRoot, iterationDir(page, component, iteration));
  if (!fs.existsSync(path.join(folder, environment.entry))) {
    throw new Error(
      `${iterationDir(page, component, iteration)} has no ${environment.entry} in this repo.`
    );
  }

  const publicDir = publicDirFor(repoRoot, link, tree, options.publicDir);
  const targetFile = (
    options.targetFile ??
    recipe.promoteDefault(
      tree.delivery.componentsDir,
      record.name,
      folder =>
        fs.statSync(toDisk(repoRoot, folder), { throwIfNoEntry: false })?.isDirectory() ?? false
    )
  ).replace(/\\/g, '/');
  const problem = checkTargetFile(targetFile, publicDir, recipe.promoteExtensions);
  if (problem) throw new Error(problem);
  if (fs.existsSync(toDisk(repoRoot, targetFile))) {
    throw new Error(
      `${targetFile} already exists. Choose another file with --to; Roughbook never overwrites the app's code.`
    );
  }

  const sources = textFiles(folder, environment.sources).map(file => fs.readFileSync(file, 'utf8'));
  const promotion = await api.promote(link.orgId, link.project, {
    page,
    component,
    iteration,
    assets: referencedAssets(sources, link.project)
  });

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
  fs.writeFileSync(toDisk(repoRoot, promptFile), fillInPrompt(promotion, targetFile, publicDir));
  // Runs still open did not write these, so their Done does not count them.
  await recordOwnWritesForOpenRuns(repoRoot, [
    ...copied,
    ...(promotion.copyMarkdown !== null ? [`${workspace}/copy.md`] : []),
    promptFile
  ]);

  return {
    promotionId: promotion.promotionId,
    promptFile,
    targetFile,
    publicDir,
    copied,
    missing,
    wroteCopy: promotion.copyMarkdown !== null
  };
}
