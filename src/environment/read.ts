// Reads a repo's environment: the header of rough/environment.md, with the recipe's values for
// whatever it leaves out, or the recipe's alone for a repo linked before environments existed
// (decision 20 of the frameworks plan). The prose below the header is for agents; the studio
// never reads it. Commands are declared per operating system (decision 30): a `…Windows` key
// beside a command's key is the variant Windows runs, and the shell likewise.
import fs from 'node:fs';
import { currentOs, hostPlatform } from '../launch/platform.js';
import { fallbackRecipe, recipeFor } from '../recipes/index.js';
import { readRepoLink, type RepoLink } from '../repo/link.js';
import { ROUGH_DIR, roughPath } from '../repo/root.js';
import { bareEnvironment } from './bare.js';
import {
  FAMILIES,
  GATES,
  PREVIEW_MODES,
  SHELLS,
  type EnvironmentOs,
  type Family,
  type Gate,
  type PreviewMode,
  type RepoEnvironment,
  type SetupFile,
  type Shell,
  type Viewport
} from './types.js';

/** Inside `rough/`: the repo's environment, committed with it. */
export const ENVIRONMENT_FILE = 'environment.md';

/** Inside `rough/`: the templates of every file the setup writes outside rough/ (decision 28). */
export const SETUP_DIR = 'setup';

/**
 * The stand-ins the backend writes where a prompt names what the repo's environment decides
 * (decision 15 of the frameworks plan): the entry file, the stack's words for page and component,
 * and the line that points the agent at rough/environment.md, which stays out of a repo with none.
 */
export const ENTRY_PLACEHOLDER = '{{roughbook:entry}}';
export const TERM_PAGE_PLACEHOLDER = '{{roughbook:term-page}}';
export const TERM_COMPONENT_PLACEHOLDER = '{{roughbook:term-component}}';
export const ENVIRONMENT_PLACEHOLDER = '{{roughbook:environment}}';

/** What the environment line says when the repo has one. */
export const ENVIRONMENT_LINE = `Read ${ROUGH_DIR}/${ENVIRONMENT_FILE} before writing: it says how this repo's components, styles and tokens work, and what an iteration here must hold.`;

export type HeaderFields = Record<string, string | string[]>;

/** The environment of a repo with no environment file: the fallback recipe's. */
export function defaultEnvironment(link: RepoLink | null = null): RepoEnvironment {
  return fallbackRecipe.environment(link);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return /^(['"]).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/**
 * The header between the file's first `---` line and the next: `key: value` lines, and `key:`
 * followed by `- item` lines. Null when the file has no header.
 */
export function parseEnvironmentHeader(text: string): HeaderFields | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return null;
  const fields: HeaderFields = {};
  let list: string | null = null;
  for (const raw of lines.slice(1, end)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && list) {
      (fields[list] as string[]).push(unquote(item[1]!));
      continue;
    }
    const pair = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!pair)
      throw new Error(`${ROUGH_DIR}/${ENVIRONMENT_FILE}: cannot read the line "${raw.trim()}".`);
    const [, key, value] = pair;
    if (value!.trim() === '') {
      fields[key!] = [];
      list = key!;
    } else {
      fields[key!] = unquote(value!);
      list = null;
    }
  }
  return fields;
}

function refuse(field: string, why: string): never {
  throw new Error(`${ROUGH_DIR}/${ENVIRONMENT_FILE}: ${field} ${why}`);
}

function text(fields: HeaderFields, field: string): string | undefined {
  const value = fields[field];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) refuse(field, 'is one value, not a list.');
  return value;
}

function list(fields: HeaderFields, field: string): string[] | undefined {
  const value = fields[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) refuse(field, 'is a list, one item per line.');
  return value;
}

/** `desktop 1440x900`, or `phone 390x844 mobile` for one the browser treats as a phone. */
function viewport(item: string): Viewport {
  const match = /^([a-z][a-z0-9-]*)\s+(\d{3,4})x(\d{3,4})(?:\s+(mobile))?$/.exec(item.trim());
  if (!match) refuse('viewports', `has an entry this studio cannot read: "${item}".`);
  return {
    name: match[1]!,
    width: Number(match[2]),
    height: Number(match[3]),
    mobile: match[4] === 'mobile'
  };
}

function extensions(field: string, items: string[]): string[] {
  for (const item of items) {
    if (!/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/i.test(item)) {
      refuse(field, `lists extensions with their dots, such as .tsx; not "${item}".`);
    }
  }
  return items;
}

const URL_TEXT = /^https?:\/\/\S+$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A folder or file inside the repo, relative with forward slashes, and no way out of it. */
function repoPath(field: string, value: string): string {
  const clean = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (
    !clean ||
    clean.startsWith('/') ||
    /^[a-z]:/i.test(clean) ||
    clean.split('/').includes('..')
  ) {
    refuse(field, `is a path inside the repo, relative and with forward slashes; not "${value}".`);
  }
  return clean;
}

/** `<command> @ <url>`, or `none`, or a URL alone when `urlAlone` allows it. */
function commandAt(
  field: string,
  value: string,
  urlAlone: boolean
): { command: string | null; url: string } | null {
  if (value === 'none') return null;
  const match = /^(.+?)\s+@\s+(https?:\/\/\S+)$/.exec(value);
  if (match) return { command: match[1]!.trim(), url: match[2]!.replace(/\/+$/, '') };
  if (urlAlone && URL_TEXT.test(value)) return { command: null, url: value.replace(/\/+$/, '') };
  refuse(
    field,
    urlAlone
      ? 'is the command that starts the app and the address it answers on, as "<command> @ <url>", or the address alone.'
      : 'is the command and the address it answers on, as "<command> @ <url>", or none.'
  );
}

/** The command for this operating system: the `…Windows` variant on Windows, when there is one. */
function forOs(fields: HeaderFields, field: string, os: EnvironmentOs): string | undefined {
  const variant = os === 'windows' ? text(fields, `${field}Windows`) : undefined;
  return variant ?? text(fields, field);
}

function listForOs(fields: HeaderFields, field: string, os: EnvironmentOs): string[] | undefined {
  const variant = os === 'windows' ? list(fields, `${field}Windows`) : undefined;
  return variant ?? list(fields, field);
}

function setupFile(item: string): SetupFile {
  const match = /^(.+?)(?:\s+\((file|snippet)\))?$/.exec(item.trim());
  const kind = match?.[2] === 'snippet' ? 'snippet' : 'file';
  const file = repoPath('setupFiles', match?.[1] ?? item);
  if (file.startsWith(`${ROUGH_DIR}/`) || file === ROUGH_DIR) {
    refuse('setupFiles', `lists files outside ${ROUGH_DIR}/; "${item}" is inside it.`);
  }
  return { path: file, kind };
}

/** The environment the header describes, over the recipe's values, for one operating system. */
export function environmentFromHeader(
  fields: HeaderFields,
  link: RepoLink | null,
  os: EnvironmentOs = currentOs(hostPlatform())
): RepoEnvironment {
  const contract = text(fields, 'contract');
  if (contract !== undefined && contract !== '1')
    refuse('contract', `${contract} is not one this studio knows; it knows 1.`);
  const recipeId = text(fields, 'recipe');
  const recipe = recipeId === undefined ? fallbackRecipe : recipeFor(recipeId);
  if (recipeId !== undefined && recipeId !== 'none' && !recipe) {
    refuse('recipe', `names ${recipeId}, which this studio does not have.`);
  }
  const base = recipe ? recipe.environment(link) : bareEnvironment(link);
  // With no recipe, the file must say what a recipe would have, in the table's order.
  if (!recipe) {
    const live = (text(fields, 'mode') ?? base.mode) === 'live';
    for (const field of ['entry', 'sources', 'start', ...(live ? ['preview'] : []), 'gate']) {
      if (fields[field] === undefined) {
        refuse(field, 'is required when no recipe set this repo up (recipe: none).');
      }
    }
  }

  const recipeVersion = text(fields, 'recipeVersion');
  if (recipeVersion !== undefined && !/^\d+$/.test(recipeVersion)) {
    refuse('recipeVersion', 'is a whole number.');
  }
  const family = text(fields, 'family');
  if (family !== undefined && !FAMILIES.includes(family as Family)) {
    refuse('family', `is ${family}; it is one of ${FAMILIES.join(', ')}.`);
  }
  const mode = text(fields, 'mode');
  if (mode !== undefined && !PREVIEW_MODES.includes(mode as PreviewMode)) {
    refuse('mode', `is ${mode}; it is one of ${PREVIEW_MODES.join(', ')}.`);
  }
  const entry = text(fields, 'entry');
  if (entry !== undefined && !FILE_NAME.test(entry)) {
    refuse('entry', 'is a file name inside the iteration folder, with no slash.');
  }
  const preview = text(fields, 'preview');
  if (preview !== undefined && (!preview.startsWith('/') || !preview.includes('{key}'))) {
    refuse('preview', 'is a path starting with / that holds {key} where the iteration goes.');
  }
  const startText = forOs(fields, 'start', os);
  const start = startText === undefined ? undefined : commandAt('start', startText, true);
  if (start === null) refuse('start', 'names where the app answers; it cannot be none.');
  const viewports = list(fields, 'viewports')?.map(viewport);
  if (viewports && !viewports.length) refuse('viewports', 'names at least one viewport.');
  const sources = list(fields, 'sources');
  const code = list(fields, 'code');
  const fixture = text(fields, 'fixture');
  if (fixture !== undefined && fixture !== 'none' && !FILE_NAME.test(fixture)) {
    refuse('fixture', 'is a file name inside the iteration folder, or none.');
  }
  const build = forOs(fields, 'build', os);
  const buildOutput = list(fields, 'buildOutput');
  const gate = text(fields, 'gate');
  if (gate !== undefined && !GATES.includes(gate as Gate)) {
    refuse('gate', `is ${gate}; it is one of ${GATES.join(', ')}.`);
  }
  const productionText = forOs(fields, 'production', os);
  let served: RepoEnvironment['production'] | undefined;
  if (productionText !== undefined) {
    const parsed = commandAt('production', productionText, false);
    served = parsed === null ? null : { command: parsed.command!, url: parsed.url };
  }
  const timeout = (field: string): number | undefined => {
    const value = text(fields, field);
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value) || Number(value) <= 0) refuse(field, 'is a number of seconds.');
    return Number(value);
  };

  const shell = forOs(fields, 'shell', os);
  if (shell !== undefined && !SHELLS.includes(shell as Shell)) {
    refuse('shell', `is ${shell}; it is one of ${SHELLS.join(', ')}.`);
  }
  const runtimeText = text(fields, 'runtime');
  let runtime: RepoEnvironment['runtime'] | undefined;
  if (runtimeText !== undefined) {
    const container = /^container\s+@\s+(https?:\/\/\S+)$/.exec(runtimeText);
    if (runtimeText === 'local') runtime = { kind: 'local' };
    else if (container) runtime = { kind: 'container', url: container[1]!.replace(/\/+$/, '') };
    else
      refuse(
        'runtime',
        'is local, or "container @ <url>" with the address the container answers on.'
      );
  }
  const placementText = text(fields, 'placement');
  let placement: RepoEnvironment['placement'] | undefined;
  if (placementText !== undefined) {
    const inTree = /^in-tree\s+(\S+)$/.exec(placementText);
    if (placementText === 'rough') placement = { kind: 'rough' };
    else if (inTree) placement = { kind: 'in-tree', path: repoPath('placement', inTree[1]!) };
    else
      refuse('placement', 'is rough, or "in-tree <path>" with the mirrored path the build sees.');
  }
  const wrapper = text(fields, 'wrapper');
  const variants = list(fields, 'variants');
  if (variants && !variants.length) refuse('variants', 'names at least one variant.');
  const reload = text(fields, 'reload');
  if (reload !== undefined && reload !== 'app' && reload !== 'studio') {
    refuse(
      'reload',
      'is app (the app reloads a changed iteration itself) or studio (the studio reloads the frame).'
    );
  }
  if (variants?.some(item => !/^[a-z][a-z0-9-]*$/.test(item))) {
    refuse('variants', 'are words such as light, dark, en or ar, one per line.');
  }
  const checks = listForOs(fields, 'checks', os);
  const promote = text(fields, 'promote');
  const promoteExtensions = list(fields, 'promoteExtensions');
  const assets = text(fields, 'assets');
  const assetsCopy = text(fields, 'assetsCopy');
  if (assetsCopy !== undefined && !/^(yes|no|true|false)$/.test(assetsCopy)) {
    refuse('assetsCopy', 'is yes or no.');
  }
  const copyText = text(fields, 'copy');
  let copy: RepoEnvironment['copy'] | undefined;
  if (copyText !== undefined) {
    const localized = /^localized\s+(\S+)$/.exec(copyText);
    if (copyText === 'inline') copy = { kind: 'inline' };
    else if (localized) copy = { kind: 'localized', file: repoPath('copy', localized[1]!) };
    else refuse('copy', 'is inline, or "localized <file>" with the file approved copy lands in.');
  }
  const termsList = list(fields, 'terms');
  let terms: RepoEnvironment['terms'] | undefined;
  if (termsList !== undefined) {
    terms = { ...base.terms };
    for (const item of termsList) {
      const pair = /^(page|component):\s*([A-Za-z][A-Za-z -]{0,30})$/.exec(item.trim());
      if (!pair) refuse('terms', `lists "page: <word>" and "component: <word>"; not "${item}".`);
      terms[pair[1] as 'page' | 'component'] = pair[2]!.trim();
    }
  }
  const workshop = text(fields, 'workshop');
  const setupFiles = list(fields, 'setupFiles')?.map(setupFile);
  const devDependencies = list(fields, 'devDependencies');

  return {
    contract: 1,
    recipe: recipeId === undefined ? base.recipe : recipe ? recipeId : null,
    recipeVersion:
      recipeVersion !== undefined ? Number(recipeVersion) : recipe ? base.recipeVersion : null,
    stack: list(fields, 'stack') ?? base.stack,
    family: (family as Family | undefined) ?? base.family,
    mode: (mode as PreviewMode | undefined) ?? base.mode,
    entry: entry ?? base.entry,
    sources: sources ? extensions('sources', sources) : base.sources,
    code: code ? extensions('code', code) : base.code,
    placement: placement ?? base.placement,
    wrapper:
      wrapper === undefined
        ? base.wrapper
        : wrapper === 'none'
          ? null
          : repoPath('wrapper', wrapper),
    runtime: runtime ?? base.runtime,
    shell: (shell as Shell | undefined) ?? base.shell,
    start: start ? { command: start.command, url: start.url } : base.start,
    preview: preview ?? base.preview,
    viewports: viewports ?? base.viewports,
    variants: variants ?? base.variants,
    reload: (reload as 'app' | 'studio' | undefined) ?? base.reload,
    ignore: list(fields, 'ignore') ?? base.ignore,
    overlays: list(fields, 'overlays') ?? base.overlays,
    fixture: fixture === undefined ? base.fixture : fixture === 'none' ? null : fixture,
    build: {
      command: build === undefined ? base.build.command : build === 'none' ? null : build,
      output: buildOutput ?? base.build.output
    },
    gate: (gate as Gate | undefined) ?? base.gate,
    production: served === undefined ? base.production : served,
    checks: checks ?? base.checks,
    timeouts: {
      start: timeout('timeoutStart') ?? base.timeouts.start,
      preview: timeout('timeoutPreview') ?? base.timeouts.preview,
      build: timeout('timeoutBuild') ?? base.timeouts.build
    },
    promote: {
      dir:
        promote === undefined
          ? base.promote.dir
          : promote === 'none'
            ? null
            : repoPath('promote', promote),
      extensions: promoteExtensions
        ? extensions('promoteExtensions', promoteExtensions)
        : base.promote.extensions.length
          ? base.promote.extensions
          : [extensionOf(entry ?? base.entry)]
    },
    assets: {
      dir:
        assets === undefined
          ? base.assets.dir
          : assets === 'none'
            ? null
            : repoPath('assets', assets),
      copy: assetsCopy === undefined ? base.assets.copy : /^(yes|true)$/.test(assetsCopy)
    },
    copy: copy ?? base.copy,
    terms: terms ?? base.terms,
    workshop: workshop === undefined ? base.workshop : workshop === 'none' ? null : workshop,
    setupFiles: setupFiles ?? base.setupFiles,
    devDependencies: devDependencies ?? base.devDependencies
  };
}

/** The extension of an entry file, dots and all: `index.blade.php` gives `.blade.php`. */
export function extensionOf(file: string): string {
  const dot = file.indexOf('.');
  return dot === -1 ? '' : file.slice(dot);
}

export type ReadOptions = { os?: EnvironmentOs };

/** The environment file's header, read now; null when the repo has no environment file. */
export function readEnvironmentFile(repoRoot: string): HeaderFields | null {
  let content: string;
  try {
    content = fs.readFileSync(roughPath(repoRoot, ENVIRONMENT_FILE), 'utf8');
  } catch {
    return null;
  }
  const fields = parseEnvironmentHeader(content);
  if (!fields) {
    throw new Error(
      `${ROUGH_DIR}/${ENVIRONMENT_FILE} has no header between --- lines, so this studio cannot read it.`
    );
  }
  return fields;
}

/** Whether the repo has an environment file at all, however it reads. */
export function hasEnvironmentFile(repoRoot: string): boolean {
  return fs.existsSync(roughPath(repoRoot, ENVIRONMENT_FILE));
}

/**
 * The repo's environment with the link given, without waiting: for the planning steps that read
 * synchronously. The fallback recipe's when the repo has no environment file.
 */
export function readEnvironmentSync(
  repoRoot: string,
  link: RepoLink | null,
  options: ReadOptions = {}
): RepoEnvironment {
  const fields = readEnvironmentFile(repoRoot);
  if (!fields) return defaultEnvironment(link);
  return environmentFromHeader(fields, link, options.os ?? currentOs(hostPlatform()));
}

/**
 * The repo's environment: its environment file over its recipe's values, or the fallback recipe's
 * when there is no file. The link is read when not given; a repo with none reads as the fallback.
 */
export async function readEnvironment(
  repoRoot: string,
  link?: RepoLink | null,
  options: ReadOptions = {}
): Promise<RepoEnvironment> {
  const linked = link === undefined ? await readRepoLink(repoRoot).catch(() => null) : link;
  return readEnvironmentSync(repoRoot, linked, options);
}

/** One iteration's preview on the app's dev server, from the environment's template. */
export function previewUrl(
  devUrl: string,
  page: string,
  component: string,
  iteration: string,
  environment: RepoEnvironment = defaultEnvironment()
): string {
  const key = `${page}/${component}/${iteration}`;
  return `${devUrl.replace(/\/$/, '')}${environment.preview.replaceAll('{key}', key)}`;
}

/** A word as a label: `view` becomes `View`. */
function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export type Placeholders = {
  entry?: string;
  termPage?: string;
  termComponent?: string;
  environment?: string;
};

/**
 * A prompt with the environment's values where the backend left its stand-ins: the entry file,
 * the stack's words for page and component as labels, and the line about rough/environment.md,
 * which is taken out, with its line break, when the repo has no environment file.
 */
export function fillEnvironment(
  prompt: string,
  environment: RepoEnvironment,
  placeholders: Placeholders = {},
  options: { hasEnvironmentFile?: boolean } = {}
): string {
  const line = options.hasEnvironmentFile ? ENVIRONMENT_LINE : '';
  const environmentStandIn = placeholders.environment ?? ENVIRONMENT_PLACEHOLDER;
  const escaped = environmentStandIn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return prompt
    .replaceAll(placeholders.entry ?? ENTRY_PLACEHOLDER, () => environment.entry)
    .replaceAll(placeholders.termPage ?? TERM_PAGE_PLACEHOLDER, () =>
      capitalized(environment.terms.page)
    )
    .replaceAll(placeholders.termComponent ?? TERM_COMPONENT_PLACEHOLDER, () =>
      capitalized(environment.terms.component)
    )
    .replace(new RegExp(`^${escaped}\\r?\\n`, 'm'), () => (line ? `${line}\n` : ''))
    .replaceAll(environmentStandIn, () => line);
}
