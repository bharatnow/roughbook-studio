// Doctor's map checks (B1 of ROUGHBOOK-BROWNFIELD-PLAN.md), for a repo with rough/map.md: each
// page answers at its address; each section and shared part renders alone, through a pointer to its
// real file with its fixture, and says it is ready; and their screenshots come out clean. What the
// map says works and does not is a failure; what cannot be checked (a page behind a sign-in, a
// dynamic page with no example, a component the map says needs its page) is named with the reason,
// never passed over in silence (decision 3).
import fs from 'node:fs';
import path from 'node:path';
import { previewUrl } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { isDynamic, mapProblems, readMap } from '../map/file.js';
import type { MapComponent, RepoMap } from '../map/types.js';
import type { Recipe } from '../recipes/types.js';
import { iterationDir } from '../repo/iterations.js';
import { syncIterations } from '../repo/mirror.js';
import { ROUGH_DIR } from '../repo/root.js';
import { MAP_ORDER, result, writeFiles } from './checks.js';
import type { CheckResult, DoctorTools, Probe } from './types.js';

export type MapCheckInput = {
  repoRoot: string;
  environment: RepoEnvironment;
  /** The environment as previews are asked through it (standalone mode adds its token). */
  shown: RepoEnvironment;
  recipe: Recipe | null;
  tools: DoctorTools;
  /** Where the app answers. */
  base: string;
  /** Doctor's own page this run; the map's pointers go under a page of their own beside it. */
  page: string;
  shotsDir: string;
};

const ITERATION = 'iteration-01';
/** Pages a stranger is sent to when a page needs a sign-in. */
const SIGN_IN = /(log-?in|sign-?in|signin|auth|account\/login|wp-login\.php|session)/i;
/** How many pages and components a detail names before it says how many more. */
const NAMED = 12;
/** How long an app's own page is given to settle before its picture: it never says ready. */
const PAGE_WAIT_MS = 5000;

function listed(items: string[]): string {
  if (items.length <= NAMED) return items.join('; ');
  return `${items.slice(0, NAMED).join('; ')}; and ${items.length - NAMED} more`;
}

/** Slugs named together, as one entry of a detail. */
function slugs(items: string[]): string {
  if (items.length <= NAMED) return items.join(', ');
  return `${items.slice(0, NAMED).join(', ')} and ${items.length - NAMED} more`;
}

/** A path without its trailing slashes, so `/about/` and `/about` are one page. */
function trimmed(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

/** Where a visitor was sent: a path on the app's own origin, or another site's address without its query. */
function place(to: string, base: string): string {
  try {
    const url = new URL(to, base);
    return url.origin === new URL(base).origin ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return to;
  }
}

/** Adds `slug` to the slugs sent to `to`. */
function sentTo(groups: Map<string, string[]>, to: string, slug: string): void {
  groups.set(to, [...(groups.get(to) ?? []), slug]);
}

/** The answer at a page's address, following redirects on the same origin, at most five. */
async function visit(
  tools: DoctorTools,
  url: string,
  timeoutMs: number
): Promise<{ status: number; finalPath: string; redirected: string | null } | null> {
  let current = new URL(url);
  let redirected: string | null = null;
  for (let hop = 0; hop < 6; hop++) {
    let response: Response;
    try {
      response = await tools.fetch(current.toString(), {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual'
      });
      await response.body?.cancel();
    } catch {
      return null;
    }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, current);
      redirected ??= next.origin === current.origin ? next.pathname : next.toString();
      if (next.origin !== current.origin) {
        return { status: response.status, finalPath: next.toString(), redirected };
      }
      current = next;
      continue;
    }
    return { status: response.status, finalPath: current.pathname, redirected };
  }
  return null;
}

/** The map's checks, in their order; none at all for a repo with no map. */
export async function mapChecks(input: MapCheckInput): Promise<CheckResult[]> {
  const { repoRoot, environment, tools } = input;
  let map: RepoMap;
  try {
    const read = readMap(repoRoot);
    if (!read) return [];
    map = read.map;
  } catch (error) {
    return [
      result(
        'map-pages',
        'fail',
        error instanceof Error ? error.message : String(error),
        `Fix the header of ${ROUGH_DIR}/map.md, or run roughbook map to write it again.`
      ),
      ...MAP_ORDER.slice(1).map(id => result(id, 'skip', 'Not checked: the map could not be read.'))
    ];
  }
  if (environment.mode !== 'live') {
    return MAP_ORDER.map(id =>
      result(
        id,
        'skip',
        `Not checked: the map's checks render through a live preview, and this repo's is ${environment.mode}.`
      )
    );
  }
  const previewMs = environment.timeouts.preview * 1000;

  // 1. The pages. One the server or its own code sends to a sign-in page is behind a sign-in, and
  // has no picture (decision 13); the browser's wait ends as soon as it is sent there.
  const problems = mapProblems(map);
  const answered: { slug: string; url: string; probe?: Probe }[] = [];
  const failures: string[] = [...problems];
  const named: string[] = [];
  const signIns = new Map<string, string[]>();
  const notAsked: string[] = [];
  const asked = map.pages.filter(page => page.address !== null);
  for (const page of asked) {
    const address = page.example ?? page.address!;
    if (page.signIn === 'yes') {
      notAsked.push(page.slug);
      continue;
    }
    if (!page.example && isDynamic(page.address)) {
      named.push(`${page.slug}: no example address for ${page.address}`);
      continue;
    }
    const url = `${input.base}${address.startsWith('/') ? address : `/${address}`}`;
    const signedOut = (to: string) => {
      if (page.signIn === 'no') {
        failures.push(
          `${page.slug}: ${address} sends a visitor to ${to}, but the map says it needs no sign-in`
        );
      } else {
        sentTo(signIns, place(to, input.base), page.slug);
      }
    };
    const answer = await visit(tools, url, previewMs);
    if (!answer) {
      failures.push(
        `${page.slug}: ${address} did not answer within ${environment.timeouts.preview} s`
      );
    } else if (answer.redirected && SIGN_IN.test(answer.redirected)) {
      signedOut(answer.redirected);
    } else if (answer.redirected && !answer.finalPath.startsWith('/')) {
      named.push(`${page.slug}: ${address} sends a visitor to another site, ${answer.redirected}`);
    } else if (answer.status >= 200 && answer.status < 300) {
      // Opened once in the browser, with an app page's short wait: its own code may send the
      // browser on once it has loaded, as a sign-in guard does. The picture reuses what it found.
      const probe = tools.browser
        ? await tools.probe({
            url,
            overlays: environment.overlays,
            timeoutMs: previewMs,
            waitMs: PAGE_WAIT_MS
          })
        : undefined;
      const on =
        probe?.path && trimmed(probe.path) !== trimmed(answer.finalPath) ? probe.path : null;
      if (on && SIGN_IN.test(on)) {
        signedOut(on);
      } else if (on) {
        named.push(`${page.slug}: ${address} sends a visitor on to ${on}, so it is not pictured`);
      } else {
        answered.push({ slug: page.slug, url, probe });
      }
    } else {
      failures.push(`${page.slug}: ${address} answered HTTP ${answer.status}`);
    }
  }
  for (const [to, sent] of signIns) {
    named.push(`sent to ${to}, behind a sign-in, so not pictured (decision 13): ${slugs(sent)}`);
  }
  if (notAsked.length) {
    named.unshift(`behind a sign-in, not asked (decision 13): ${slugs(notAsked)}`);
  }
  const checks: CheckResult[] = [];
  const pagesDetail = `${answered.length} of ${asked.length} page${asked.length === 1 ? '' : 's'} answered at ${asked.length === 1 ? 'its address' : 'their addresses'}${
    named.length ? `; named: ${listed(named)}` : ''
  }.`;
  checks.push(
    failures.length
      ? result(
          'map-pages',
          'fail',
          `${listed(failures)}. ${pagesDetail}`,
          `Give each page the address it answers at, an example for a dynamic one, and signIn: yes where a visitor must sign in, in ${ROUGH_DIR}/map.md (by hand, or roughbook map --agent); or start the app the map was made from.`
        )
      : result('map-pages', 'pass', pagesDetail)
  );

  // 2. The sections and shared parts, each alone through a pointer to its real file.
  const cards = map.components.filter(item => item.kind !== 'atom');
  const atoms = map.components.length - cards.length;
  const atomsLine = atoms
    ? `; ${atoms} atom${atoms === 1 ? ' is' : 's are'} the design system's and not rendered alone here (decision 5)`
    : '';
  const pointer = input.recipe?.pointer;
  if (!pointer) {
    checks.push(
      result(
        'map-components',
        'skip',
        `Not checked: ${input.recipe ? `the ${input.recipe.name} recipe` : 'a setup with no recipe'} cannot point an iteration at an existing component yet.`
      ),
      result('map-screenshots', 'skip', 'Not checked: no component was rendered.')
    );
    return checks;
  }
  const mapPage = `${input.page}-map`;
  const rendered: { slug: string; url: string; probe?: Probe }[] = [];
  const componentFailures: string[] = [];
  const componentNamed: string[] = [];
  /** Previews the app sent to a sign-in page, by where: a guard in a layout every route shares. */
  const guarded = new Map<string, string[]>();
  const tried: { component: MapComponent; url: string }[] = [];
  try {
    for (const component of cards) {
      if (component.alone === 'no') {
        componentNamed.push(
          `${component.slug}: does not render alone${component.why ? `: ${component.why}` : ''}`
        );
        continue;
      }
      let fixture: string | null = null;
      if (component.fixture) {
        try {
          fixture = fs.readFileSync(path.join(repoRoot, ...component.fixture.split('/')), 'utf8');
        } catch {
          componentFailures.push(
            `${component.slug}: its fixture ${component.fixture} is not there`
          );
          continue;
        }
      }
      const folder = iterationDir(mapPage, component.slug, ITERATION);
      const files = pointer(component, { iterationDir: folder, fixture });
      if (!files) {
        componentNamed.push(`${component.slug}: cannot be pointed at (${component.export})`);
        continue;
      }
      writeFiles(repoRoot, folder, files);
      tried.push({
        component,
        url: previewUrl(input.base, mapPage, component.slug, ITERATION, input.shown)
      });
    }
    if (tried.length) syncIterations(repoRoot, environment);
    for (const { component, url } of tried) {
      // Asked until it renders or fails, as the sample is: the dev server compiles it first. One
      // the server or the app's own code sends elsewhere is done with at once.
      const deadline = tools.now() + previewMs;
      let outcome: { ok: boolean; error: string | null; signIn?: string; probe?: Probe } | null =
        null;
      const sent = (to: string, by: string) =>
        SIGN_IN.test(to)
          ? { ok: false, error: null, signIn: place(to, input.base) }
          : { ok: false, error: `${by} sent its preview to ${place(to, input.base)}` };
      for (;;) {
        let status: number | null = null;
        let body = '';
        let location: string | null = null;
        try {
          const response = await tools.fetch(url, {
            signal: AbortSignal.timeout(previewMs),
            redirect: 'manual'
          });
          status = response.status;
          location = response.headers.get('location');
          body = await response.text();
        } catch {
          status = null;
        }
        if (status !== null && status >= 300 && status < 400 && location) {
          outcome = sent(location, 'the server');
        } else if (status !== null && status !== 404) {
          if (tools.browser) {
            const probe = await tools.probe({
              url,
              overlays: environment.overlays,
              timeoutMs: previewMs
            });
            if (probe.path && trimmed(probe.path) !== trimmed(new URL(url).pathname)) {
              outcome = sent(probe.path, "the app's code");
            } else if (probe.ready && !probe.error) outcome = { ok: true, error: null, probe };
            else if (probe.error || status >= 500) {
              outcome = { ok: false, error: probe.error ?? firstLine(body) ?? `HTTP ${status}` };
            }
          } else {
            outcome =
              status < 400
                ? { ok: true, error: null }
                : { ok: false, error: firstLine(body) ?? `HTTP ${status}` };
          }
        }
        if (outcome || tools.now() >= deadline) break;
        await tools.sleep(500);
      }
      if (outcome?.ok) {
        rendered.push({ slug: component.slug, url, probe: outcome.probe });
      } else if (outcome?.signIn) {
        sentTo(guarded, outcome.signIn, component.slug);
      } else {
        const why = outcome?.error ?? `it did not render within ${environment.timeouts.preview} s`;
        if (component.alone === 'yes') {
          componentFailures.push(
            `${component.slug}: the map says it renders alone, but it failed: ${why}`
          );
        } else {
          componentNamed.push(`${component.slug}: does not render alone yet: ${why}`);
        }
      }
    }
    for (const [to, sentThere] of guarded) {
      componentNamed.push(
        `previews sent to ${to}, behind a sign-in, so not rendered alone or pictured (decision 13): ${slugs(sentThere)}`
      );
    }
    const componentsDetail = `${rendered.length} of ${cards.length} sections and shared parts rendered alone with their fixtures${tools.browser ? ' and said they were ready' : ''}${
      componentNamed.length ? `; named: ${listed(componentNamed)}` : ''
    }${atomsLine}.`;
    checks.push(
      componentFailures.length
        ? result(
            'map-components',
            'fail',
            `${listed(componentFailures)}. ${componentsDetail}`,
            `Give each a fixture its props can render from (${ROUGH_DIR}/map/fixtures/<slug>/), or say alone: no with why in ${ROUGH_DIR}/map.md, by hand or with roughbook map --agent.`
          )
        : result('map-components', 'pass', componentsDetail)
    );

    // 3. The screenshots: every rendered component and answered page, at every viewport.
    if (!tools.browser) {
      checks.push(
        result(
          'map-screenshots',
          'skip',
          'No Chrome, Chromium or Edge was found. Set ROUGHBOOK_BROWSER to one to check screenshots.'
        )
      );
      return checks;
    }
    // An app's own page never posts the ready message a preview does: it is photographed once it
    // has loaded and a moment passed, not after the preview's whole wait.
    const targets = [
      ...rendered.map(item => ({ ...item, page: false })),
      ...answered.map(item => ({ ...item, page: true }))
    ];
    const missed: string[] = [];
    let overlays = 0;
    let taken = 0;
    for (const target of targets) {
      const waitMs = target.page ? PAGE_WAIT_MS : undefined;
      const probe =
        target.probe ??
        (await tools.probe({
          url: target.url,
          overlays: environment.overlays,
          timeoutMs: previewMs,
          ...(waitMs ? { waitMs } : {})
        }));
      overlays += probe.visibleOverlays ? 1 : 0;
      for (const viewport of environment.viewports) {
        const file = path.join(
          input.shotsDir,
          'map',
          `${target.page ? 'page' : 'component'}-${target.slug}-${viewport.name}.png`
        );
        const ok = await tools.screenshot({
          url: target.url,
          file,
          size: viewport,
          overlays: environment.overlays,
          variant: null,
          ...(waitMs ? { waitMs } : {})
        });
        if (ok) taken += 1;
        else missed.push(`${target.slug} at ${viewport.name}`);
      }
    }
    checks.push(
      missed.length
        ? result(
            'map-screenshots',
            'fail',
            `No screenshot came out for ${listed(missed)}.`,
            'The browser could not photograph them. Open them in a browser to see why.'
          )
        : overlays
          ? result(
              'map-screenshots',
              'fail',
              `A development overlay showed on ${overlays} of ${targets.length} page${targets.length === 1 ? '' : 's'}.`,
              "Name the app's development overlays in rough/environment.md (overlays), so screenshots hide them, or fix what the overlay reports."
            )
          : result(
              'map-screenshots',
              'pass',
              targets.length
                ? `${taken} screenshots came out for ${rendered.length} component${rendered.length === 1 ? '' : 's'} and ${answered.length} page${answered.length === 1 ? '' : 's'}, with no overlay showing.`
                : 'Nothing rendered to photograph.'
            )
    );
    return checks;
  } finally {
    fs.rmSync(path.join(repoRoot, ROUGH_DIR, mapPage), { recursive: true, force: true });
    fs.rmSync(path.join(repoRoot, ROUGH_DIR, '.screenshots', mapPage), {
      recursive: true,
      force: true
    });
    if (tried.length) syncIterations(repoRoot, environment);
  }
}

function firstLine(text: string): string | null {
  const plain = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain ? plain.slice(0, 200) : null;
}
