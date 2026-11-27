// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/rules/modelTells.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// The defaults today's models fall back on, which make a design read as generated
// (ROUGHBOOK-METHODS-PLAN.md, D3). Data, not method text: the list ages within a year, so review
// it at every model release. Since ROUGHBOOK-STUDIO-POWER-PLAN.md decision 1 (which revisits the
// Apple plan's decision 22) each tell is a default: on when the maker says nothing, lifted when the
// maker's own words ask for it (rules/houseRules.ts decides which, by code). No studio switch
// lifts one.

export type ModelTell = {
  id: string;
  text: string;
  /** When Roughbook started flagging it. */
  since: string;
};

export const MODEL_TELLS: ModelTell[] = [
  { id: 'default-sans', text: 'Inter or Space Grotesk chosen by default', since: '2026-10-13' },
  { id: 'purple-gradient', text: 'Purple-to-blue gradients', since: '2026-10-13' },
  {
    id: 'cream-serif-terracotta',
    text: 'A cream background with a serif display face and a terracotta accent',
    since: '2026-10-13'
  },
  {
    id: 'black-acid-green',
    text: 'Near-black with a single acid-green accent',
    since: '2026-10-13'
  },
  {
    id: 'identical-cards',
    text: 'Rows of identical rounded cards with one soft shadow',
    since: '2026-10-13'
  },
  {
    id: 'eyebrow-everywhere',
    text: 'A small eyebrow label above every heading',
    since: '2026-10-13'
  },
  { id: 'decorative-numbering', text: 'Decorative 01, 02, 03 numbering', since: '2026-10-13' },
  { id: 'middle-dot-meta', text: 'Meta strings joined with middle dots', since: '2026-10-13' },
  { id: 'arrow-links', text: 'An arrow added to every link', since: '2026-10-13' },
  {
    id: 'fake-screenshot',
    text: 'Product screenshots faked from styled divs',
    since: '2026-10-13'
  },
  { id: 'gradient-text', text: 'Gradient-filled text', since: '2026-10-13' },
  {
    id: 'ambient-backgrounds',
    text: 'Grid backgrounds, radial halos, glow blobs and decorative glass',
    since: '2026-10-13'
  },
  { id: 'em-dashes', text: 'Em dashes in copy you write', since: '2026-10-13' }
];

/**
 * The tells every run is held to: all of them. An older caller may still pass a taste's
 * `tellsOff`; it is ignored (decision 22).
 */
export function activeTells(_tellsOff?: unknown): ModelTell[] {
  return [...MODEL_TELLS];
}

/**
 * The tells a run is held to once the maker's words are read (SP1): every tell but those lifted.
 * `lifted` holds house-rule ids (houseRules.ts tellId); with none, every tell.
 */
export function heldTells(lifted: readonly string[] = []): ModelTell[] {
  return MODEL_TELLS.filter(tell => !lifted.includes(`tell:${tell.id}`));
}
