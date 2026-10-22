// Sketch → local (decision 10 of the split plan): a web sketch becomes the starting point of a
// local iteration, a fork whose parent is the sketch. The backend allocates the iteration; the
// studio decides how the sketch comes in (F7 of the frameworks plan). Every sketch is React with
// Tailwind, made in the sandbox (decision 14): where this repo renders that as it is and has the
// packages it imports, its files are copied in, their asset URLs pointed at the studio's own
// server. Anywhere else it is ported: the files are kept beside the component as a read-only
// reference, and a pull run's agent rebuilds the sketch in the repo's own stack. Nothing goes up
// but the repo's stack tokens.
import fs from 'node:fs';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import type { PulledSketch, SketchFile } from '../api/types.js';
import { readEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { runCapture } from '../launch/processes.js';
import { recipeOf } from '../recipes/index.js';
import { syncIterations } from '../repo/mirror.js';
import { iterationDir } from '../repo/iterations.js';
import { cleanStack, type RepoLink } from '../repo/link.js';
import { ROUGH_DIR } from '../repo/root.js';
import { startRuns, type StartOptions } from './lifecycle.js';
import { assertTarget, iterationExists } from './slots.js';
import { recordOwnWritesForOpenRuns } from './snapshot.js';
import type { RunAgent, RunMode, RunRecord } from './types.js';

/** A sketch's files as the backend's build allows them: a few folders deep, known types only. */
const SKETCH_PATH =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/){0,3}[A-Za-z0-9][A-Za-z0-9._-]*\.(?:tsx|ts|jsx|js|css|json|svg|png|jpe?g|gif|webp)$/;
const CODE_FILE = /\.(?:tsx|ts|jsx|js)$/;
const TEXT_FILE = /\.(?:tsx|ts|jsx|js|css|json|svg)$/;
/** Far above what the backend allows a sketch, so only a broken answer is refused. */
const MAX_FILES = 64;
const MAX_BYTES = 8 * 1024 * 1024;
/** How long adding the packages a sketch imports may take. */
const INSTALL_TIMEOUT_MS = 10 * 60_000;

/** The folder beside a component's iterations that holds the sketches ported from, as references. */
export const SKETCHES_DIR = 'sketches';

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
 * How a sketch comes into this repo. `copy`: its files render here as they are. `port`: a pull
 * run's agent rebuilds it in the repo's stack, for the reasons given. When the only thing between
 * a port and a copy is packages the app does not list, `add` is the command that adds them, for
 * the designer to approve.
 */
export type PullPlan = {
  how: 'copy' | 'port';
  /** Why it is ported, one sentence each; empty for a copy. */
  why: string[];
  /** Packages the sketch imports that the app does not list. */
  missingPackages: string[];
  /** The command that adds the missing packages, when adding them is all a copy needs. */
  add: string | null;
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
export function appDependencies(repoRoot: string): Set<string> | null {
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

/** The sketch's code, as text. */
function sketchCode(files: SketchFile[]): string[] {
  return files
    .filter(file => CODE_FILE.test(file.path) && file.encoding === 'utf8')
    .map(file => file.content);
}

/** Whether the sketch is styled with Tailwind classes in an app that does not list tailwindcss. */
function lacksTailwind(files: SketchFile[], dependencies: Set<string> | null): boolean {
  return (
    dependencies !== null &&
    !dependencies.has('tailwindcss') &&
    sketchCode(files).some(text => /\bclassName\s*=/.test(text))
  );
}

/**
 * Whether a sketch's files can be copied into this repo as they are, or the sketch is ported
 * (decision 14, F7 of the frameworks plan). Copied only where the environment says a sketch
 * renders here as it is, its iterations have the sketch's entry file, the app lists every package
 * the sketch imports, and it has Tailwind when the sketch is styled with its classes. Otherwise a
 * pull run rebuilds it, never a copy that would not render.
 */
export function planPull(
  environment: RepoEnvironment,
  files: SketchFile[],
  dependencies: Set<string> | null,
  install: (packages: string[]) => string | null = () => null
): PullPlan {
  const why: string[] = [];
  const stack = environment.stack.join(', ') || `the ${environment.family} family`;
  if (environment.sketches !== 'copy') {
    why.push(
      `A web sketch is React with Tailwind, and this repo's stack (${stack}) does not render one as it is (rough/environment.md, sketches: port).`
    );
  } else if (!files.some(file => file.path === environment.entry)) {
    why.push(
      `An iteration here is ${environment.entry}, and the sketch has none: its files are React.`
    );
  } else if (dependencies === null) {
    why.push("This app's package.json cannot be read, so the sketch's packages cannot be found.");
  }
  const missingPackages =
    dependencies === null
      ? []
      : importedPackages(sketchCode(files)).filter(name => !dependencies.has(name));
  const tailwind = lacksTailwind(files, dependencies);
  const stackFits = !why.length;
  if (stackFits && missingPackages.length) {
    const names = missingPackages.join(', ');
    why.push(
      `It imports ${names}, which this app does not list, so its files would not render here as they are.`
    );
  }
  if (stackFits && tailwind) {
    why.push(
      'It is styled with Tailwind classes, and this app does not list tailwindcss, so its files would render unstyled here.'
    );
  }
  return {
    how: why.length ? 'port' : 'copy',
    why,
    missingPackages,
    // Adding packages turns a port into a copy only when nothing else stands in the way.
    add: stackFits && !tailwind && missingPackages.length ? install(missingPackages) : null
  };
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

/** The backend's refusal in the designer's words, or the error as it is. */
function refusal(error: unknown, sketch: string): unknown {
  const words = error instanceof ApiError ? REFUSALS[error.code] : undefined;
  return words ? new Error(words(sketch)) : error;
}

/** The sketch's files, checked, without pulling it: nothing is allocated on the server. */
export async function sketchFiles(
  api: StudioApi,
  link: RepoLink,
  target: { page: string; component: string; sketch: string }
): Promise<SketchFile[]> {
  const { page, component, sketch } = target;
  assertTarget(page, component, sketch);
  try {
    const answer = await api.sketchFiles(link.orgId, link.project, page, component, sketch);
    return checkFiles(answer.files);
  } catch (error) {
    throw refusal(error, sketch);
  }
}

/** What a pull asks of the repo: its environment, the app's packages, and the plan for a sketch. */
export async function pullPlanFor(
  repoRoot: string,
  link: RepoLink,
  files: SketchFile[]
): Promise<PullPlan> {
  const environment = await readEnvironment(repoRoot, link);
  return planPull(environment, files, appDependencies(repoRoot), packages =>
    installCommand(repoRoot, packages)
  );
}

/**
 * Adds the packages a sketch imports with the app's own package manager, once the designer has
 * approved the command: in the repo, as an argument array, never through a shell.
 */
export async function addPackages(
  repoRoot: string,
  command: string
): Promise<{ ok: boolean; output: string }> {
  const result = await runCapture(command, repoRoot, INSTALL_TIMEOUT_MS);
  return { ok: result.code === 0, output: result.output };
}

/**
 * Pulls a web sketch into rough/ as the component's next local iteration, copying its files as
 * they are. Every path the server sends is checked first; an existing iteration is never written
 * over. Refused where the plan says the sketch is ported here.
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
  const environment = await readEnvironment(repoRoot, link);
  const recipe = recipeOf(environment);
  if (environment.sketches !== 'copy') {
    throw new Error(
      `A web sketch is React, and this repo's stack (${environment.stack.join(', ') || environment.family}) does not render one as it is: pulling it here ports it, with your agent.`
    );
  }
  let pulled: PulledSketch;
  try {
    pulled = await api.pullSketch(
      link.orgId,
      link.project,
      page,
      component,
      sketch,
      cleanStack(environment.stack)
    );
  } catch (error) {
    throw refusal(error, sketch);
  }
  assertTarget(page, component, pulled.iteration);
  const files = checkFiles(pulled.files);
  const folder = iterationDir(page, component, pulled.iteration);
  if (iterationExists(repoRoot, page, component, pulled.iteration)) {
    throw new Error(`${folder} already exists. An existing iteration is never written over.`);
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
  syncIterations(repoRoot, environment);
  // Runs going now did not write these, so their Done does not count them.
  await recordOwnWritesForOpenRuns(
    repoRoot,
    files.map(file => `${folder}/${file.path}`)
  );

  const dependencies = appDependencies(repoRoot);
  const missingPackages = dependencies
    ? importedPackages(sketchCode(files)).filter(name => !dependencies.has(name))
    : [];
  return {
    iteration: pulled.iteration,
    parent: pulled.parent,
    folder,
    files: files.map(file => file.path),
    missingPackages,
    installCommand: installCommand(repoRoot, missingPackages),
    needsTailwind: lacksTailwind(files, dependencies)
  };
}

/**
 * Where a ported sketch's files are kept, repo-relative: beside the component's iterations, not
 * as one of them, so no preview, registry or mirror ever reads them. Committed with rough/, as
 * the record of what the port was made from.
 */
export function sketchReferenceDir(page: string, component: string, sketch: string): string {
  assertTarget(page, component, sketch);
  return `${ROUGH_DIR}/${page}/${component}/${SKETCHES_DIR}/${sketch}`;
}

/**
 * Writes a sketch's files as its reference: as the server sent them, rewriting only what differs,
 * so a second port of the same sketch finds it in place.
 */
export function writeSketchReference(
  repoRoot: string,
  target: { page: string; component: string; sketch: string },
  files: SketchFile[]
): string {
  const folder = sketchReferenceDir(target.page, target.component, target.sketch);
  const dir = path.join(repoRoot, ...folder.split('/'));
  for (const file of checkFiles(files)) {
    const to = path.join(dir, ...file.path.split('/'));
    const bytes =
      file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64')
        : Buffer.from(file.content.replace(/\r\n/g, '\n'), 'utf8');
    const current = fs.existsSync(to) ? fs.readFileSync(to) : null;
    if (current && current.equals(bytes)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, bytes);
  }
  return folder;
}

/**
 * Ports a web sketch into this repo's stack: a pull run, whose iteration the backend allocates
 * as a fork of the sketch and whose prompt says to rebuild it here. The sketch's files are written
 * beside the component first, as the read-only reference the prompt names, before the repo is
 * snapshotted, so they count as neither this run's change nor any other's.
 */
export async function portSketch(
  repoRoot: string,
  api: StudioApi,
  link: RepoLink,
  target: { page: string; component: string; sketch: string },
  run: { agent: RunAgent; mode: RunMode; files: SketchFile[] },
  options: StartOptions = {}
): Promise<RunRecord[]> {
  const { page, component, sketch } = target;
  assertTarget(page, component, sketch);
  const files = checkFiles(run.files);
  return startRuns(
    repoRoot,
    api,
    link,
    { page, component, agent: run.agent, mode: run.mode, kind: 'pull', sketch },
    {
      ...options,
      beforeSlots: started => {
        for (const item of started) {
          if (item.parent !== sketch) {
            throw new Error(`The server ported ${item.parent ?? 'nothing'}, not ${sketch}.`);
          }
        }
        writeSketchReference(repoRoot, target, files);
      }
    }
  );
}
