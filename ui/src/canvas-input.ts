// The studio's canvas (ROUGHBOOK-QUIET-UI-PLAN.md, U5 step 2): the project read and the runs in this
// repo as @roughbook/ui's CanvasInput. Cards are the iterations in rough/, with this machine's own
// screenshots as their pictures (decision 11 keeps those here), the web sketches not pulled yet,
// and the runs an agent is making now. What a card can do is in canvas-actions.ts.
import { iterationGlyph, type CanvasCardInput, type CanvasInput } from '@roughbook/ui/canvas';
import { decisionOf, isDecidedAgainst } from '@roughbook/ui/iteration-status';
import type { RatingSummary } from '@roughbook/ui';
import { iterationPath } from './api.ts';
import type { Iteration, ProjectView, RunView } from './types.ts';

/** What the toolbar and the palette need to know about a card, by its key. */
export type StudioCardFacts = {
  /** In this repo; a web sketch to pull; or a run whose iteration the project read has not caught up with. */
  kind: 'local' | 'sketch' | 'run';
  /** The run an agent is making it with, while it is open. */
  run: RunView | null;
  /** Its files exist. */
  generated: boolean;
  /** A web sketch with files and no run making it: it can be pulled. */
  pullable: boolean;
};

export type StudioCanvas = {
  input: CanvasInput;
  /** By card key: `iteration:<page>/<component>/<iteration>`. */
  cards: Record<string, StudioCardFacts>;
  /** Web sketches already pulled into this repo, by `<page>/<component>`, which can be pulled again. */
  pulled: Record<string, { sketch: string; as: string }[]>;
  /** An agent is at work, so the canvas reads the runs often. */
  making: boolean;
};

/**
 * A web sketch's picture: a cloud, since its code is on the server and the studio has no still of
 * it (web thumbnails stay on the web). 8:5, as the card's picture is.
 */
export const SKETCH_PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#eceff3"/><path transform="translate(364 214) scale(3)" d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" fill="none" stroke="#5b6274" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)}`;

/** A finished web sketch's mode, for a project read from a backend that does not say its origin. */
const SKETCH_MODES = new Set(['sketch']);

/**
 * Whether an iteration is a web sketch: its origin, which the backend sets on every iteration it
 * stores. Without one (an older backend), a finished sketch's mode on an iteration not in this repo.
 */
export function madeOnWeb(iteration: Pick<Iteration, 'origin' | 'generation'>, here: boolean) {
  if (iteration.origin) return iteration.origin === 'sketch';
  return !here && SKETCH_MODES.has(iteration.generation.mode);
}

/** The iteration's number, from its id. */
function numberOf(id: string): number {
  return Number(/(\d+)$/.exec(id)?.[1] ?? 0);
}

/**
 * The canvas for this repo. `runs` are the local server's, newest first; `local` says which
 * iterations are in rough/ and which have screenshots. `shotKey` is the server's key for a card's
 * picture, which cannot send the token; `ratings`, by card key, order the rated sort where read.
 */
export function studioCanvasInput(
  project: ProjectView['tree'],
  runs: RunView[],
  local: ProjectView['local'],
  { shotKey, ratings = {} }: { shotKey?: string; ratings?: Record<string, RatingSummary> } = {}
): StudioCanvas {
  const here = new Set(local.iterations);
  const cards: Record<string, StudioCardFacts> = {};
  const pulled: StudioCanvas['pulled'] = {};
  let making = false;

  const frame = (
    page: string,
    component: ProjectView['tree']['pages'][number]['components'][number]
  ) => {
    const where = `${page}/${component.slug}`;
    const isHere = (id: string) => here.has(`${where}/${id}`);
    // Each iteration's newest run.
    const latest = new Map<string, RunView>();
    for (const run of runs) {
      if (run.page === page && run.component === component.slug && !latest.has(run.iteration)) {
        latest.set(run.iteration, run);
      }
    }
    const sketches = new Set(
      component.iterations.filter(item => madeOnWeb(item, isHere(item.id))).map(item => item.id)
    );
    // A local iteration whose parent is a web sketch was pulled from it.
    const pulledFrom = component.iterations.flatMap(item =>
      isHere(item.id) && item.parent && sketches.has(item.parent)
        ? [{ sketch: item.parent, as: item.id }]
        : []
    );
    if (pulledFrom.length) pulled[where] = pulledFrom;
    const pulledSketches = new Set(pulledFrom.map(item => item.sketch));
    const promoted = new Set(component.promotions.map(item => item.iteration));

    const out: CanvasCardInput[] = [];
    const recorded = new Set<string>();
    for (const iteration of component.iterations) {
      const web = sketches.has(iteration.id);
      // Another studio's iteration has its code in that designer's repo; a pulled sketch is here.
      if (web ? pulledSketches.has(iteration.id) : !isHere(iteration.id)) continue;
      recorded.add(iteration.id);
      const run = latest.get(iteration.id) ?? null;
      const open = run?.status === 'started' ? run : null;
      const pending = iteration.generation.mode === 'pending';
      const failed =
        pending &&
        run?.status === 'finished' &&
        (run.outcome === 'failed' || run.outcome === 'cancelled');
      making ||= open !== null;
      const status = iterationGlyph(
        { ...iteration, making: open !== null, failed, promoted: promoted.has(iteration.id) },
        component.selectedIteration
      );
      const key = `iteration:${where}/${iteration.id}`;
      cards[key] = {
        kind: web ? 'sketch' : 'local',
        run: open,
        generated: !pending,
        pullable: web && !pending
      };
      const shot = !web && local.screenshots[`${where}/${iteration.id}`]?.includes('desktop');
      out.push({
        id: iteration.id,
        name: iteration.name,
        status: web && status.glyph === 'none' ? { glyph: 'none', word: 'On the web' } : status,
        thumbnail: web
          ? SKETCH_PICTURE
          : shot
            ? `${iterationPath(page, component.slug, iteration.id)}/screenshots/desktop${shotKey ? `?key=${encodeURIComponent(shotKey)}` : ''}`
            : null,
        // A sketch has no stage here: it opens where it is on the canvas.
        href: web ? `/${where}/iterations#${iteration.id}` : `/${where}/${iteration.id}`,
        created: iteration.created ?? null,
        number: iteration.number,
        selected: iteration.number === component.selectedIteration,
        folded: isDecidedAgainst(iteration.status),
        beside: open ? (open.parent ?? iteration.parent) : null,
        from: iteration.parent,
        decision: decisionOf(iteration.status),
        generated: !pending,
        rating: ratings[key]?.average ?? null
      });
    }

    // A run started a moment ago, whose iteration the project read does not have yet.
    for (const run of latest.values()) {
      if (run.status !== 'started' || recorded.has(run.iteration)) continue;
      making = true;
      cards[`iteration:${where}/${run.iteration}`] = {
        kind: 'run',
        run,
        generated: false,
        pullable: false
      };
      out.push({
        id: run.iteration,
        name: run.iteration,
        status: { glyph: 'making', word: 'Making' },
        thumbnail: null,
        href: `/${where}/iterations#${run.iteration}`,
        created: run.startedAt,
        number: numberOf(run.iteration),
        selected: false,
        folded: false,
        beside: run.parent,
        from: run.parent,
        decision: 'draft',
        generated: false
      });
    }

    return { id: component.slug, name: component.name, href: `/${where}`, cards: out };
  };

  return {
    input: {
      designSystem: null,
      sections: project.pages.map(page => ({
        id: page.slug,
        name: page.name,
        href: `/${page.slug}`,
        frames: page.components.map(component => frame(page.slug, component)),
        compositionOrder: null,
        compositions: []
      }))
    },
    cards,
    pulled,
    making
  };
}
