// Copied from roughbook-backend by scripts/sync-rules.mjs; do not edit (src/utils/rules/techniques/types.ts).
// Checked by the backend under its own compiler options, so not by the studio here:
// @ts-nocheck
// The technique library's shape (ROUGHBOOK-STUDIO-POWER-PLAN.md, SP4). An entry is a tested
// recipe a sketch starts from and adapts to its look: a preset, never a limit.

/** The fourteen styles of reports/Expressive web audit.html, Part 2. */
export const AUDIT_STYLES = [
  'glass',
  'claymorphism',
  'neo-skeuomorphism',
  'neubrutalism',
  'bento',
  '3d-webgl',
  'cinematic-scroll',
  'kinetic-type',
  'micro-interactions',
  'grain-mesh',
  'editorial',
  'ai-media',
  'generative-ui',
  'dark-spatial'
] as const;

export type AuditStyle = (typeof AUDIT_STYLES)[number];

/**
 * The measured checks SP7 runs when a technique is used (the plan's list, plus the floors that
 * translucency and focus bring). Data only here: SP7 implements them.
 */
export const TECHNIQUE_CHECKS = {
  'contrast-behind': 'Text a person must read meets contrast against the pixels really behind it.',
  'dropped-frames': 'Frames dropped while scrolling and animating on a throttled phone profile.',
  'bytes-before-interaction': 'Bytes transferred at 390 px before the first interaction.',
  'overflow-390': 'Nothing scrolls sideways at 390 px.',
  'hidden-at-rest': 'Nothing a person must read is hidden before motion or scroll reveals it.',
  'motion-under-reduced': 'No motion runs under prefers-reduced-motion: reduce.',
  'opaque-fallback':
    'Under prefers-reduced-transparency or prefers-contrast: more, the surface is opaque.',
  'focus-visible': 'Every control shows a visible focus ring from the keyboard.',
  'pause-control': 'Motion that runs longer than five seconds can be paused.'
} as const;

export type TechniqueCheckId = keyof typeof TECHNIQUE_CHECKS;

/** One check this technique asks for, with what it means for this technique in particular. */
export type TechniqueCheck = { id: TechniqueCheckId; what: string };

/** A file of working code, written for a Roughbook sketch: React and TSX, or CSS. */
export type TechniqueFile = { path: string; content: string };

export type Technique = {
  id: string;
  name: string;
  /** The audit styles it serves. */
  styles: AuditStyle[];
  /** One line, for the list. */
  summary: string;
  /** Words a need is matched against, beside the name, styles and summary. */
  keywords: string[];
  /** What it is for, and how to adapt it to the look. */
  use: string;
  /**
   * Working code. The first file is a .tsx whose default export renders the technique on its
   * own, so it builds through the real sketch bundler.
   */
  code: TechniqueFile[];
  needs: {
    /** Packages beyond react and react-dom, by import specifier. */
    packages: string[];
    browsers: string;
    assets: string;
  };
  cost: { bytes: string; phone: string };
  floors: { reducedMotion: string; phone: string; fallback: string };
  checks: TechniqueCheck[];
};
