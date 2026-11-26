// A late fact change in the studio (ROUGHBOOK-FACT-CHANGE-PLAN.md, U5): the designer's words are
// read into edits by the backend, the places they reach are found here in the client's repo, and
// the approved places are spliced into a copy of each section's pick, which the studio then picks.
// Only the words (paths as stand-ins), the edits, their summary, ids and iteration numbers go to
// the backend; the places' lines, files and paths stay on this machine. The log of changes is
// rough/.facts/changes.json, which Undo reads.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { StudioApi } from '../api/client.js';
import { ApiError, OfflineError, describeError } from '../api/errors.js';
import {
  factStackWhy,
  findLocal,
  spliceLocal,
  type FactStackEnvironment,
  type FoundPlace,
  type SpliceLocalResult
} from '../facts/index.js';
import type { FactContextReply, FactEdit } from '../api/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { withLock } from '../fs/lock.js';
import { ITERATION, SLUG, iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import { redactLocalPaths } from '../runs/localPaths.js';
import { recordOwnWritesForOpenRuns } from '../runs/snapshot.js';
import { BadRequest, type LocalStudio } from './studio.js';

// --- the sheet's contract, as @roughbook/ui's fact-sheet.ts has it (0.4.4) ----------------------
// Kept here so the server needs nothing of the ui package; the shapes are the same.

export type FactReading = { summary: string; edits: FactEdit[]; unsure: string | null };

export type FactPlaceView = {
  id: string;
  page: string;
  pageName: string;
  section: string;
  before: string;
  after: string;
  sure: boolean;
  why: string;
  kept: boolean;
  nav: boolean;
};

export type FactAddView = {
  edit: number;
  name: string;
  collection: string;
  page: { name: string; slug: string; job: string } | null;
  listings: { page: string; component: string }[];
  nav: { added: boolean; why?: string };
  limits: string[];
  refusal: string | null;
};

export type FactSheetData = {
  reading: FactReading;
  places: FactPlaceView[];
  adds: FactAddView[];
  refusal: string | null;
};

export type FactChangeDone = { ok: boolean; message: string; summary: string; changeIds: string[] };

// --- what the studio's src/facts gives ---------------------------------------------------------

/** A place a set or rename reaches in the repo, as src/facts finds it (the backend's FoundPlace). */
export type LocalPlace = FoundPlace;

/** The finder and splicer in src/facts, and whether this repo's stack is one they serve. */
export type FactsLib = {
  findLocal: typeof findLocal;
  spliceLocal: typeof spliceLocal;
  /** Why fact changes are not there yet for this repo's stack, in a sentence; null when they are. */
  stackWhy(): string | null;
};

/** src/facts as it is, for the repo's environment as it is now. */
export function factsLib(environment: () => FactStackEnvironment): FactsLib {
  return { findLocal, spliceLocal, stackWhy: () => factStackWhy(environment()) };
}

/** What the routes need from the studio. */
export type FactsSource = {
  api: StudioApi;
  link: { orgId: string; project: string };
  repoRoot: string;
  lib: FactsLib;
  /** Picks an iteration, as the canvas's select decision does (through the outbox). */
  select(target: SectionTarget): Promise<{ status: string }>;
  /** Archives a copy the splice could not fill, as a verb's Undo does. */
  discard(target: SectionTarget): Promise<unknown>;
  /** The studio wrote these repo-relative files in rough/: mirror, registry, open runs. */
  wrote(files: string[]): Promise<void>;
  newId?: () => string;
  now?: () => Date;
};

type SectionTarget = { page: string; component: string; iteration: string };

/**
 * The studio's side of a fact change: its client and link, src/facts for the repo's environment,
 * and the same select decision the canvas sends (`POST /api/iterations/…/decisions`, kind select,
 * through LocalStudio.decide and the outbox). A write is shown as any other studio write is: the
 * registry and in-tree mirror brought up to date, open runs told it was not theirs, the canvas
 * told which iteration changed, and the project read again.
 */
export function factsSourceFor(studio: LocalStudio): FactsSource {
  return {
    ...studio.requestsSource,
    lib: factsLib(() => studio.environment),
    select: target => studio.decide(target, { kind: 'select' }),
    discard: target => studio.decide(target, { kind: 'discard' }),
    wrote: async files => {
      studio.keepRegistry();
      await recordOwnWritesForOpenRuns(studio.repoRoot, files);
      const keys = new Set(
        files.flatMap(file => {
          const parts = file.split('/');
          return parts[0] === ROUGH_DIR && parts.length > 4 ? [parts.slice(1, 4).join('/')] : [];
        })
      );
      for (const key of keys) studio.changes.note(key);
      studio.projectChanged();
    }
  };
}

// --- the log -----------------------------------------------------------------------------------

export const FACTS_DIR = '.facts';

export type LoggedSection = { page: string; component: string; previous: string; next: string };

export type LoggedChange = {
  id: string;
  summary: string;
  at: string;
  edits: FactEdit[];
  factsApplied: true;
  sections: LoggedSection[];
  /** When it was undone; absent while it stands. */
  undoneAt?: string;
};

export function changesFile(repoRoot: string): string {
  return path.join(repoRoot, ROUGH_DIR, FACTS_DIR, 'changes.json');
}

async function readLog(repoRoot: string): Promise<LoggedChange[]> {
  const value = await readJson<unknown>(changesFile(repoRoot)).catch(() => null);
  return Array.isArray(value) ? (value as LoggedChange[]) : [];
}

async function updateLog<T>(
  repoRoot: string,
  work: (log: LoggedChange[]) => { log: LoggedChange[]; value: T }
): Promise<T> {
  const file = changesFile(repoRoot);
  return withLock(file, async () => {
    const { log, value } = work(await readLog(repoRoot));
    await writeJsonAtomic(file, log);
    return value;
  });
}

/** The changes that stand, newest first, for a "Facts updated" list. */
export async function standingChanges(source: Pick<FactsSource, 'repoRoot'>) {
  const log = await readLog(source.repoRoot);
  return log
    .filter(change => !change.undoneAt)
    .reverse()
    .map(change => ({
      id: change.id,
      summary: change.summary,
      at: change.at,
      sections: change.sections.length
    }));
}

// --- reading what comes in, as the backend's validators would ----------------------------------

/** As the backend's validators (validators/factChange.ts) and the web's src/lib/facts.ts. */
export const MAX_WORDS = 2000;
export const MAX_EDITS = 12;
export const MAX_PHRASE = 300;
export const MAX_SUMMARY = 400;
export const MAX_PLACES = 2000;
export const MAX_PLACE_ID = 600;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function phrase(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_PHRASE ? trimmed : null;
}

function field(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_PHRASE ? value : null;
}

/** One edit as the backend accepts it, or null: the kind, its exact fields, and their lengths. */
export function editFrom(value: unknown): FactEdit | null {
  const edit = record(value);
  const keys = Object.keys(edit).sort().join(',');
  if (edit.kind === 'set') {
    const [subject, old, next] = [field(edit.subject), phrase(edit.old), phrase(edit.new)];
    return keys === 'kind,new,old,subject' && subject !== null && old && next
      ? { kind: 'set', subject, old, new: next }
      : null;
  }
  if (edit.kind === 'rename') {
    const [old, next] = [phrase(edit.old), phrase(edit.new)];
    return keys === 'kind,new,old' && old && next ? { kind: 'rename', old, new: next } : null;
  }
  if (edit.kind === 'add') {
    const [collection, name, facts] = [
      field(edit.collection),
      phrase(edit.name),
      field(edit.facts)
    ];
    return keys === 'collection,facts,kind,name' && collection !== null && name && facts !== null
      ? { kind: 'add', collection, name, facts }
      : null;
  }
  return null;
}

/** The edits a splice works on: sets and renames, in order. Place ids index into this list. */
export const swapEdits = (edits: FactEdit[]): FactEdit[] =>
  edits.filter(edit => edit.kind !== 'add');

const addEdits = (edits: FactEdit[]) =>
  edits.flatMap((edit, index) => (edit.kind === 'add' ? [{ index, edit }] : []));

/** The backend's reading; an answer that cannot be read is nothing read, never a guess. */
function readingFrom(data: unknown): FactReading {
  const answer = record(data);
  const edits = (Array.isArray(answer.edits) ? answer.edits : [])
    .map(editFrom)
    .filter((edit): edit is FactEdit => edit !== null)
    .slice(0, MAX_EDITS);
  return {
    summary: typeof answer.summary === 'string' ? answer.summary.trim() : '',
    edits,
    unsure: typeof answer.unsure === 'string' && answer.unsure ? answer.unsure : null
  };
}

/** The edit index a place's id ends in, or null. */
export function placeEdit(id: string): number | null {
  const tail = id.slice(id.lastIndexOf('|') + 1);
  return /^\d+$/.test(tail) ? Number(tail) : null;
}

export type FactChangeRequest = { summary: string; edits: FactEdit[]; places: string[] };

/** The sheet's post as JSON, checked as the web's readChangeForm checks the form. Throws in words. */
export function parseChange(body: Record<string, unknown>): FactChangeRequest {
  const raw = body.edits;
  if (!Array.isArray(raw) || raw.length === 0) throw new BadRequest('Nothing to change was sent.');
  if (raw.length > MAX_EDITS) {
    throw new BadRequest(`A change can hold up to ${MAX_EDITS} edits. Make it in parts.`);
  }
  const edits = raw.map(editFrom);
  if (edits.some(edit => edit === null)) {
    throw new BadRequest('A change in it could not be read. Read it again.');
  }
  const known = edits as FactEdit[];
  const summary = (typeof body.summary === 'string' ? body.summary : '')
    .trim()
    .slice(0, MAX_SUMMARY);
  const swaps = swapEdits(known).length;
  const given = Array.isArray(body.places) ? body.places : [];
  const places = [
    ...new Set(given.filter((value): value is string => typeof value === 'string' && value !== ''))
  ];
  if (places.length > MAX_PLACES) {
    throw new BadRequest(`Too many places are ticked. Up to ${MAX_PLACES} can change at once.`);
  }
  for (const id of places) {
    const at = placeEdit(id);
    if (id.length > MAX_PLACE_ID || at === null || at >= swaps) {
      throw new BadRequest("A place ticked is not one of this change's. Read it again.");
    }
  }
  return { summary, edits: known, places };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The change ids of an undo, each once. Throws in words. */
export function parseUndo(body: Record<string, unknown>): string[] {
  const given = Array.isArray(body.changeIds) ? body.changeIds : [];
  const ids = [...new Set(given)];
  if (!ids.length || !ids.every((id): id is string => typeof id === 'string' && UUID.test(id))) {
    throw new BadRequest('There is nothing to put back.');
  }
  return ids;
}

// --- the words ---------------------------------------------------------------------------------

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const places = (n: number) => count(n, 'place', 'places');
const sections = (n: number) => count(n, 'section', 'sections');
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** A section's slug said as words: "every-service-priced" is "Every service priced". */
function sectionWords(slug: string): string {
  const words = slug.replace(/-\d+$/, '').split('-').filter(Boolean).join(' ');
  return words ? words[0]!.toUpperCase() + words.slice(1) : slug;
}

/** What to tell the designer about a new member: the studio does not draw a page itself. */
export const drawAddWords = (name: string) =>
  `Draw ${possessive(name)} page in the studio after the change.`;

/** A refusal in words: the backend's, being offline, or what went wrong here. */
const refusalOf = (error: unknown): string => {
  if (error instanceof ApiError || error instanceof OfflineError) return describeError(error);
  return error instanceof Error ? error.message : String(error);
};

// --- reading -----------------------------------------------------------------------------------

/** A slug for an add's page, from its name, as the sheet names the page. */
function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'new-page'
  );
}

/**
 * An add in the studio: the facts get the member, and the designer draws its page here. The sheet
 * shows it as a usable add with no listings and no menu link, its page's line saying so, so its
 * primary action reads "Add <name>" when nothing else is ticked.
 */
function addView(index: number, edit: Extract<FactEdit, { kind: 'add' }>): FactAddView {
  return {
    edit: index,
    name: edit.name,
    collection: edit.collection,
    page: {
      name: edit.name,
      slug: slugOf(edit.name),
      job: `The facts get ${edit.name}.`
    },
    listings: [],
    nav: { added: false, why: drawAddWords(edit.name) },
    limits: [],
    refusal: null
  };
}

function emptySheet(refusal: string, reading?: FactReading): FactSheetData {
  return {
    reading: reading ?? { summary: '', edits: [], unsure: null },
    places: [],
    adds: [],
    refusal
  };
}

/**
 * `POST /api/facts/read {words}`: the words read into edits by the backend, then every place the
 * sets and renames reach in this repo's picked sections, found here. A site map label is the
 * backend's to rename and is left out. A stack the finder does not serve still reads, and says so.
 */
export async function readFactSheet(
  source: FactsSource,
  body: Record<string, unknown>
): Promise<FactSheetData> {
  const typed = typeof body.words === 'string' ? body.words.trim() : '';
  if (!typed) throw new BadRequest('Write the change first.');
  const {
    texts: [words]
  } = redactLocalPaths([typed]);
  const { api, link, repoRoot, lib } = source;
  let reading: FactReading;
  try {
    reading = readingFrom(await api.readFacts(link.orgId, link.project, words.slice(0, MAX_WORDS)));
  } catch (error) {
    return emptySheet(refusalOf(error));
  }
  if (!reading.edits.length) {
    return emptySheet(reading.unsure ?? 'Nothing to change was read.', reading);
  }
  const stack = lib.stackWhy();
  if (stack) return emptySheet(stack, reading);

  const adds = addEdits(reading.edits).map(({ index, edit }) => addView(index, edit));
  const swaps = swapEdits(reading.edits);
  if (!swaps.length) return { reading, places: [], adds, refusal: null };
  let context: FactContextReply;
  try {
    context = await api.factContext(link.orgId, link.project);
  } catch (error) {
    return emptySheet(refusalOf(error), reading);
  }
  const found = await lib.findLocal(repoRoot, context, swaps);
  if (!found.ok) return emptySheet(found.why, reading);
  const names = new Map(found.pages.map(page => [page.slug, page.name]));
  const shown = found.places
    .filter(place => !place.nav && place.id.length <= MAX_PLACE_ID)
    .map((place): FactPlaceView => ({
      id: place.id,
      page: place.page,
      pageName: names.get(place.page) ?? place.page,
      section: place.section,
      before: place.before,
      after: place.after,
      sure: place.sure,
      why: place.why,
      kept: place.kept,
      nav: false
    }));
  return { reading, places: shown, adds, refusal: null };
}

// --- changing ----------------------------------------------------------------------------------

type SectionOutcome =
  | {
      state: 'swapped';
      page: string;
      component: string;
      previous: string;
      next: string;
      /** Places spliced, and those its files no longer said as found. */
      places: number;
      leftOver: number;
      queued: boolean;
    }
  | { state: 'failed'; page: string; component: string; previous: string; why: string };

/** The section's pick in the context, or the place's own iteration when the context lacks it. */
function pickOf(context: FactContextReply, page: string, component: string, fallback?: string) {
  const held = context.pages
    .find(item => item.slug === page)
    ?.sections.find(item => item.component === component)?.iteration;
  return held ?? fallback ?? null;
}

function pageName(context: FactContextReply, page: string): string {
  return context.pages.find(item => item.slug === page)?.name ?? page;
}

/**
 * One section: the backend numbers a copy of its pick, the approved places are spliced into it
 * here, and the copy is picked. A splice that fails archives the copy and keeps the pick.
 */
async function changeSection(
  source: FactsSource,
  list: LocalPlace[],
  pick: string,
  changeId: string,
  summary: string
): Promise<SectionOutcome> {
  const { api, link, repoRoot, lib } = source;
  const { page, section: component } = list[0]!;
  const failed = (why: string): SectionOutcome => ({
    state: 'failed',
    page,
    component,
    previous: pick,
    why
  });
  let next: string;
  try {
    ({ iteration: next } = await api.factCopy(link.orgId, link.project, page, component, {
      parent: pick,
      changeId,
      summary
    }));
  } catch (error) {
    return failed(refusalOf(error));
  }
  if (!ITERATION.test(next)) return failed('The copy could not be numbered.');
  let spliced: SpliceLocalResult;
  try {
    spliced = await lib.spliceLocal(repoRoot, page, component, pick, next, list);
  } catch (error) {
    spliced = { ok: false, why: refusalOf(error), leftOver: list.map(place => place.id) };
  }
  if (!spliced.ok) {
    await source.discard({ page, component, iteration: next }).catch(() => undefined);
    return failed(spliced.why);
  }
  const folder = iterationDir(page, component, next);
  await source
    .wrote(
      spliced.files.map(file => (file.startsWith(`${ROUGH_DIR}/`) ? file : `${folder}/${file}`))
    )
    .catch(() => undefined);
  let queued = false;
  try {
    queued = (await source.select({ page, component, iteration: next })).status === 'queued';
  } catch (error) {
    return failed(`${next} was written but could not be picked: ${refusalOf(error)}`);
  }
  const changed = list.filter(place => !spliced.leftOver.includes(place.id)).length;
  return {
    state: 'swapped',
    page,
    component,
    previous: pick,
    next,
    places: changed,
    leftOver: list.length - changed,
    queued
  };
}

function changedWords(
  context: FactContextReply | null,
  outcomes: SectionOutcome[],
  missing: number,
  adds: string[]
): string {
  const parts: string[] = [];
  const swapped = outcomes.filter(item => item.state === 'swapped');
  const changed = swapped.reduce((total, item) => total + item.places, 0);
  if (changed > 0 || (missing > 0 && swapped.length === outcomes.length)) {
    parts.push(`Changed ${places(changed)}.`);
  }
  if (missing > 0) {
    parts.push(`${places(missing)} had moved on and ${missing === 1 ? 'was' : 'were'} left alone.`);
  }
  for (const item of outcomes) {
    if (item.state !== 'failed') continue;
    const where = `${sectionWords(item.component)} on ${context ? pageName(context, item.page) : item.page}`;
    parts.push(
      `${where} did not take the change and keeps ${item.previous}: ${item.why.replace(/\.$/, '')}.`
    );
  }
  const leftOver = swapped.reduce((total, item) => total + item.leftOver, 0);
  if (leftOver > 0) {
    parts.push(
      `${places(leftOver)} could not be changed in ${leftOver === 1 ? 'its' : 'their'} section's words and ${leftOver === 1 ? 'was' : 'were'} left alone.`
    );
  }
  const queued = swapped.filter(item => item.queued).length;
  if (queued) {
    parts.push(`${sections(queued)} will be picked once the studio is back online.`);
  }
  for (const name of adds) parts.push(drawAddWords(name));
  return parts.length ? parts.join(' ') : 'Changed the facts.';
}

/**
 * `POST /api/facts/change {summary, edits, places}`: the facts first, through the backend, then
 * each section with ticked places copied, spliced here and picked, and the change logged for Undo.
 */
export async function changeFacts(
  source: FactsSource,
  body: Record<string, unknown>
): Promise<FactChangeDone> {
  const { summary, edits, places: ticked } = parseChange(body);
  const { api, link, repoRoot, lib } = source;
  const stopped = (message: string, changeIds: string[] = []): FactChangeDone => ({
    ok: false,
    message,
    summary,
    changeIds
  });
  // The places are found before anything changes, as the sheet found them: the ids it showed are
  // the index's before the facts move, and a repo that cannot be read changes nothing.
  let context: FactContextReply | null = null;
  let groups: LocalPlace[][] = [];
  let missing = 0;
  if (ticked.length) {
    const stack = lib.stackWhy();
    if (stack) return stopped(stack);
    try {
      context = await api.factContext(link.orgId, link.project);
    } catch (error) {
      return stopped(refusalOf(error));
    }
    const found = await lib.findLocal(repoRoot, context, swapEdits(edits));
    if (!found.ok) return stopped(found.why);
    const wanted = new Set(ticked);
    const chosen = found.places.filter(place => wanted.has(place.id) && !place.nav);
    missing = ticked.filter(id => !found.places.some(place => place.id === id)).length;
    const bySection = new Map<string, LocalPlace[]>();
    for (const place of chosen) {
      const key = `${place.page}\0${place.section}`;
      bySection.set(key, [...(bySection.get(key) ?? []), place]);
    }
    groups = [...bySection.values()];
  }

  try {
    await api.applyFacts(link.orgId, link.project, edits, summary);
  } catch (error) {
    return stopped(refusalOf(error));
  }

  const changeId = (source.newId ?? randomUUID)();
  const adds = addEdits(edits).map(({ edit }) => edit.name);
  const outcomes: SectionOutcome[] = [];
  for (const list of groups) {
    const { page, section, iteration } = list[0]!;
    const pick = context ? pickOf(context, page, section, iteration) : null;
    if (!pick || !SLUG.test(page) || !SLUG.test(section) || !ITERATION.test(pick)) {
      outcomes.push({
        state: 'failed',
        page,
        component: section,
        previous: pick ?? 'its iteration',
        why: 'It has no pick to change'
      });
      continue;
    }
    outcomes.push(await changeSection(source, list, pick, changeId, summary));
  }

  const swapped = outcomes.filter(
    (item): item is Extract<SectionOutcome, { state: 'swapped' }> => item.state === 'swapped'
  );
  const at = (source.now ?? (() => new Date()))().toISOString();
  await updateLog(repoRoot, log => ({
    log: [
      ...log,
      {
        id: changeId,
        summary,
        at,
        edits,
        factsApplied: true,
        sections: swapped.map(({ page, component, previous, next }) => ({
          page,
          component,
          previous,
          next
        }))
      }
    ],
    value: null
  }));
  return {
    ok: true,
    message: changedWords(context, outcomes, missing, adds),
    summary,
    changeIds: [changeId]
  };
}

// --- undo --------------------------------------------------------------------------------------

/** An edit the other way round; an add has none. */
function reversed(edit: FactEdit): FactEdit | null {
  if (edit.kind === 'set') return { ...edit, old: edit.new, new: edit.old };
  if (edit.kind === 'rename') return { kind: 'rename', old: edit.new, new: edit.old };
  return null;
}

/**
 * `POST /api/facts/undo {changeIds}`, newest first: each section's earlier pick picked again where
 * the change's copy is still the pick, the edits applied the other way round, and the change marked
 * undone. A new member stays in the facts; that is said.
 */
export async function undoFacts(
  source: FactsSource,
  body: Record<string, unknown>
): Promise<FactChangeDone> {
  const ids = parseUndo(body);
  const { api, link, repoRoot } = source;
  const log = await readLog(repoRoot);
  const chosen = log.filter(change => ids.includes(change.id) && !change.undoneAt).reverse();
  const summary = chosen[0]?.summary ?? '';
  if (!chosen.length) {
    return { ok: false, message: 'There is nothing to put back.', summary, changeIds: [] };
  }
  let putBack = 0;
  const missed: string[] = [];
  const kept: string[] = [];
  const undone: string[] = [];
  let stoppedWhy: string | null = null;
  for (const change of chosen) {
    let context: FactContextReply;
    try {
      context = await api.factContext(link.orgId, link.project);
    } catch (error) {
      stoppedWhy = refusalOf(error);
      break;
    }
    for (const section of change.sections) {
      const where = `${sectionWords(section.component)} on ${pageName(context, section.page)}`;
      if (pickOf(context, section.page, section.component) !== section.next) {
        missed.push(`${where} was picked again since`);
        continue;
      }
      try {
        await source.select({
          page: section.page,
          component: section.component,
          iteration: section.previous
        });
        putBack += 1;
      } catch (error) {
        missed.push(`${where}: ${refusalOf(error).replace(/\.$/, '')}`);
      }
    }
    const back = change.edits.map(reversed).filter((edit): edit is FactEdit => edit !== null);
    for (const edit of change.edits) {
      if (edit.kind === 'add')
        kept.push(`${edit.name} stays in the facts: a new member is not undone.`);
    }
    if (back.length) {
      try {
        await api.applyFacts(
          link.orgId,
          link.project,
          back,
          `Undo: ${change.summary}`.slice(0, MAX_SUMMARY)
        );
      } catch (error) {
        stoppedWhy = `The facts were not put back: ${refusalOf(error)}`;
        break;
      }
    }
    undone.push(change.id);
  }
  if (undone.length) {
    const at = (source.now ?? (() => new Date()))().toISOString();
    await updateLog(repoRoot, current => ({
      log: current.map(change =>
        undone.includes(change.id) ? { ...change, undoneAt: at } : change
      ),
      value: null
    }));
  }
  const anySections = chosen.some(change => change.sections.length > 0);
  const parts = [
    !anySections
      ? 'The facts are put back.'
      : putBack > 0 || !missed.length
        ? `Put back ${sections(putBack)}.`
        : 'No section could be put back.'
  ];
  if (missed.length) {
    const shown = missed.slice(0, 3).join('; ');
    parts.push(
      `Not put back: ${shown}${missed.length > 3 ? `; and ${missed.length - 3} more` : ''}.`
    );
  }
  parts.push(...kept);
  if (stoppedWhy) {
    parts.push(stoppedWhy);
    const left = chosen.filter(change => !undone.includes(change.id)).map(change => change.id);
    return { ok: false, message: parts.join(' '), summary, changeIds: left.reverse() };
  }
  return { ok: true, message: parts.join(' '), summary, changeIds: [] };
}
