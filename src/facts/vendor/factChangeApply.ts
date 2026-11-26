// Copied from roughbook-backend by scripts/sync-facts.mjs; do not edit (src/utils/rules/factChangeApply.ts).
// Only FactEdit, escape, normaliseFact, factPattern, countFact: the rest applies edits to the backend's own docs.
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
/**
 * One fact edit. `set`: `old` is an exact phrase from the material ("Friday 08:00 to 19:00") and
 * `new` is the same phrase with the new value; `subject` says what it is about ("Northside's Friday
 * hours"). `rename`: a name, everywhere it is said. `add`: a new member of a collection (a clinic, a
 * restaurant, a service), with its facts in one line.
 */
export type FactEdit =
  | { kind: 'set'; subject: string; old: string; new: string }
  | { kind: 'rename'; old: string; new: string }
  | { kind: 'add'; collection: string; name: string; facts: string };

// --- matching ------------------------------------------------------------------------------------

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case and whitespace normalised, as the reading compares phrases. */
export const normaliseFact = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A phrase as a pattern: case ignored, any run of spaces matching any other, and not inside a
 * longer word or number ("19:00" never matches "119:00").
 */
export function factPattern(phrase: string): RegExp | null {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const body = words.map(escape).join('\\s+');
  const start = /^[\p{L}\p{N}]/u.test(words[0]) ? '(?<![\\p{L}\\p{N}])' : '';
  const end = /[\p{L}\p{N}]$/u.test(words[words.length - 1]) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(`${start}${body}${end}`, 'giu');
}

/** How many times a phrase is said in a text. */
export function countFact(text: string, phrase: string): number {
  const pattern = factPattern(phrase);
  return pattern ? (text.match(pattern) ?? []).length : 0;
}
