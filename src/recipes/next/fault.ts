// The Turbopack cache fault (B7b of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 67 and 68). `next dev`
// restarted onto its old development cache after files changed while it was down can answer
// "Lazily compiled dynamic import … was not activated" for a module the earlier run never compiled:
// an iteration in the switch's registry or the preview route's. The switch's block turns that cache
// off; these words are the safety net for a repo not yet upgraded, in the frame's notice and in
// doctor's detail.

/** Turbopack's error, as its two fixed parts. */
const PARTS = ['Lazily compiled dynamic import', 'was not activated'] as const;

/** The error's name, for a line that says what a page answered. */
export const LAZY_IMPORT_ERROR = 'Lazily compiled dynamic import … was not activated';

/** What it is, and what to do. */
export const LAZY_IMPORT_FAULT = {
  what: `"${LAZY_IMPORT_ERROR}" is Turbopack losing a module it compiles only when a page asks for it, most often after the app's dev server restarted onto its old development cache with files changed while it was down.`,
  fix: "Restart the app's dev server, then ask again. If the repo's switch is behind, roughbook setup --upgrade turns that cache off so it does not happen again."
};

/** The frame's notice: what it is and what to do, in one. */
export const LAZY_IMPORT_NOTICE = `${LAZY_IMPORT_FAULT.what} ${LAZY_IMPORT_FAULT.fix}`;

/** Whether a page's answer, or a log, holds Turbopack's error. */
export function isLazyImportFault(text: string): boolean {
  return PARTS.every(part => text.includes(part));
}
