// Reads a repo's environment: the header of rough/environment.md, with the recipe's values for
// whatever it leaves out, or the recipe's alone for a repo linked before environments existed
// (decision 20 of the frameworks plan). The prose below the header is for agents; the studio
// never reads it.
import fs from 'node:fs';
import { fallbackRecipe, recipeFor } from '../recipes/index.js';
import { readRepoLink, type RepoLink } from '../repo/link.js';
import { ROUGH_DIR, roughPath } from '../repo/root.js';
import {
  FAMILIES,
  PREVIEW_MODES,
  type Family,
  type PreviewMode,
  type RepoEnvironment,
  type Viewport
} from './types.js';

/** Inside `rough/`: the repo's environment, committed with it. */
export const ENVIRONMENT_FILE = 'environment.md';

/**
 * The stand-in the backend writes where a prompt names the entry file: the first of the
 * environment's fields a prompt carries (decision 15 of the frameworks plan).
 */
export const ENTRY_PLACEHOLDER = '{{roughbook:entry}}';

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

/** The environment the header describes, over the recipe's values. */
export function environmentFromHeader(
  fields: HeaderFields,
  link: RepoLink | null
): RepoEnvironment {
  const contract = text(fields, 'contract');
  if (contract !== undefined && contract !== '1')
    refuse('contract', `${contract} is not one this studio knows; it knows 1.`);
  const recipeId = text(fields, 'recipe');
  const recipe = recipeId === undefined ? fallbackRecipe : recipeFor(recipeId);
  if (!recipe) refuse('recipe', `names ${recipeId}, which this studio does not have.`);
  const base = recipe.environment(link);

  const family = text(fields, 'family');
  if (family !== undefined && !FAMILIES.includes(family as Family)) {
    refuse('family', `is ${family}; it is one of ${FAMILIES.join(', ')}.`);
  }
  const mode = text(fields, 'mode');
  if (mode !== undefined && !PREVIEW_MODES.includes(mode as PreviewMode)) {
    refuse('mode', `is ${mode}; it is one of ${PREVIEW_MODES.join(', ')}.`);
  }
  const entry = text(fields, 'entry');
  if (entry !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry)) {
    refuse('entry', 'is a file name inside the iteration folder, with no slash.');
  }
  const preview = text(fields, 'preview');
  if (preview !== undefined && (!preview.startsWith('/') || !preview.includes('{key}'))) {
    refuse('preview', 'is a path starting with / that holds {key} where the iteration goes.');
  }
  const start = text(fields, 'start');
  if (start !== undefined && !/^https?:\/\/\S+$/.test(start)) {
    refuse('start', 'is the address the app answers on, such as http://localhost:3000.');
  }
  const viewports = list(fields, 'viewports')?.map(viewport);
  if (viewports && !viewports.length) refuse('viewports', 'names at least one viewport.');
  const sources = list(fields, 'sources');
  const code = list(fields, 'code');

  return {
    contract: 1,
    recipe: recipeId === undefined ? base.recipe : recipeId,
    stack: list(fields, 'stack') ?? base.stack,
    family: (family as Family | undefined) ?? base.family,
    mode: (mode as PreviewMode | undefined) ?? base.mode,
    entry: entry ?? base.entry,
    sources: sources ? extensions('sources', sources) : base.sources,
    code: code ? extensions('code', code) : base.code,
    start: start ? { url: start.replace(/\/+$/, '') } : base.start,
    preview: preview ?? base.preview,
    viewports: viewports ?? base.viewports,
    ignore: list(fields, 'ignore') ?? base.ignore,
    overlays: list(fields, 'overlays') ?? base.overlays
  };
}

/**
 * The repo's environment: its environment file over its recipe's values, or the fallback recipe's
 * when there is no file. The link is read when not given; a repo with none reads as the fallback.
 */
export async function readEnvironment(
  repoRoot: string,
  link?: RepoLink | null
): Promise<RepoEnvironment> {
  const linked = link === undefined ? await readRepoLink(repoRoot).catch(() => null) : link;
  let content: string;
  try {
    content = fs.readFileSync(roughPath(repoRoot, ENVIRONMENT_FILE), 'utf8');
  } catch {
    return defaultEnvironment(linked);
  }
  const fields = parseEnvironmentHeader(content);
  if (!fields) {
    throw new Error(
      `${ROUGH_DIR}/${ENVIRONMENT_FILE} has no header between --- lines, so this studio cannot read it.`
    );
  }
  return environmentFromHeader(fields, linked);
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

/** A prompt with the environment's values where the backend left its stand-ins. */
export function fillEnvironment(
  prompt: string,
  environment: RepoEnvironment,
  placeholders: { entry?: string } = {}
): string {
  return prompt.replaceAll(placeholders.entry ?? ENTRY_PLACEHOLDER, () => environment.entry);
}
