// How the studio's standalone server shows each kind of iteration it knows (ROUGHBOOK-FRAMEWORKS-
// PLAN.md, F5): an HTML entry served as it is, or a React one bundled with esbuild. Chosen by the
// entry file, so the core names neither.
import type { StandaloneRenderer } from '../../standalone/types.js';
import { html } from './html.js';
import { react } from './react.js';

const BY_ENTRY: [RegExp, StandaloneRenderer][] = [
  [/\.html?$/i, html],
  [/\.(?:tsx|jsx|ts|js|mjs)$/i, react]
];

/** What standalone mode can show, for a refusal. */
export const STANDALONE_ENTRIES =
  'an HTML entry (index.html) as it is, or a React one (index.tsx, index.jsx) bundled with esbuild';

/** The renderer for an iteration with this entry file, or null when standalone mode has none. */
export function standaloneRenderer(entry: string): StandaloneRenderer | null {
  return BY_ENTRY.find(([pattern]) => pattern.test(entry))?.[1] ?? null;
}
