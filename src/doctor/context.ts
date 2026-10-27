// Doctor's map-context check (B5 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 41 and 42), for each
// adopted section with iterations, on its real page: with ?roughbook-swap the page shows the
// iteration, inside its marker naming it; without it, the app's own component, marked; the markers
// leave the page's picture the same as without them; and the production build (or production, for
// a stack whose gate is the runtime) holds nothing of the switch, as the gate found.
import fs from 'node:fs';
import path from 'node:path';
import type { RepoEnvironment } from '../environment/types.js';
import { readMap } from '../map/file.js';
import type { RepoMap } from '../map/types.js';
import {
  SECTION_ATTRIBUTE,
  SWAPPED_ATTRIBUTE,
  contextAddress,
  contextSections,
  contextSwitch,
  type ContextSection
} from '../recipes/context.js';
import { LAZY_IMPORT_ERROR, LAZY_IMPORT_FAULT, isLazyImportFault } from '../recipes/next/fault.js';
import type { Recipe } from '../recipes/types.js';
import type { RepoLink } from '../repo/link.js';
import { pictureDifference } from '../snapshot/png.js';
import { result } from './checks.js';
import type { CheckResult, DoctorTools } from './types.js';

/** What the gate found of the switch in production; null when it was not looked for. */
export type ContextGate = { leaked: string[]; where: string } | { skipped: string } | null;

export type ContextCheckInput = {
  repoRoot: string;
  environment: RepoEnvironment;
  recipe: Recipe | null;
  tools: DoctorTools;
  base: string;
  shotsDir: string;
  gate: ContextGate;
  link: RepoLink | null;
  /** The map, when the caller read it already. */
  map?: RepoMap;
};

/** How many problems a detail names before it says how many more. */
const NAMED = 8;
/** How long an app's own page is given to settle before its picture: it never says ready. */
const PAGE_WAIT_MS = 5000;

const listed = (items: string[]) =>
  items.length <= NAMED
    ? items.join('; ')
    : `${items.slice(0, NAMED).join('; ')}; and ${items.length - NAMED} more`;

/** Whether the HTML has a marker naming `key`, and, when `swapped` is given, saying it swapped that in. */
export function hasMarker(html: string, key: string, swapped?: string | null): boolean {
  for (const match of html.matchAll(/<roughbook-section\b[^>]*>/g)) {
    const tag = match[0];
    if (!tag.includes(`${SECTION_ATTRIBUTE}="${key}"`)) continue;
    const swap = new RegExp(`${SWAPPED_ATTRIBUTE}="([^"]*)"`).exec(tag)?.[1] ?? null;
    if (swapped === undefined || swap === swapped) return true;
  }
  return false;
}

function firstLine(text: string): string {
  return (
    text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160) || 'no text'
  );
}

/** The page at `url`, asked until it answers 200 with what `shows` looks for, within the preview timeout. */
async function askUntil(
  tools: DoctorTools,
  url: string,
  timeoutMs: number,
  shows: (html: string) => boolean
): Promise<{ status: number | null; html: string; shown: boolean }> {
  const deadline = tools.now() + timeoutMs;
  let last: { status: number | null; html: string } = { status: null, html: '' };
  for (;;) {
    try {
      const response = await tools.fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual'
      });
      last = { status: response.status, html: await response.text() };
    } catch {
      last = { status: null, html: '' };
    }
    if (last.status === 200 && shows(last.html)) return { ...last, shown: true };
    // Sent elsewhere, or answered with an error page: waiting will not change it once compiled.
    if (last.status !== null && last.status !== 200 && last.status !== 404 && last.status < 500) {
      return { ...last, shown: false };
    }
    if (tools.now() >= deadline) return { ...last, shown: false };
    await tools.sleep(500);
  }
}

/**
 * The same for a page drawn in the browser (B5b): its markers as the browser holds them once
 * settled, and when they do not show, what the page threw. Status 200 once the page loaded.
 */
async function seeUntil(
  tools: DoctorTools,
  url: string,
  timeoutMs: number,
  overlays: string[],
  shows: (html: string) => boolean
): Promise<{ status: number | null; html: string; shown: boolean; why?: string }> {
  const deadline = tools.now() + timeoutMs;
  for (;;) {
    const probe = await tools.probe({ url, overlays, timeoutMs, waitMs: PAGE_WAIT_MS });
    const html = (probe.markers ?? []).join('\n');
    if (shows(html)) return { status: 200, html, shown: true };
    if (tools.now() >= deadline) {
      const why = probe.error ?? probe.exceptions[0];
      return {
        status: probe.path === undefined ? null : 200,
        html,
        shown: false,
        ...(why ? { why } : {})
      };
    }
    await tools.sleep(500);
  }
}

/** The map-context check. */
export async function contextCheck(input: ContextCheckInput): Promise<CheckResult> {
  const { repoRoot, environment, recipe, tools } = input;
  // A setup the setup run built has the switch the setup prompt describes, by the same words.
  const hook = contextSwitch(recipe);
  if (!hook) {
    return result(
      'map-context',
      'skip',
      `Not checked: the ${recipe?.name ?? ''} recipe has no in-page view yet, so its components are shown alone (decision 11).`
    );
  }
  let map = input.map ?? null;
  if (!map) {
    try {
      map = readMap(repoRoot)?.map ?? null;
    } catch {
      map = null;
    }
  }
  if (!map) return result('map-context', 'skip', 'Not checked: the map could not be read.');
  const sections = contextSections(repoRoot, environment.entry, map).filter(
    section => section.iterations.length
  );
  if (!sections.length) {
    return result(
      'map-context',
      'skip',
      'Not checked: no adopted section has an iteration yet to show in its page.'
    );
  }
  const appDir = recipe ? recipe.appDir(repoRoot) : null;
  const link: RepoLink = input.link ?? {
    version: 1,
    orgId: '',
    project: '',
    roughCommitted: true,
    appDir
  };
  const missing = hook.missing(repoRoot, link);
  if (missing.length) {
    return result(
      'map-context',
      'fail',
      `The in-page view's switch is not set up: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`,
      'Run roughbook setup --upgrade, which adds it in development only.'
    );
  }
  const previewMs = environment.timeouts.preview * 1000;
  if (hook.browser && !tools.browser) {
    return result(
      'map-context',
      'skip',
      'Not checked: this app draws its pages in the browser, and no browser was found to read their markers.'
    );
  }
  // The page as the server sent it, or, for a page drawn in the browser, as the browser shows it.
  const ask = (url: string, shows: (html: string) => boolean) =>
    hook.browser
      ? seeUntil(tools, url, previewMs, environment.overlays, shows)
      : askUntil(tools, url, previewMs, shows);
  const failures: string[] = [];
  // A switch that is there but behind (B7b: a block written before the recipe's cache setting).
  const behind = hook.behind?.(repoRoot) ?? null;
  if (behind) failures.push(behind);
  const named: string[] = [];
  /** Whether a page answered Turbopack's lost lazy import (decision 68). */
  let lost = false;
  /** What a page answered, naming Turbopack's lost lazy import where it is that. */
  const answered = (status: number | null, html: string, body: boolean) => {
    if (status === null) return 'answered nothing';
    if (isLazyImportFault(html)) {
      lost = true;
      return `answered HTTP ${status}: ${LAZY_IMPORT_ERROR}`;
    }
    return body ? `answered HTTP ${status}: ${firstLine(html)}` : `answered HTTP ${status}`;
  };
  /** Why a page drawn in the browser did not show, the same way. */
  const because = (found: { shown: boolean; why?: string }) => {
    const why = found.why;
    if (!why) return '';
    if (!isLazyImportFault(why)) return ` (${why})`;
    lost = true;
    return ` (${LAZY_IMPORT_ERROR})`;
  };
  let swaps = 0;
  /** The pages checked, each once, for the pictures. */
  const pages = new Map<string, ContextSection[]>();
  for (const section of sections) {
    const address = contextAddress(map, section);
    if (!address) {
      named.push(`${section.key}: no page at a fixed address anyone may open shows it`);
      continue;
    }
    const url = (swap: string | null) => `${input.base}${hook.address(address, swap)}`;
    // Without a swap: the app's own component, marked, the first ask compiling the page.
    const plain = await ask(url(null), html => hasMarker(html, section.key, null));
    if (!plain.shown) {
      failures.push(
        plain.status === 200
          ? `${section.key}: ${address} shows no marker naming it${because(plain)}`
          : `${section.key}: ${address} ${answered(plain.status, plain.html, false)}`
      );
      continue;
    }
    pages.set(address, [...(pages.get(address) ?? []), section]);
    for (const iteration of section.iterations) {
      const asked = await ask(url(iteration.key), html =>
        hasMarker(html, section.key, iteration.key)
      );
      if (asked.shown) {
        swaps += 1;
        continue;
      }
      failures.push(
        asked.status === 200
          ? `${iteration.key}: ${hook.address(address, iteration.key)} did not show it in its marker${because(asked)}`
          : `${iteration.key}: ${hook.address(address, iteration.key)} ${answered(asked.status, asked.html, true)}`
      );
    }
  }
  // The pictures: each page with its markers, and without, at every viewport.
  let compared = 0;
  if (tools.browser) {
    for (const address of pages.keys()) {
      for (const viewport of environment.viewports) {
        const file = (name: string) =>
          path.join(
            input.shotsDir,
            `context-${address.replace(/[^a-z0-9]+/gi, '-')}-${viewport.name}-${name}.png`
          );
        const shot = (url: string, to: string) =>
          tools.screenshot({
            url,
            file: to,
            size: viewport,
            overlays: environment.overlays,
            variant: null,
            waitMs: PAGE_WAIT_MS
          });
        const marked = await shot(`${input.base}${hook.address(address, null)}`, file('marked'));
        const bare = await shot(
          `${input.base}${hook.address(address, null, { markers: false })}`,
          file('bare')
        );
        if (!marked || !bare) {
          failures.push(`${address} at ${viewport.name}: no picture came out`);
          continue;
        }
        const difference = pictureDifference(
          fs.readFileSync(file('marked')),
          fs.readFileSync(file('bare'))
        );
        if (difference === 0) {
          compared += 1;
          continue;
        }
        // A page that moves on its own (an endless animation) differs from itself: a second
        // picture without markers tells it from markers that move things.
        const again = await shot(
          `${input.base}${hook.address(address, null, { markers: false })}`,
          file('bare-again')
        );
        const itself = again
          ? pictureDifference(fs.readFileSync(file('bare')), fs.readFileSync(file('bare-again')))
          : 0;
        if (itself > 0) {
          named.push(
            `${address} at ${viewport.name}: not compared, the page moves on its own (${(itself * 100).toFixed(2)}% of its pixels between two pictures without markers)`
          );
        } else {
          failures.push(
            `${address} at ${viewport.name} looks different with its markers (${(difference * 100).toFixed(2)}% of its pixels)`
          );
        }
      }
    }
  }
  let gateLine: string;
  if (input.gate === null) {
    gateLine = 'production was not checked for the switch';
  } else if ('skipped' in input.gate) {
    gateLine = input.gate.skipped;
  } else if (input.gate.leaked.length) {
    failures.push(
      `${input.gate.where} holds the switch: ${input.gate.leaked.slice(0, 3).join(', ')}${input.gate.leaked.length > 3 ? ', …' : ''}`
    );
    gateLine = '';
  } else {
    gateLine = `${input.gate.where} holds nothing of the switch`;
  }
  const iterations = sections.reduce((sum, section) => sum + section.iterations.length, 0);
  const detail = [
    `${swaps} of ${iterations} iteration${iterations === 1 ? '' : 's'} of ${sections.length} adopted section${sections.length === 1 ? '' : 's'} shown in ${pages.size === 1 ? 'its page' : 'their pages'} inside ${iterations === 1 ? 'its marker' : 'their markers'}`,
    `without a swap each page shows the app's own, marked`,
    tools.browser
      ? `the markers leave ${compared} picture${compared === 1 ? '' : 's'} the same`
      : 'no browser was found to compare the pictures',
    gateLine,
    named.length ? `named: ${listed(named)}` : ''
  ]
    .filter(Boolean)
    .join('; ');
  // What the in-page view covers on this stack, when the recipe says (a native target that has none).
  const note = hook.note ? ` ${hook.note}` : '';
  const fix = [
    lost ? LAZY_IMPORT_FAULT.fix : '',
    behind ? 'Run roughbook setup --upgrade, which rewrites the block.' : '',
    "Open the page with the swap in a browser to see why, or run roughbook setup --upgrade if the switch is behind. Markers that change a page's picture meet a selector of the app's that counts children (main > *, :first-child): show that section alone until the selector allows for them."
  ]
    .filter(Boolean)
    .join(' ');
  return failures.length
    ? result(
        'map-context',
        'fail',
        `${listed(failures)}. ${detail}.${lost ? ` ${LAZY_IMPORT_FAULT.what}` : ''}${note}`,
        fix
      )
    : result('map-context', 'pass', `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.${note}`);
}
