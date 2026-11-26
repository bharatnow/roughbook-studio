// Copied from roughbook-backend by scripts/sync-facts.mjs; do not edit (src/utils/rules/factFind.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// Where a fact change lands (ROUGHBOOK-FACT-CHANGE-PLAN.md, U3, "Finding"): every place in U1's
// index that an edit reaches, with the line as it reads now and as it will read, and whether it is
// sure. Sure places are swapped on approval; unsure ones are shown apart and never swapped by
// default. Pure and deterministic: the same index and edits give the same places, in index order.
import type { FactEdit } from './factChangeApply.js';
import { countFact, factPattern, normaliseFact } from './factChangeApply.js';
import type { FactIndex, FactIndexInput, Place } from './factIndex.js';

export type FoundPlace = {
  /** `<place id>|<edit index>`: stable for the same index and edits. */
  id: string;
  /** The index place's own id. */
  placeId: string;
  page: string;
  section: string;
  iteration: string;
  /** '' for a nav or link label. */
  file: string;
  start: number;
  end: number;
  /** The place's text as a visitor reads it now. */
  before: string;
  /** The same text with the change. */
  after: string;
  /** Swapped on approval when true; shown apart and never swapped by default when false. */
  sure: boolean;
  /** Why, in words. */
  why: string;
  /** The section is kept (X8): changed only for the fact itself, and shown as kept. */
  kept: boolean;
  /** A site map label (nav or links), renamed through the site map, not a file. */
  nav?: boolean;
  /** Which of the edits this is, by index. */
  edit: number;
  /** What is replaced in the place: the whole phrase, or a set's changing part. */
  old: string;
  /** What replaces it. */
  new: string;
  /**
   * The whole fact the place belongs to, for a redraw's words: "Northside's Friday hours:
   * 'Friday 08:00 to 19:00' becomes 'Friday 08:00 to 18:00'", never a bare "19:00" to "18:00".
   */
  fact: { subject: string; old: string; new: string };
};

export type FindOptions = {
  /** Kept sections as `<page>/<section>`; `keptSections(input)` builds it from the index's input. */
  kept?: ReadonlySet<string>;
};

/** The kept sections of an index's input, as `<page>/<section>`. */
export function keptSections(input: Pick<FactIndexInput, 'pages'>): Set<string> {
  const kept = new Set<string>();
  for (const page of input.pages)
    for (const section of page.sections)
      if (section.kept) kept.add(`${page.slug}/${section.component}`);
  return kept;
}

// --- the changing part -----------------------------------------------------------------------------

/** Brackets, quotes and sentence marks, trimmed off a changing part's edges when both sides share them. */
const EDGE = /[()[\]"'“”‘’,.;:!?]/u;

/**
 * The part of a set that changes: the smallest run of words where `old` and `new` differ, edges
 * the two share trimmed ("Friday 08:00 to 19:00" to "Friday 08:00 to 18:00" changes "19:00";
 * "£1.49" to "£1.79" changes "£1.49", currency kept). Null when nothing of `old` is left, as when
 * words are only added.
 */
export function changingPart(old: string, next: string): { old: string; new: string } | null {
  const a = old.trim().split(/\s+/).filter(Boolean);
  const b = next.trim().split(/\s+/).filter(Boolean);
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  let head = 0;
  while (head < a.length && head < b.length && same(a[head], b[head])) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    same(a[a.length - 1 - tail], b[b.length - 1 - tail])
  )
    tail++;
  let from = a.slice(head, a.length - tail).join(' ');
  let to = b.slice(head, b.length - tail).join(' ');
  while (from.length > 1 && to.length > 1 && from[0] === to[0] && EDGE.test(from[0])) {
    from = from.slice(1);
    to = to.slice(1);
  }
  while (
    from.length > 1 &&
    to.length > 1 &&
    from[from.length - 1] === to[to.length - 1] &&
    EDGE.test(from[from.length - 1])
  ) {
    from = from.slice(0, -1);
    to = to.slice(0, -1);
  }
  if (!/[\p{L}\p{N}]/u.test(from)) return null;
  return { old: from, new: to };
}

// --- the subject, as factChange.ts reads it ---------------------------------------------------------

const STOPWORDS = new Set(
  'the a an and or of at in on to for from by with is are now its it this that our their new old'.split(
    ' '
  )
);

/** The subject's telling words: not stopwords, not in the phrase itself (factChange.ts's rule). */
function subjectWords(subject: string, old: string): string[] {
  const inOld = new Set(normaliseFact(old).split(/[^\p{L}\p{N}]+/u));
  return [
    ...new Set(
      normaliseFact(subject)
        .replace(/['’]s\b/g, '')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(word => word.length > 2 && !STOPWORDS.has(word) && !inOld.has(word))
    )
  ];
}

/** A text names the subject when it holds at least half of its telling words. */
const mentions = (text: string, words: string[]) => {
  const said = normaliseFact(text);
  return words.length > 0 && words.filter(word => said.includes(word)).length * 2 >= words.length;
};

/**
 * The new words in the case the old ones were found in: a name said in running text as "a walk-in
 * sports injury clinic" becomes "sports rehab clinic", not "Sports rehab clinic"; all capitals stay
 * capitals; a capital first letter stays one. Otherwise the new words as given.
 */
export function matchCase(found: string, next: string): string {
  if (!/\p{L}/u.test(found)) return next;
  if (found === found.toLowerCase()) return next.toLowerCase();
  if (found === found.toUpperCase() && /\p{L}{2}/u.test(found)) return next.toUpperCase();
  const first = found.match(/\p{L}/u)?.[0] ?? '';
  const nextFirst = next.match(/\p{L}/u)?.[0] ?? '';
  if (first === first.toUpperCase() && nextFirst === nextFirst.toLowerCase())
    return next.replace(nextFirst, nextFirst.toUpperCase());
  return next;
}

const replaceAll = (text: string, old: string, next: string) => {
  const pattern = factPattern(old);
  return pattern ? text.replace(pattern, found => matchCase(found, next)) : text;
};

/**
 * True when `old` is said only as the end of a range: "Monday to Friday 08:00 to 19:00" holds
 * "Friday 08:00 to 19:00", but changing Friday alone there means splitting the range, which no word
 * swap can do. A phrase starting with a figure is not a range's end in this sense.
 */
function endsARange(text: string, old: string): boolean {
  if (!/^[\p{L}]/u.test(old.trim())) return false;
  const pattern = factPattern(old);
  if (!pattern) return false;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const every = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  let any = false;
  while ((match = every.exec(text))) {
    any = true;
    const before = text.slice(0, match.index);
    if (!/(?:\bto|\bthrough|\buntil|\btill|[–—-])\s*$/iu.test(before)) return false;
    if (match[0].length === 0) every.lastIndex++;
  }
  return any;
}

/**
 * The telling words of `old` that stay the same: "Friday" in "Friday 08:00 to 19:00" when only
 * "19:00" changes. Letters only, no stopwords; figures stand in when there are no words.
 */
function anchorWords(old: string, part: { old: string }): string[] {
  const changing = new Set(normaliseFact(part.old).split(/\s+/));
  const tokens = normaliseFact(old)
    .split(/\s+/)
    .filter(token => token && !changing.has(token));
  const words = tokens.filter(token => /\p{L}/u.test(token) && !STOPWORDS.has(token));
  return words.length ? words : tokens.filter(token => /\d/.test(token));
}

// --- finding ----------------------------------------------------------------------------------------

/**
 * Every place the edits reach, one per place and edit, in the index's order:
 * - sure: the edit's whole `old` is in the place's text (case and spacing ignored, never inside a
 *   longer word or number), which for a rename is the name as a whole word, nav and links too;
 * - for a set, sure: the changing part is in a place whose own text, or any place in the same
 *   section, names the subject; unsure: the changing part alone, with nothing near naming it.
 * Adds reach no place: their pages are U4's.
 */
export function findPlaces(
  index: FactIndex,
  edits: FactEdit[],
  options: FindOptions = {}
): FoundPlace[] {
  const kept = options.kept ?? new Set<string>();
  const sectionKey = (place: Place) => `${place.page}/${place.section}`;
  const sections = new Map<string, Place[]>();
  for (const place of index.places)
    sections.set(sectionKey(place), [...(sections.get(sectionKey(place)) ?? []), place]);
  const allText = normaliseFact(index.places.map(place => place.text).join(' '));

  const found: FoundPlace[] = [];
  const add = (
    place: Place,
    edit: number,
    old: string,
    next: string,
    sure: boolean,
    why: string
  ) => {
    found.push({
      id: `${place.id}|${edit}`,
      placeId: place.id,
      page: place.page,
      section: place.section,
      iteration: place.iteration,
      file: place.file,
      start: place.start,
      end: place.end,
      before: place.text,
      after: replaceAll(place.text, old, next),
      sure,
      why,
      kept: kept.has(sectionKey(place)),
      ...(place.file === '' ? { nav: true } : {}),
      edit,
      old,
      new: next,
      fact: whole
    });
  };
  let whole: FoundPlace['fact'] = { subject: '', old: '', new: '' };

  edits.forEach((edit, editIndex) => {
    if (edit.kind === 'add') return;
    const old = edit.old.trim();
    const next = edit.new.trim();
    if (!old || normaliseFact(old) === normaliseFact(next)) return;
    whole = { subject: edit.kind === 'set' ? edit.subject.trim() : '', old, new: next };
    const part = edit.kind === 'set' ? changingPart(old, next) : null;
    const subject = edit.kind === 'set' ? edit.subject.trim() || 'the subject' : old;
    const usePart = part && normaliseFact(part.old) !== normaliseFact(old) ? part : null;
    // Only words the site says anywhere count, as in factChange.ts: "hours" names no line otherwise.
    const words =
      edit.kind === 'set'
        ? subjectWords(edit.subject, old).filter(word => allText.includes(word))
        : [];
    const namedSections = new Map<string, boolean>();
    const sectionNames = (place: Place) => {
      const key = sectionKey(place);
      if (!namedSections.has(key))
        namedSections.set(
          key,
          (sections.get(key) ?? []).some(other => mentions(other.text, words))
        );
      return namedSections.get(key)!;
    };

    const anchors = usePart ? anchorWords(old, usePart) : [];
    for (const place of index.places) {
      if (countFact(place.text, old) > 0) {
        if (edit.kind === 'set' && endsARange(place.text, old)) {
          add(
            place,
            editIndex,
            old,
            next,
            false,
            `Says "${old}" only as the end of a range; changing it splits the range, so it needs a redraw.`
          );
          continue;
        }
        add(
          place,
          editIndex,
          old,
          next,
          true,
          edit.kind === 'rename' ? `Says the name "${old}".` : `Says "${old}".`
        );
        continue;
      }
      if (!usePart || countFact(place.text, usePart.old) === 0) continue;
      const said = `Says "${usePart.old}"`;
      // The changing part alone is the value only where the line also says what stays the same:
      // "19:00" is Northside's Friday closing on a line that says Friday, and nowhere else.
      const text = normaliseFact(place.text);
      const anchored = anchors.length > 0 && anchors.every(word => text.includes(word));
      if (anchored && (mentions(place.text, words) || sectionNames(place)))
        add(
          place,
          editIndex,
          usePart.old,
          usePart.new,
          true,
          `${said} beside "${anchors.join(' ')}" where ${subject} is named.`
        );
      else
        add(
          place,
          editIndex,
          usePart.old,
          usePart.new,
          false,
          anchored
            ? `${said}; nothing near names ${subject}.`
            : `${said} without "${anchors.join(' ')}", so it may be another value.`
        );
    }
  });
  return found;
}
