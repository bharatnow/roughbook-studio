// Sketch → local (decision 10 of the split plan): a web sketch becomes the starting point of a
// local iteration, a fork whose parent is the sketch. The backend allocates the iteration and
// sends the sketch's files; the studio writes them into rough/, points their asset URLs at its
// own server, and says what the app still needs to render them. Nothing goes back up.
import fs from 'node:fs';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import type { PulledSketch, SketchFile } from '../api/types.js';
import { readEnvironment } from '../environment/read.js';
import { recipeOf } from '../recipes/index.js';
import { iterationDir } from '../repo/iterations.js';
import type { RepoLink } from '../repo/link.js';
import { assertTarget, iterationExists } from './slots.js';
import { recordOwnWritesForOpenRuns } from './snapshot.js';

/** A sketch's files as the backend's build allows them: a few folders deep, known types only. */
const SKETCH_PATH =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/){0,3}[A-Za-z0-9][A-Za-z0-9._-]*\.(?:tsx|ts|jsx|js|css|json|svg|png|jpe?g|gif|webp)$/;
const CODE_FILE = /\.(?:tsx|ts|jsx|js)$/;
const TEXT_FILE = /\.(?:tsx|ts|jsx|js|css|json|svg)$/;
/** Far above what the backend allows a sketch, so only a broken answer is refused. */
const MAX_FILES = 64;
const MAX_BYTES = 8 * 1024 * 1024;

/** What the backend's refusals mean here. */
const REFUSALS: Record<string, (sketch: string) => string> = {
  SKETCH_RUNNING: sketch =>
    `${sketch} is still being made on the web. Pull it when it has finished.`,
  SKETCH_HAS_NO_SOURCE: sketch => `${sketch} has no files to pull: its run did not finish.`,
  ITERATION_IS_LOCAL: sketch =>
    `${sketch} is a local iteration, not a web sketch. Fork it with roughbook run --fork.`,
  ITERATION_NOT_FOUND: sketch => `There is no ${sketch} in this component.`
};

export type PullResult = {
  /** The new local iteration. */
  iteration: string;
  /** The sketch it was pulled from. */
  parent: string;
  /** Repo-relative, forward slashes. */
  folder: string;
  /** The files written, relative to the folder. */
  files: string[];
  /** Packages the sketch imports that the app's package.json does not list. */
  missingPackages: string[];
  /** The command that adds them, in the app's package manager. */
  installCommand: string | null;
  /** The sketch is styled with Tailwind classes, and the app does not list tailwindcss. */
  needsTailwind: boolean;
};

/**
 * The sketch's asset URLs, which load beside the sandbox's page, made absolute on the studio's
 * server, where local iterations load the project's and library's files.
 */
export function localAssetUrls(text: string, assetOrigin: string): string {
  return text.replace(
    /(["'`(])\/api\/files\/(project|library)\//g,
    (_match, before: string, scope: string) => `${before}${assetOrigin}/api/files/${scope}/`
  );
}

/** Every file the backend sent, checked before anything is written. */
function checkFiles(files: unknown): SketchFile[] {
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) {
    throw new Error('The server sent a sketch this studio cannot write.');
  }
  let total = 0;
  const seen = new Set<string>();
  for (const file of files as SketchFile[]) {
    const { path: name, encoding, content } = file ?? {};
    if (
      typeof name !== 'string' ||
      !SKETCH_PATH.test(name) ||
      seen.has(name.toLowerCase()) ||
      (encoding !== 'utf8' && encoding !== 'base64') ||
      typeof content !== 'string'
    ) {
      throw new Error('The server sent a sketch file this studio will not write.');
    }
    seen.add(name.toLowerCase());
    total += content.length;
    if (total > MAX_BYTES) throw new Error('The server sent a sketch larger than any it makes.');
  }
  return files as SketchFile[];
}

/** The package an import names, or null for a relative or absolute one. */
function packageOf(specifier: string): string | null {
  if (/^[./]/.test(specifier) || specifier.includes(':')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? null);
}

/** The packages code imports, each once, in the order they appear. */
export function importedPackages(sources: string[]): string[] {
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const source of sources) {
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const name = packageOf(match[1]!);
        if (name) found.add(name);
      }
    }
  }
  return [...found];
}

/** The app's dependencies, or null when its package.json cannot be read. */
function appDependencies(repoRoot: string): Set<string> | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {})
    ]);
  } catch {
    return null;
  }
}

/** How this app adds packages, from its lockfile. */
export function installCommand(repoRoot: string, packages: string[]): string | null {
  if (!packages.length) return null;
  const has = (file: string) => fs.existsSync(path.join(repoRoot, file));
  const tool = has('pnpm-lock.yaml')
    ? 'pnpm add'
    : has('yarn.lock')
      ? 'yarn add'
      : has('bun.lock') || has('bun.lockb')
        ? 'bun add'
        : 'npm install';
  return `${tool} ${packages.join(' ')}`;
}

/** What the designer should do before the pulled iteration renders, in sentences. */
export function pullAdvice(result: PullResult): string[] {
  const lines: string[] = [];
  if (result.missingPackages.length) {
    const names = result.missingPackages.join(', ');
    lines.push(
      `It imports ${names}, which this app does not list. Add ${result.missingPackages.length === 1 ? 'it' : 'them'} with: ${result.installCommand}`
    );
  }
  if (result.needsTailwind) {
    lines.push(
      'It is styled with Tailwind classes, and this app does not list tailwindcss, so it will render unstyled here.'
    );
  }
  return lines;
}

/**
 * Pulls a web sketch into rough/ as the component's next local iteration. Every path the server
 * sends is checked first; an existing iteration is never written over.
 */
export async function pullSketch(
  repoRoot: string,
  api: StudioApi,
  link: RepoLink,
  target: { page: string; component: string; sketch: string },
  options: { assetOrigin: string }
): Promise<PullResult> {
  const { page, component, sketch } = target;
  assertTarget(page, component, sketch);
  let pulled: PulledSketch;
  try {
    pulled = await api.pullSketch(link.orgId, link.project, page, component, sketch);
  } catch (error) {
    const refusal = error instanceof ApiError ? REFUSALS[error.code] : undefined;
    throw refusal ? new Error(refusal(sketch)) : error;
  }
  assertTarget(page, component, pulled.iteration);
  const files = checkFiles(pulled.files);
  const folder = iterationDir(page, component, pulled.iteration);
  if (iterationExists(repoRoot, page, component, pulled.iteration)) {
    throw new Error(`${folder} already exists. An existing iteration is never written over.`);
  }
  // A sketch is React (decision 14 of the frameworks plan); the recipe says what this app needs
  // of its files to render them, such as a directive on the entry.
  const environment = await readEnvironment(repoRoot, link);
  const recipe = recipeOf(environment);
  // A sketch's files render as they are only where the stack is React-like; anywhere else they
  // would be a port, which a later release makes a run of its own (F7 of the frameworks plan).
  if (environment.family !== 'react-like') {
    throw new Error(
      `A web sketch is React, and this repo's stack (${environment.stack.join(', ') || environment.family}) is not: pulling one here means porting it, which a later studio release does as a run of its own. Until then, start iterations here with roughbook run.`
    );
  }

  const dir = path.join(repoRoot, ...folder.split('/'));
  try {
    for (const file of files) {
      const to = path.join(dir, ...file.path.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (file.encoding === 'base64') fs.writeFileSync(to, Buffer.from(file.content, 'base64'));
      else {
        const text = TEXT_FILE.test(file.path)
          ? localAssetUrls(file.content, options.assetOrigin)
          : file.content;
        fs.writeFileSync(
          to,
          (recipe ? recipe.pullTransform(file.path, text) : text).replace(/\r\n/g, '\n')
        );
      }
    }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  recipe?.syncPreview(repoRoot);
  // Runs going now did not write these, so their Done does not count them.
  await recordOwnWritesForOpenRuns(
    repoRoot,
    files.map(file => `${folder}/${file.path}`)
  );

  const code = files.filter(file => CODE_FILE.test(file.path) && file.encoding === 'utf8');
  const dependencies = appDependencies(repoRoot);
  const missingPackages = dependencies
    ? importedPackages(code.map(file => file.content)).filter(name => !dependencies.has(name))
    : [];
  return {
    iteration: pulled.iteration,
    parent: pulled.parent,
    folder,
    files: files.map(file => file.path),
    missingPackages,
    installCommand: installCommand(repoRoot, missingPackages),
    needsTailwind:
      dependencies !== null &&
      !dependencies.has('tailwindcss') &&
      code.some(file => /\bclassName\s*=/.test(file.content))
  };
}
