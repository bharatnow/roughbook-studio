// The speed budgets (ROUGHBOOK-FRAMEWORKS-PLAN.md, "Speed"), as `doctor --speed` and the
// conformance suite measure them on a repo: a finished run to its preview visible, the cold start
// from the start command to the first preview, and the screenshots of a finished run, taken once
// and again only for files that changed. The numbers were set from the baseline F4 measured on
// the conformance fixture and the fresh PHP app; the canvas's own budget (100 cards without
// dropped frames) is the UI package's speed test, and the limit on live frames is the frame's.

export const BUDGETS = {
  /** A finished run to its preview visible, live mode, app already running. */
  previewVisibleMs: 3000,
  /** The same in snapshot mode: a changed iteration to its images, the tool already warm. */
  snapshotMs: 15_000,
  /** `roughbook start` to the first preview, the app started by the studio. */
  coldStartMs: 60_000,
  /** Every viewport in every variant of one iteration, through the kept browser. */
  screenshotsMs: 15_000
};

export type SpeedMeasures = {
  /** Snapshot mode: the preview is the images, so its budget is snapshot mode's. */
  snapshot?: boolean;
  previewVisibleMs: number | null;
  /** Null when the app was already running, so there was no cold start to measure. */
  coldStartMs: number | null;
  /** Why there is no cold start, when it is not that the app was already running. */
  noColdStart?: string;
  screenshotsMs: number | null;
  /** Why the screenshots were not timed apart, when it is not that no browser was found. */
  noScreenshots?: string;
  /** How many screenshots the first pass took, and how many the second took with nothing changed. */
  shots: number;
  again: number;
  viewports: number;
  variants: number;
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const budget = (ms: number) => `budget ${Math.round(ms / 1000)} s`;

/** The measures against the budgets: a sentence for each, and what is over. */
export function judgeSpeed(
  measures: SpeedMeasures,
  budgets: typeof BUDGETS = BUDGETS
): { pass: boolean; detail: string; fix: string | null } {
  const over: string[] = [];
  const parts: string[] = [];
  const visibleBudget = measures.snapshot ? budgets.snapshotMs : budgets.previewVisibleMs;
  const visible = measures.snapshot ? 'images rendered' : 'preview visible';
  if (measures.previewVisibleMs === null) {
    parts.push(
      measures.snapshot
        ? 'the images did not come out in time'
        : 'the preview did not become visible in time'
    );
    over.push(measures.snapshot ? 'the images never came out' : 'the preview never became visible');
  } else {
    parts.push(`${visible} in ${seconds(measures.previewVisibleMs)} (${budget(visibleBudget)})`);
    if (measures.previewVisibleMs > visibleBudget) {
      over.push(`${visible}: ${seconds(measures.previewVisibleMs)}`);
    }
  }
  if (measures.coldStartMs === null) {
    parts.push(`cold start not measured: ${measures.noColdStart ?? 'the app was already running'}`);
  } else {
    parts.push(`cold start in ${seconds(measures.coldStartMs)} (${budget(budgets.coldStartMs)})`);
    if (measures.coldStartMs > budgets.coldStartMs) {
      over.push(`cold start: ${seconds(measures.coldStartMs)}`);
    }
  }
  if (measures.screenshotsMs === null) {
    parts.push(`screenshots not measured: ${measures.noScreenshots ?? 'no browser was found'}`);
    if (measures.snapshot && measures.again !== 0) {
      over.push(
        `${measures.again} image${measures.again === 1 ? '' : 's'} rendered again with nothing changed`
      );
    }
  } else {
    parts.push(
      `screenshots at ${measures.viewports} viewport${measures.viewports === 1 ? '' : 's'} × ${measures.variants} variant${measures.variants === 1 ? '' : 's'} in ${seconds(measures.screenshotsMs)} (${budget(budgets.screenshotsMs)}), taken again: ${measures.again === 0 ? 'none' : measures.again}`
    );
    if (measures.screenshotsMs > budgets.screenshotsMs) {
      over.push(`screenshots: ${seconds(measures.screenshotsMs)}`);
    }
    if (measures.again !== 0) {
      over.push(
        `${measures.again} screenshot${measures.again === 1 ? '' : 's'} taken again with nothing changed`
      );
    }
  }
  const detail = `${parts.map((part, index) => (index ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('; ')}.`;
  if (!over.length) return { pass: true, detail, fix: null };
  return {
    pass: false,
    detail,
    fix: measures.snapshot
      ? `Over budget: ${over.join('; ')}. A snapshot render is mostly its tool starting: keep its daemon or watch mode warm, give the test runner what it needs once per run rather than per key, and render only the keys asked; images rendered again means the iteration's files or the environment's viewports changed between the two renders.`
      : `Over budget: ${over.join('; ')}. A preview that compiles slowly on first request is warmed by the studio when a run finishes; a slow cold start is the app's own start-up, which the frame shows as progress; screenshots taken again means the iteration's files or the environment's viewports changed between the two passes.`
  };
}
