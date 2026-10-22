// Reads a repo's environment: the header of rough/environment.md, with the recipe's values for
// whatever it leaves out, or the recipe's alone for a repo linked before environments existed
// (decision 20 of the frameworks plan). The prose below the header is for agents; the studio
// never reads it. Commands are declared per operating system (decision 30): a `…Windows` key
// beside a command's key is the variant Windows runs, and the shell likewise.
import fs from 'node:fs';
import { currentOs, hostPlatform } from '../launch/platform.js';
import { stackCraft, type CraftWords } from '../recipes/craft.js';
import { fallbackRecipe, recipeFor, recipeOf } from '../recipes/index.js';
import { STANDALONE_ENTRIES, standaloneRenderer } from '../recipes/standalone/index.js';
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
 * (decision 15 of the frameworks plan): the entry file and what its family asks of it, the stack's
 * words for page and component, and the line that points the agent at rough/environment.md, which
 * stays out of a repo with none.
 */
export const ENTRY_PLACEHOLDER = '{{roughbook:entry}}';
export const ENTRY_NOTE_PLACEHOLDER = '{{roughbook:entry-note}}';
export const TERM_PAGE_PLACEHOLDER = '{{roughbook:term-page}}';
export const TERM_COMPONENT_PLACEHOLDER = '{{roughbook:term-component}}';
export const ENVIRONMENT_PLACEHOLDER = '{{roughbook:environment}}';
/** The sentence that says how the iteration is shown, which the preview mode decides (F7). */
export const PREVIEW_PLACEHOLDER = '{{roughbook:preview}}';
/**
 * What the rules ask of the stack's craft (the floor's paragraph), and the primitives they name
 * after the app's own, which the recipe decides, or the family for a repo set up by none.
 */
export const CRAFT_PLACEHOLDER = '{{roughbook:craft}}';
export const PRIMITIVES_PLACEHOLDER = '{{roughbook:primitives}}';

/**
 * The preview path in standalone mode: the studio's own server's, whatever the stack. It ends with
 * a slash, so an iteration's own files resolve inside its folder.
 */
export const STANDALONE_PREVIEW = '/rough-preview/{key}/';

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
      ? `is the command that ${field === 'start' ? 'starts the app' : 'runs the app in production mode'} and the address it answers on, as "<command> @ <url>", or the address alone.`
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
  const base = recipe ? recipe.environment(link, os) : bareEnvironment(link);
  // With no recipe, the file must say what a recipe would have, in the table's order. Standalone
  // previews need nothing of the app running, so no start command or preview path; snapshot
  // previews need the command that renders keys to images instead.
  if (!recipe) {
    const named = text(fields, 'mode') ?? base.mode;
    const own = named === 'live' ? ['start', 'preview'] : named === 'snapshot' ? ['snapshot'] : [];
    for (const field of ['entry', 'sources', ...own, 'gate']) {
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
    refuse(
      'preview',
      ((mode as PreviewMode | undefined) ?? base.mode) === 'snapshot'
        ? 'is the address of a live preview; in snapshot mode the command that renders keys to images is snapshot.'
        : 'is a path starting with / that holds {key} where the iteration goes.'
    );
  }
  // The snapshot contract's command, and the one that opens a key on a device; `none` for neither.
  const snapshotText = forOs(fields, 'snapshot', os);
  const snapshot =
    snapshotText === undefined ? undefined : snapshotText === 'none' ? null : snapshotText;
  const deviceText = forOs(fields, 'device', os);
  const device = deviceText === undefined ? undefined : deviceText === 'none' ? null : deviceText;
  if (device && !device.includes('{key}')) {
    refuse('device', 'is the command that opens one iteration, with {key} where its key goes.');
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
    // The address alone: the app already runs in production there (a store's live theme), so
    // doctor asks it and starts nothing.
    served = commandAt('production', productionText, true);
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
  // Standalone mode: the folder the site serves at its root, and its stylesheets as its pages
  // link them, which the studio's own server loads around every iteration.
  const publicText = text(fields, 'public');
  let publicDir: string | null | undefined;
  if (publicText !== undefined) {
    const value = publicText.trim();
    if (value === 'none') publicDir = null;
    else if (value === '.' || value === './') publicDir = '.';
    else {
      publicDir = repoPath('public', value);
      if (publicDir === ROUGH_DIR || publicDir.startsWith(`${ROUGH_DIR}/`)) {
        refuse(
          'public',
          `is the site's own folder, served at its root; ${ROUGH_DIR}/ is shown at the previews' addresses, never from it.`
        );
      }
    }
  }
  const stylesheets = list(fields, 'stylesheets');
  for (const item of stylesheets ?? []) {
    const address = /^https?:\/\/\S+$/.test(item);
    const onSite =
      /^\/[^\s#]*$/.test(item) &&
      !item
        .split('?')[0]!
        .split('/')
        .some(segment => segment === '..' || segment === '.');
    if (!address && !onSite) {
      refuse(
        'stylesheets',
        `lists each stylesheet as the site's pages link it: a path on the site starting with / (served from the public folder), or a full address; not "${item}".`
      );
    }
  }
  const servedFrom = publicDir === undefined ? base.public : publicDir;
  const onSiteSheet = (stylesheets ?? base.stylesheets).find(item => item.startsWith('/'));
  if (onSiteSheet && servedFrom === null) {
    refuse(
      'stylesheets',
      `names ${onSiteSheet}, a path on the site, but public names no folder to serve it from.`
    );
  }
  const shownBy = (mode as PreviewMode | undefined) ?? base.mode;
  if (shownBy === 'snapshot' && !(snapshot === undefined ? base.snapshot : snapshot)) {
    refuse(
      'snapshot',
      'is the command that renders keys to images (rough/CONTRACT.md); snapshot mode needs one.'
    );
  }
  if (shownBy === 'standalone') {
    if (preview !== undefined && preview !== STANDALONE_PREVIEW) {
      refuse(
        'preview',
        `is the studio's own in standalone mode (${STANDALONE_PREVIEW}); leave it out.`
      );
    }
    if (reload === 'app') {
      refuse(
        'reload',
        "is studio in standalone mode: the studio's own server shows a change when the frame reloads."
      );
    }
    const shownEntry = entry ?? base.entry;
    if (!standaloneRenderer(shownEntry)) {
      refuse(
        'entry',
        `is ${shownEntry || 'missing'}; standalone mode shows ${STANDALONE_ENTRIES}.`
      );
    }
  }
  const checks = listForOs(fields, 'checks', os);
  const promote = text(fields, 'promote');
  const promoteExtensions = list(fields, 'promoteExtensions');
  // `<folder>`, `<folder> @ <path>` for a folder the app serves somewhere other than its root, or
  // `<folder> @ bundled` for assets that ship with the code; none for no folder at all.
  const assetsText = text(fields, 'assets');
  const assetsParts =
    assetsText === undefined || assetsText === 'none'
      ? null
      : /^(\S+?)(?:\s+@\s+(\S+))?$/.exec(assetsText.trim());
  const assets = assetsText === 'none' ? 'none' : (assetsParts?.[1] ?? assetsText);
  const assetsAt = assetsParts?.[2];
  if (
    assetsAt !== undefined &&
    assetsAt !== 'bundled' &&
    (!/^\/[^\s?#]*$/.test(assetsAt) || assetsAt.split('/').some(part => part === '..'))
  ) {
    refuse(
      'assets',
      `is the folder promoted assets go to, with " @ <path>" when the app serves it somewhere other than its root (public/images @ /images), or " @ bundled" when they ship with the code; not "${assetsText}".`
    );
  }
  const assetsCopy = text(fields, 'assetsCopy');
  if (assetsCopy !== undefined && !/^(yes|no|true|false)$/.test(assetsCopy)) {
    refuse('assetsCopy', 'is yes or no.');
  }
  const sketches = text(fields, 'sketches');
  if (sketches !== undefined && sketches !== 'copy' && sketches !== 'port') {
    refuse(
      'sketches',
      'is copy, where a web sketch renders as it is, or port, where pulling one rebuilds it in this stack.'
    );
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
    preview: shownBy === 'standalone' ? STANDALONE_PREVIEW : (preview ?? base.preview),
    snapshot: snapshot === undefined ? base.snapshot : snapshot,
    device: device === undefined ? base.device : device,
    viewports: viewports ?? base.viewports,
    variants: variants ?? base.variants,
    reload:
      shownBy === 'standalone'
        ? 'studio'
        : ((reload as 'app' | 'studio' | undefined) ?? base.reload),
    stylesheets: stylesheets ?? base.stylesheets,
    public: servedFrom,
    // A mirror in the source tree is the studio's copy of rough/, so snapshots and the watcher
    // never count it as a change outside an iteration (decision 25).
    ignore: withMirror(list(fields, 'ignore') ?? base.ignore, placement ?? base.placement),
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
    assets: assetsField(base, { assets, assetsAt, assetsCopy, shownBy, recipe: Boolean(recipe) }),
    copy: copy ?? base.copy,
    sketches: (sketches as 'copy' | 'port' | undefined) ?? base.sketches,
    terms: terms ?? base.terms,
    workshop: workshop === undefined ? base.workshop : workshop === 'none' ? null : workshop,
    setupFiles: setupFiles ?? base.setupFiles,
    devDependencies: devDependencies ?? base.devDependencies
  };
}

/**
 * Where promoted assets go and how the app uses them (decision 29). Snapshot tools have no
 * network, so a snapshot stack's iterations get their assets copied in unless the header says
 * otherwise. A folder named without an address keeps the recipe's; with no recipe, the app serves
 * it at its root, or bundles it where previews need assets copied in.
 */
function assetsField(
  base: RepoEnvironment,
  header: {
    assets: string | undefined;
    assetsAt: string | undefined;
    assetsCopy: string | undefined;
    shownBy: PreviewMode;
    recipe: boolean;
  }
): RepoEnvironment['assets'] {
  const copy =
    header.assetsCopy === undefined
      ? base.assets.copy || header.shownBy === 'snapshot'
      : /^(yes|true)$/.test(header.assetsCopy);
  const url =
    header.assetsAt === 'bundled'
      ? null
      : header.assetsAt !== undefined
        ? header.assetsAt.replace(/(.)\/+$/, '$1')
        : header.recipe
          ? base.assets.url
          : copy
            ? null
            : '/';
  return {
    dir:
      header.assets === undefined
        ? base.assets.dir
        : header.assets === 'none'
          ? null
          : repoPath('assets', header.assets),
    url,
    copy
  };
}

/** The ignore list with an in-tree mirror's folder added, when no entry covers it already. */
function withMirror(ignore: string[], placement: RepoEnvironment['placement']): string[] {
  if (placement.kind !== 'in-tree') return ignore;
  const mirror = placement.path;
  const covered = ignore.some(item => {
    const clean = item.replace(/^\.?\/+/, '').replace(/\/+$/, '');
    return mirror === clean || mirror.startsWith(`${clean}/`);
  });
  return covered ? ignore : [...ignore, mirror];
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

/**
 * What a prompt says of the entry file after its name: a React-like family's entry is a module
 * whose default export is the iteration; any other's, such as a page or a template, is named alone.
 */
export function entryNote(environment: RepoEnvironment): string {
  return environment.family === 'react-like' ? ' with a default export' : '';
}

/**
 * How a prompt says the iteration is shown, by the repo's preview mode: through the app's own
 * development-only route (the live mode, as every prompt said before F7), as the images the
 * repo's snapshot command renders, or on the studio's own page with the site's stylesheets.
 */
export function previewSentence(environment: RepoEnvironment): string {
  switch (environment.mode) {
    case 'snapshot':
      return "This iteration is shown as images: the repo's snapshot command renders it\nwith the app's own theme and the preview wrapper, at every viewport and variant.";
    case 'standalone':
      return "This iteration renders on the studio's own preview page, with the site's\nstylesheets and its public folder, as the site's own pages would show it.";
    default:
      return "This iteration renders inside the client's app, through a development-only\npreview route, with the app's own root layout and global styles.";
  }
}

/**
 * What a prompt's rules ask of the stack's craft: the recipe's words, or the family's for a repo
 * set up by none. A web page's floor (its elements, color-scheme, transitions) goes only to a web
 * page; a toolkit that draws its own controls is told its own.
 */
export function craftWords(environment: RepoEnvironment): CraftWords {
  return stackCraft(environment, recipeOf(environment));
}

export type Placeholders = {
  entry?: string;
  entryNote?: string;
  termPage?: string;
  termComponent?: string;
  environment?: string;
  preview?: string;
  craft?: string;
  primitives?: string;
};

/**
 * A prompt with the environment's values where the backend left its stand-ins: the entry file and
 * its family's note on it, the stack's words for page and component as labels, the sentence that
 * says how its preview mode shows the iteration, what the rules ask of the stack's craft, and the
 * line about rough/environment.md, which is taken out, with its line break, when the repo has no
 * environment file.
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
  const craft = craftWords(environment);
  return prompt
    .replaceAll(placeholders.entry ?? ENTRY_PLACEHOLDER, () => environment.entry)
    .replaceAll(placeholders.entryNote ?? ENTRY_NOTE_PLACEHOLDER, () => entryNote(environment))
    .replaceAll(placeholders.termPage ?? TERM_PAGE_PLACEHOLDER, () =>
      capitalized(environment.terms.page)
    )
    .replaceAll(placeholders.termComponent ?? TERM_COMPONENT_PLACEHOLDER, () =>
      capitalized(environment.terms.component)
    )
    .replaceAll(placeholders.preview ?? PREVIEW_PLACEHOLDER, () => previewSentence(environment))
    .replaceAll(placeholders.craft ?? CRAFT_PLACEHOLDER, () => craft.floor)
    .replaceAll(placeholders.primitives ?? PRIMITIVES_PLACEHOLDER, () => craft.primitives)
    .replace(new RegExp(`^${escaped}\\r?\\n`, 'm'), () => (line ? `${line}\n` : ''))
    .replaceAll(environmentStandIn, () => line);
}
