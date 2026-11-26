// Copied from roughbook-backend by scripts/sync-facts.mjs; do not edit (src/utils/rules/factPlacement.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// The one test of where a fact is stated (ROUGHBOOK-FACTS-PLAN.md, F0): the figures and names a
// text carries, whether a line states a proof item or only points to it (rule 1, decision 2), the
// items a section owns in the plan, and the items a text states that it does not own. The truth
// check (siteScript.ts) and the page editor (pageChecks.ts) read figures and names from here. All
// pure. The web's src/lib/fact-placement.ts mirrors this with the same cases; a change to one
// belongs in both (web AGENTS.md rule 1).
import type { SitePlan } from '../vendor-shims.js';

// ---------------------------------------------------------------------------------------------
// Figures and names.
// ---------------------------------------------------------------------------------------------

export type Figure = { raw: string; currency: string; number: string; scale: string };

// A number with an optional currency before it and a percentage or k/m/bn after it. Thousands
// commas are dropped, so "1,204" and "1204" are the same figure.
const FIGURE =
  /([£$€])?\s?(\d+(?:[.,]\d+)*)(?:\s?(%|per\s?cent(?![\p{L}])|(?:k|m|bn)(?![\p{L}])))?/giu;

const normaliseNumber = (value: string): string => {
  const noCommas = value.replace(/,(?=\d{3}(?!\d))/g, '');
  // A comma left over ("1,5") reads as a decimal point.
  return noCommas.replace(/,/g, '.');
};

const normaliseScale = (value: string | undefined): string => {
  if (!value) return '';
  const lower = value.toLowerCase().replace(/\s+/g, '');
  return lower === 'percent' ? '%' : lower;
};

// Hex colours (#1f3a2b, #fff) are a look's values, not claims, so they are never figures.
const HEX_COLOUR = /#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi;

export function figuresIn(text: string): Figure[] {
  const found: Figure[] = [];
  for (const match of text.replace(HEX_COLOUR, ' ').matchAll(FIGURE)) {
    found.push({
      raw: match[0].trim(),
      currency: match[1] ?? '',
      number: normaliseNumber(match[2]),
      scale: normaliseScale(match[3])
    });
  }
  return found;
}

/** A figure is backed when one in the source has its number, and its currency and scale if it has them. */
export const figureBacked = (figure: Figure, backing: Figure[]) =>
  backing.some(
    other =>
      other.number === figure.number &&
      (!figure.currency || figure.currency === other.currency) &&
      (!figure.scale || figure.scale === other.scale)
  );

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec'
];
const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'mon',
  'tue',
  'tues',
  'wed',
  'thu',
  'thurs',
  'fri',
  'sat',
  'sun'
];
/** Words that are never names, and that the script rubric drops. */
export const COMMON_WORDS = new Set([
  'i',
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'nor',
  'so',
  'yet',
  'if',
  'then',
  'than',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'onto',
  'to',
  'with',
  'without',
  'within',
  'about',
  'over',
  'under',
  'after',
  'before',
  'since',
  'until',
  'up',
  'down',
  'out',
  'off',
  'per',
  'via',
  'we',
  'us',
  'our',
  'ours',
  'you',
  'your',
  'yours',
  'they',
  'them',
  'their',
  'it',
  'its',
  'he',
  'she',
  'his',
  'her',
  'my',
  'me',
  'this',
  'that',
  'these',
  'those',
  'there',
  'here',
  'what',
  'who',
  'whom',
  'how',
  'why',
  'when',
  'where',
  'which',
  'all',
  'every',
  'each',
  'any',
  'some',
  'most',
  'many',
  'more',
  'no',
  'not',
  'yes',
  'one',
  'only',
  'very',
  'just',
  'also',
  'new',
  'free',
  'best',
  'first',
  'last',
  'next',
  'same',
  'other',
  'own',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'can',
  'will',
  'may',
  'please',
  'book',
  'call',
  'get',
  'see',
  'find',
  'meet',
  'visit',
  'read',
  'learn',
  'start',
  'join',
  'contact',
  'home',
  'team',
  'today',
  'now',
  'mr',
  'mrs',
  'ms',
  'dr'
]);
const NAME_STOPLIST = new Set([...COMMON_WORDS, ...MONTHS, ...DAYS]);

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

/** Capitalised words that are not a sentence's first word, the common words, days or months. */
export function namesIn(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(WORD)) {
    const word = match[0].replace(/['’]s$/u, '').replace(/['’]$/u, '');
    if (!/^\p{Lu}/u.test(word)) continue;
    const before = text.slice(0, match.index).replace(/[\s"'“‘([«—–-]+$/u, '');
    if (before === '' || /[.!?:;]$/u.test(before)) continue;
    if (NAME_STOPLIST.has(word.toLowerCase())) continue;
    names.push(word);
  }
  return names;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const nameIn = (name: string, text: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u').test(
    text.toLowerCase()
  );

/** Words that carry nothing on their own, for comparing a line with a claim. */
const STOP = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'to',
  'for',
  'of',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'your',
  'our',
  'you',
  'we',
  'us',
  'my',
  'me',
  'it',
  'its',
  'is',
  'are',
  'be',
  'this',
  'that',
  'now',
  'here',
  'get',
  'all',
  'as',
  'up',
  'so',
  'do'
]);

/** Lowercase content words, in order. */
export function contentWordsOf(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? [])
    .map(word => word.replace(/['’]s$/u, ''))
    .filter(word => !STOP.has(word) && !/^\d+$/u.test(word));
}

// ---------------------------------------------------------------------------------------------
// Where a fact is stated (ROUGHBOOK-FACTS-PLAN.md, rule 1 and decision 2).
// ---------------------------------------------------------------------------------------------

/** One real proof item and a section that carries it, as `claimsLedger` gives it. */
export type FactEntry = { proof: string; claim: string; page: string; section: string };

/** A proof item a text states but its section does not own, with where the item lives. */
export type StrayFact = { proof: string; claim: string; owner: { page: string; section: string } };

export type StatesFactOptions = {
  /** Lowercase names several claims share (area names, the business): never a name on their own. */
  shared?: Set<string>;
};

/**
 * Words after a one-digit number that make it a claim's figure: "2 days", "5 stars", "7am". Bare
 * one-digit numbers elsewhere are steps and list counters.
 */
const UNITS = new Set([
  'min',
  'mins',
  'minute',
  'minutes',
  'hour',
  'hours',
  'hr',
  'hrs',
  'day',
  'days',
  'week',
  'weeks',
  'month',
  'months',
  'year',
  'years',
  'star',
  'stars',
  'am',
  'pm'
]);

/**
 * Words that say where a fact lives, never the fact: "on the home page", "see Fees", "below". They
 * never count as a claim's other words beside a name.
 */
const POINTER_WORDS = new Set([
  'page',
  'pages',
  'home',
  'homepage',
  'see',
  'below',
  'above',
  'find',
  'more',
  'read',
  'visit',
  'link',
  'section',
  'details',
  'there'
]);

/** The word straight after a figure as said in the text, lowercased: "days" in "2 days". */
function unitAfter(text: string, raw: string): string {
  const at = text.indexOf(raw);
  if (at < 0) return '';
  const after = text.slice(at + raw.length).match(/^\s?([\p{L}]+)/u);
  return after ? after[1].toLowerCase() : '';
}

const singular = (word: string) => word.replace(/s$/u, '');

/**
 * The claim's figures that can state it: two characters or more ("£55", "4.9", "180", "25"), or a
 * one-digit number with its unit ("2 days"), which the line must then say with the same unit.
 */
function claimFigures(claim: string): { figure: Figure; unit: string }[] {
  return figuresIn(claim).flatMap(figure => {
    const unit = unitAfter(claim, figure.raw);
    if (figure.raw.replace(/\s+/g, '').length >= 2) return [{ figure, unit: '' }];
    return UNITS.has(unit) ? [{ figure, unit }] : [];
  });
}

/**
 * The claim's words that belong to a name: its names, and the capitalised words next to one, so
 * "Mama" in "Mama Ama's" (a sentence's first word, which `namesIn` skips) is the name's too and
 * never the "other word" beside "Ama's".
 */
function nameWordsOf(claim: string, names: string[]): Set<string> {
  const words = new Set(names.map(name => name.toLowerCase()));
  const tokens = (claim.match(WORD) ?? []).map(token =>
    token.replace(/['’]s$/u, '').replace(/['’]$/u, '')
  );
  tokens.forEach((token, index) => {
    if (!/^\p{Lu}/u.test(token) || NAME_STOPLIST.has(token.toLowerCase())) return;
    const near = [tokens[index - 1], tokens[index + 1]];
    if (near.some(other => other !== undefined && words.has(other.toLowerCase())))
      words.add(token.toLowerCase());
  });
  return words;
}

/**
 * Rule 1: a line states a claim when it carries one of the claim's figures together with at least
 * one of the claim's content words (so a bare "From £55" is a pointer, as `claimTwice` reads it),
 * or one of the claim's names together with at least one of the claim's other content words: not
 * the names' own words, not a name the line itself carries, and not words that say where a thing
 * lives ("home", "page", "see"). A figure needs two characters ("£55", "25", "4.9") or a unit after
 * one digit ("2 days", "5 stars"), said with the same unit in the line. A name
 * alone, or a name with a place to find it, is a pointer. A common noun ("couriers") is not a
 * name: without a figure or a name it states nothing. Names in `shared` never count as names.
 */
export function statesFact(line: string, claim: string, options: StatesFactOptions = {}): boolean {
  const shared = options.shared ?? new Set<string>();
  const claimWords = new Set(contentWordsOf(claim));
  const lineWords = contentWordsOf(line);

  const lineFigures = figuresIn(line);
  const hasFigure = claimFigures(claim).some(({ figure, unit }) =>
    unit
      ? lineFigures.some(
          other =>
            other.number === figure.number &&
            singular(unitAfter(line, other.raw)) === singular(unit)
        )
      : figureBacked(figure, lineFigures)
  );
  if (hasFigure && lineWords.some(word => claimWords.has(word))) return true;

  const allNames = namesIn(claim);
  const names = allNames.filter(name => !shared.has(name.toLowerCase()));
  if (!names.some(name => nameIn(name, line))) return false;
  // The other word is the claim's and said plainly: a name of the line's own ("Northgate" on a map
  // of areas) is another label, not the claim's words.
  const nameWords = nameWordsOf(claim, allNames);
  const lineNames = new Set(namesIn(line).map(name => name.toLowerCase()));
  return lineWords.some(
    word =>
      claimWords.has(word) &&
      !nameWords.has(word) &&
      !lineNames.has(word) &&
      !shared.has(word) &&
      !POINTER_WORDS.has(word)
  );
}

/** Lowercase names that two or more of the claims carry: area names, a kitchen several claims name. */
export function sharedNames(claims: string[]): Set<string> {
  const seen = new Map<string, number>();
  for (const claim of new Set(claims)) {
    for (const name of new Set(namesIn(claim).map(item => item.toLowerCase())))
      seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, count]) => count >= 2).map(([name]) => name));
}

/** The proof ids a section claims in the plan, by its slug (or its id); none for an unknown one. */
export function ownedFacts(plan: SitePlan, pageSlug: string, sectionSlug: string): string[] {
  const page = plan.pages.find(item => item.slug === pageSlug);
  if (!page) return [];
  const section =
    page.sections.find(item => item.slug === sectionSlug) ??
    page.sections.find(item => item.id === sectionSlug);
  return section ? [...section.claims] : [];
}

/**
 * The proof items `text` states that the section does not own, in ledger order, each with its
 * owner: the section of `pageSlug` that carries it, else the first page that does. A string is
 * read line by line. Without `shared`, the names two or more of the ledger's claims share.
 */
export function strayFacts(
  text: string | string[],
  owned: string[],
  entries: FactEntry[],
  pageSlug: string,
  shared?: Set<string>
): StrayFact[] {
  const lines = (Array.isArray(text) ? text : text.split(/\r?\n/))
    .map(line => line.trim())
    .filter(Boolean);
  const names = shared ?? sharedNames(entries.map(entry => entry.claim));
  const own = new Set(owned);
  const byProof = new Map<string, FactEntry[]>();
  for (const entry of entries)
    byProof.set(entry.proof, [...(byProof.get(entry.proof) ?? []), entry]);
  const stray: StrayFact[] = [];
  for (const [proof, items] of byProof) {
    if (own.has(proof)) continue;
    const entry = items.find(item => item.page === pageSlug) ?? items[0];
    if (!lines.some(line => statesFact(line, entry.claim, { shared: names }))) continue;
    stray.push({ proof, claim: entry.claim, owner: { page: entry.page, section: entry.section } });
  }
  return stray;
}

/**
 * `text` without the sentences that state any of `claims` (rule 1, as `statesFact` reads it), for
 * words Roughbook guessed and nobody has read yet: a person's words are never cut. '' when every
 * sentence stated one.
 */
export function withoutClaims(text: string, claims: string[], shared?: Set<string>): string {
  if (claims.length === 0) return text;
  const names = shared ?? sharedNames(claims);
  // A sentence ends at a stop with a space after it, so "4.9" and "£4.50" stay whole.
  return text
    .split(/(?<=[.!?])\s+/u)
    .filter(sentence => !claims.some(claim => statesFact(sentence, claim, { shared: names })))
    .join(' ')
    .trim();
}
