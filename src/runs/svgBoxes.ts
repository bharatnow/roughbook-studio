// The inline SVGs a render measured (ROUGHBOOK-MEDIA-PLAN.md, V0): the render worker's MEASURE
// script reports one box per inline `<svg>` at the width it rendered, in document order, and the
// media scan (`mediaScan.ts`) reads them beside the sketch's files to tell an icon from a drawing,
// and a drawing (Illustration) from an SVG diagram (decision 7).

/** One inline `<svg>` as rendered at one width. */
export type SvgBox = {
  /** Its place among the page's inline SVGs, in document order, from 0. */
  index: number;
  /** Its rendered box, in CSS pixels. */
  width: number;
  height: number;
  /** Its `viewBox` attribute, or null. */
  viewBox: string | null;
  /** How many `<text>` elements it holds with words in them. */
  texts: number;
  /** How many drawn shapes it holds (`path`, `circle`, `ellipse`, `rect`, `polygon`). */
  shapes: number;
  /** How many lines it holds (`line` and `polyline`), the connectors, axes and routes of a diagram. */
  lines: number;
  /** Whether it sits inside a control (a button, link, input or label): an icon, by its place. */
  inControl: boolean;
  /** Whether it is hidden from assistive technology (`aria-hidden="true"` on it or an ancestor). */
  hidden: boolean;
};

/** A look's or section's inline SVGs at both widths, as kept with its critique. */
export type SvgBoxes = { wide?: SvgBox[]; narrow?: SvgBox[] };
