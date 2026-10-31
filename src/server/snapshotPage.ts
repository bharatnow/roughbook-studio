// A page on the canvas for a stack whose iterations are rendered images, not web pages:
// nothing of theirs can run in a browser, so its sections are their snapshots, one under the next, at
// the snapshot nearest the device the canvas shows. It answers the canvas as a running page does, so
// the device bar, section tools and Inspect work the same; only using the page has nothing to press.
import { COMPOSE_PARAM, MARKER_ELEMENT, SECTION_ATTRIBUTE } from '../recipes/context.js';
import { LIVE_SCRIPT } from '../recipes/live.js';
import { ITERATION, SLUG } from '../repo/iterations.js';

export type SnapshotSection = { component: string; iteration: string };
/** One of the shots an iteration is rendered at. */
export type SnapshotShot = { name: string; width: number };

/** `hero:iteration-01,footer:iteration-02`, or null when any of it is not a section. */
export function readSnapshotSections(value: string): SnapshotSection[] | null {
  const sections = value
    .split(',')
    .filter(Boolean)
    .map(item => {
      const [component = '', iteration = '', ...rest] = item.split(':');
      return { component, iteration, rest };
    });
  const good = sections.every(
    item => !item.rest.length && SLUG.test(item.component) && ITERATION.test(item.iteration)
  );
  return good && sections.length
    ? sections.map(({ component, iteration }) => ({ component, iteration }))
    : null;
}

/** The address of a section's snapshot, on the shot the script chooses for the frame's width. */
function shotAddress(page: string, section: SnapshotSection, key: string): string {
  const path = `/api/iterations/${page}/${section.component}/${section.iteration}/screenshots/`;
  return `${path}{shot}?key=${encodeURIComponent(key)}`;
}

/** The page, to be served with `nonce` in its policy. Every value in it has been checked or escaped. */
export function snapshotPage(input: {
  page: string;
  sections: SnapshotSection[];
  shots: SnapshotShot[];
  /** The key an image's address carries. */
  imageKey: string;
  nonce: string;
}): string {
  const { page, sections, shots, imageKey, nonce } = input;
  const body = sections
    .map(section => {
      const address = shotAddress(page, section, imageKey).replace(/&/g, '&amp;');
      return `<${MARKER_ELEMENT} ${SECTION_ATTRIBUTE}="${page}/${section.component}" style="display:contents"><img data-shot="${address}" alt="" style="display:block;width:100%;height:auto;margin:0 auto"></${MARKER_ELEMENT}>`;
    })
    .join('');
  const choose = `(function () {
  var shots = ${JSON.stringify(shots)};
  var id = ${JSON.stringify(`${page}/composition`)};
  function nearest() {
    return shots.slice().sort(function (a, b) {
      return Math.abs(a.width - innerWidth) - Math.abs(b.width - innerWidth);
    })[0];
  }
  var shown = null;
  function draw() {
    var shot = nearest();
    if (!shot || shot === shown) return;
    shown = shot;
    document.querySelectorAll('img[data-shot]').forEach(function (image) {
      image.src = image.getAttribute('data-shot').replace('{shot}', shot.name);
      image.style.maxWidth = shot.width + 'px';
    });
  }
  draw();
  addEventListener('resize', draw);
  parent.postMessage({ roughbook: 'ready', id: id }, '*');
})();`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="${COMPOSE_PARAM}" content="snapshots"><style>html,body{margin:0}</style></head><body><div data-roughbook-variant>${body}</div><script nonce="${nonce}">${choose}</script><script nonce="${nonce}">${LIVE_SCRIPT}</script></body></html>`;
}

/** What the page may load. */
export function snapshotPolicy(nonce: string): string {
  return `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'self'`;
}
