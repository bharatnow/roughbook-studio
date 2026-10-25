// rough/map.md: the repo's map (decision 4 of the brownfield plan). Like rough/environment.md it
// is a header the studio reads, between two --- lines, then prose every agent reads. The header is
// a small subset of YAML an agent writes as easily as the studio: `key: value` lines, and lists of
// `- item` lines, where a page or a component is a record of indented `field: value` lines. A list
// inside a record (its files, a page's sections) is one line, comma-separated. The studio rewrites
// the header and keeps the prose.
import fs from 'node:fs';
import path from 'node:path';
import { SLUG } from '../repo/iterations.js';
import { ROUGH_DIR, roughPath } from '../repo/root.js';
import {
  COMPONENT_KINDS,
  KNOWN,
  SHARED_PAGE,
  type ComponentKind,
  type Known,
  type MapComponent,
  type MapPage,
  type Missed,
  type RepoMap
} from './types.js';

/** Inside `rough/`: the repo's map, committed with it. */
export const MAP_FILE = 'map.md';

/** Inside `rough/`: the fixtures the map names, one folder per component. */
export const MAP_FIXTURES = 'map/fixtures';

const NONE = 'none';

/** The prose a new map starts with, for the map run's agent and the designer to add to. */
export const DEFAULT_PROSE = `# The map of this app

The pages this app has, the sections each is made of in order, the parts every page shares
(Shared), and the atoms below them, as \`roughbook map\` read them from the app's own files. Nothing
here reaches Roughbook's server until a page or a component is adopted, and then only its name.

\`roughbook map\` rewrites the header above whenever the app changes. It keeps what the map run or
you wrote there: names, kinds, fixtures, example addresses, sign-ins and what renders alone, and
the pages and components marked \`found: agent\`. This prose is never rewritten.

## Notes

What a component depends on, where its data comes from, and which ones only make sense in their
page, for agents working on them.
`;

export class MapFormatError extends Error {}

function refuse(line: number | null, why: string): never {
  throw new MapFormatError(
    `${ROUGH_DIR}/${MAP_FILE}${line === null ? '' : `, line ${line}`}: ${why}`
  );
}

function listOf(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === NONE) return [];
  return trimmed
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function scalar(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === NONE) return null;
  return /^(['"]).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

function known(value: string | undefined, field: string, line: number): Known {
  if (value === undefined) return 'unknown';
  const text = value.trim();
  if (text === 'true') return 'yes';
  if (text === 'false') return 'no';
  if (!KNOWN.includes(text as Known))
    refuse(line, `${field} is yes, no or unknown; not "${text}".`);
  return text as Known;
}

type RawRecord = { line: number; fields: Record<string, string> };

/** The header's lines, numbered from the file's first line; null when the file has none. */
function headerLines(text: string): { line: number; text: string }[] | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return null;
  return lines.slice(1, end).map((line, index) => ({ line: index + 2, text: line }));
}

/** The prose below the header, as written; the default prose when there is none. */
export function mapProse(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return text;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return text;
  return lines
    .slice(end + 1)
    .join('\n')
    .replace(/^\n+/, '');
}

/**
 * The map the header describes. It refuses a line it cannot read, a page or a component without
 * a slug, and a field whose value is not one the map knows; fields it does not know are left out,
 * so a later studio's map still reads.
 */
export function parseMap(text: string): RepoMap {
  const lines = headerLines(text);
  if (!lines) refuse(null, 'has no header between --- lines.');
  const top: Record<string, string> = {};
  const lists: Record<string, { line: number; text: string }[]> = {};
  const records: Record<string, RawRecord[]> = {};
  let list: string | null = null;
  for (const { line, text: raw } of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const pair = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(raw);
    if (pair) {
      const [, key, value] = pair;
      if (value!.trim() === '') {
        list = key!;
        lists[key!] = [];
        records[key!] = [];
      } else {
        top[key!] = value!;
        list = null;
      }
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item && list) {
      lists[list]!.push({ line, text: item[1]! });
      const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(item[1]!);
      records[list]!.push({ line, fields: field ? { [field[1]!]: field[2]! } : {} });
      continue;
    }
    const field = /^\s{3,}([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(raw);
    if (field && list && records[list]!.length) {
      records[list]!.at(-1)!.fields[field[1]!] = field[2]!;
      continue;
    }
    refuse(line, `cannot read "${raw.trim()}".`);
  }

  const version = top.map?.trim();
  if (version !== undefined && version !== '1') {
    refuse(null, `map ${version} is not a version this studio knows; it knows 1.`);
  }
  const pages = (records.pages ?? []).map(record => readPage(record));
  const components = (records.components ?? []).map(record => readComponent(record));
  const missed: Missed[] = (lists.missed ?? []).map(({ line, text: item }) => {
    const split = item.indexOf(': ');
    if (split === -1) refuse(line, `a missed item is "<what>: <why>"; not "${item}".`);
    return { what: item.slice(0, split).trim(), why: item.slice(split + 2).trim() };
  });
  const unplaced = (lists.unplaced ?? []).map(({ text: item }) => item.trim()).filter(Boolean);
  return { version: 1, by: listOf(top.by ?? ''), pages, components, missed, unplaced };
}

function readPage({ line, fields }: RawRecord): MapPage {
  const slug = scalar(fields.slug ?? '');
  if (!slug) refuse(line, 'a page needs its slug.');
  const address = scalar(fields.address ?? '');
  return {
    slug,
    name: scalar(fields.name ?? '') ?? slug,
    address: slug === SHARED_PAGE ? null : address,
    example: scalar(fields.example ?? ''),
    signIn: known(fields.signIn, 'signIn', line),
    files: listOf(fields.files ?? ''),
    sections: listOf(fields.sections ?? ''),
    byAgent: scalar(fields.found ?? '') === 'agent'
  };
}

function readComponent({ line, fields }: RawRecord): MapComponent {
  const slug = scalar(fields.slug ?? '');
  if (!slug) refuse(line, 'a component needs its slug.');
  const kind = scalar(fields.kind ?? '') ?? 'section';
  if (!COMPONENT_KINDS.includes(kind as ComponentKind)) {
    refuse(line, `kind is ${COMPONENT_KINDS.join(', ')}; not "${kind}".`);
  }
  // A fixture is the repo's path; one written from rough/ (map/fixtures/…), as an agent may, is
  // read as the repo's.
  const fixture = scalar(fields.fixture ?? '');
  return {
    slug,
    name: scalar(fields.name ?? '') ?? slug,
    kind: kind as ComponentKind,
    files: listOf(fields.files ?? ''),
    export: scalar(fields.export ?? '') ?? 'default',
    fixture: fixture?.startsWith(`${MAP_FIXTURES}/`) ? `${ROUGH_DIR}/${fixture}` : fixture,
    alone: known(fields.alone, 'alone', line),
    why: scalar(fields.why ?? ''),
    byAgent: scalar(fields.found ?? '') === 'agent'
  };
}

/** One value on one line: a line break or a leading list marker would change what it means. */
function flat(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function joined(items: string[]): string {
  return items.length ? items.map(flat).join(', ') : NONE;
}

/** The header, as the studio writes it: every field in the same order, so a diff shows a change. */
export function renderMapHeader(map: RepoMap): string {
  const lines = ['---', `map: ${map.version}`, `by: ${joined(map.by)}`];
  lines.push(map.pages.length ? 'pages:' : 'pages: none');
  for (const page of map.pages) {
    lines.push(`  - slug: ${page.slug}`, `    name: ${flat(page.name)}`);
    if (page.slug !== SHARED_PAGE) {
      lines.push(`    address: ${page.address ? flat(page.address) : NONE}`);
      if (page.example || isDynamic(page.address)) {
        lines.push(`    example: ${page.example ? flat(page.example) : NONE}`);
      }
      lines.push(`    signIn: ${page.signIn}`);
    }
    lines.push(`    files: ${joined(page.files)}`, `    sections: ${joined(page.sections)}`);
    if (page.byAgent) lines.push('    found: agent');
  }
  lines.push(map.components.length ? 'components:' : 'components: none');
  for (const component of map.components) {
    lines.push(
      `  - slug: ${component.slug}`,
      `    name: ${flat(component.name)}`,
      `    kind: ${component.kind}`,
      `    files: ${joined(component.files)}`,
      `    export: ${flat(component.export)}`,
      `    fixture: ${component.fixture ? flat(component.fixture) : NONE}`,
      `    alone: ${component.alone}`
    );
    if (component.why) lines.push(`    why: ${flat(component.why)}`);
    if (component.byAgent) lines.push('    found: agent');
  }
  if (map.missed.length) {
    lines.push('missed:');
    for (const item of map.missed) lines.push(`  - ${flat(item.what)}: ${flat(item.why)}`);
  }
  if (map.unplaced.length) {
    lines.push('unplaced:');
    for (const file of map.unplaced) lines.push(`  - ${flat(file)}`);
  }
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

/** The whole file: the header, then the prose. */
export function renderMap(map: RepoMap, prose: string = DEFAULT_PROSE): string {
  return `${renderMapHeader(map)}\n${prose.replace(/^\n+/, '').replace(/\n*$/, '\n')}`;
}

/** Whether an address has a segment the app fills per request: `[slug]`, `{post}`, `:id`. */
export function isDynamic(address: string | null): boolean {
  return Boolean(address && /\[[^\]]+\]|\{[^}]+\}|(^|\/):[A-Za-z]/.test(address));
}

/** A path inside the repo, relative, with forward slashes, never climbing out. */
function insideRepo(file: string): boolean {
  return (
    Boolean(file) &&
    !file.startsWith('/') &&
    !/^[a-z]:/i.test(file) &&
    !file.includes('\\') &&
    !file.split('/').includes('..')
  );
}

/**
 * What is wrong with a map that reads: slugs that are not slugs or appear twice, a section naming
 * no component, a fixture outside rough/, a path outside the repo. Empty when nothing is.
 */
export function mapProblems(map: RepoMap): string[] {
  const problems: string[] = [];
  const seen = (items: { slug: string }[], what: string) => {
    const slugs = new Set<string>();
    for (const item of items) {
      if (!SLUG.test(item.slug)) problems.push(`The ${what} slug "${item.slug}" is not a slug.`);
      if (slugs.has(item.slug)) problems.push(`Two ${what}s are called ${item.slug}.`);
      slugs.add(item.slug);
    }
  };
  seen(map.pages, 'page');
  seen(map.components, 'component');
  const components = new Set(map.components.map(component => component.slug));
  for (const page of map.pages) {
    for (const section of page.sections) {
      if (!components.has(section)) {
        problems.push(
          `The page ${page.slug} names ${section}, which is not a component in the map.`
        );
      }
    }
    for (const file of page.files) {
      if (!insideRepo(file))
        problems.push(`The page ${page.slug} names ${file}, outside the repo.`);
    }
    if (page.address !== null && page.slug !== SHARED_PAGE && !page.address.startsWith('/')) {
      problems.push(`The page ${page.slug}'s address ${page.address} does not start with /.`);
    }
  }
  for (const component of map.components) {
    for (const file of component.files) {
      if (!insideRepo(file)) {
        problems.push(`The component ${component.slug} names ${file}, outside the repo.`);
      }
    }
    if (
      component.fixture &&
      (!insideRepo(component.fixture) || !component.fixture.startsWith(`${ROUGH_DIR}/`))
    ) {
      problems.push(
        `The component ${component.slug}'s fixture ${component.fixture} is not a file inside ${ROUGH_DIR}/.`
      );
    }
  }
  return problems;
}

export function mapPath(repoRoot: string): string {
  return roughPath(repoRoot, MAP_FILE);
}

export function hasMapFile(repoRoot: string): boolean {
  return fs.existsSync(mapPath(repoRoot));
}

/** The map and its prose, read now; null when the repo has no map. Throws when it does not read. */
export function readMap(repoRoot: string): { map: RepoMap; prose: string } | null {
  let text: string;
  try {
    text = fs.readFileSync(mapPath(repoRoot), 'utf8');
  } catch {
    return null;
  }
  return { map: parseMap(text), prose: mapProse(text) };
}

/** Writes the map, keeping the prose already there. Returns whether the file changed. */
export function writeMap(repoRoot: string, map: RepoMap, prose?: string): boolean {
  const file = mapPath(repoRoot);
  let current: string | null = null;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    // A new map.
  }
  const kept = prose ?? (current !== null ? mapProse(current) : DEFAULT_PROSE);
  const next = renderMap(map, kept.trim() ? kept : DEFAULT_PROSE);
  if (current !== null && current.replace(/\r\n/g, '\n') === next) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return true;
}
