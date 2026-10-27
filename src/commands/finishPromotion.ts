// A promote's finish where a person or an agent asks for it (roughbook done, MCP finish_run, the
// local UI's Finish): the studio's checks of what the agent wrote (src/runs/promotion.ts), then the
// baseline refreshed. Its pointer already renders the app's new code, so its screenshots and
// pictures, and those of the adopted pages that show it, are taken again (B4's contract). A page
// composition's promote (B6, decision 53), once done, maps the app again, adopts its new sections
// so each gains its baseline, and pictures the page again.
import type { StudioApi } from '../api/client.js';
import type { Outbox } from '../api/outbox.js';
import { previewUrl, readEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { BASELINE, chooseAdoption } from '../map/adopt.js';
import { readMap, writeMap } from '../map/file.js';
import { mapRepo } from '../map/run.js';
import type { RepoMap } from '../map/types.js';
import {
  describePictures,
  pictureShot,
  sharePagePictures,
  shareIterationPictures
} from '../pictures/share.js';
import type { RepoLink } from '../repo/link.js';
import {
  finishPromotion,
  type FinishPromotionOptions,
  type PromotionRecord
} from '../runs/promotion.js';
import { queued } from '../runs/queue.js';
import { iterationExists } from '../runs/slots.js';
import { iterationHash } from '../screenshot/iteration.js';
import { withPreviews } from '../standalone/server.js';
import { adoptHere, describeAdoption, pictureAdopted } from './adopt.js';
import type { CommandContext } from './context.js';

export type PromotionFinishOptions = FinishPromotionOptions & {
  devUrl: string;
  /** Retake the baseline's screenshots and pictures; off for `--no-screenshots`. */
  refresh: boolean;
  /** The environment as previews are asked through it, when the caller serves them (the local UI). */
  environment?: RepoEnvironment;
};

/** The baselines a promote changed: its component's, and those of the children it wrote back. */
export function refreshedBaselines(
  repoRoot: string,
  record: Pick<PromotionRecord, 'page' | 'component' | 'targets'>
): { targets: { page: string; component: string; iteration: string }[]; pages: string[] } {
  const map = readMap(repoRoot)?.map;
  const slugs = new Set([record.component]);
  for (const target of record.targets.filter(item => item.child)) {
    for (const item of map?.components ?? []) {
      if (item.files.includes(target.path)) slugs.add(item.slug);
    }
  }
  const targets: { page: string; component: string; iteration: string }[] = [];
  const add = (page: string, component: string) => {
    if (targets.some(item => item.page === page && item.component === component)) return;
    if (iterationExists(repoRoot, page, component, BASELINE)) {
      targets.push({ page, component, iteration: BASELINE });
    }
  };
  add(record.page, record.component);
  const pages = new Set<string>();
  for (const page of map?.pages ?? []) {
    for (const slug of page.sections.filter(section => slugs.has(section))) {
      add(page.slug, slug);
      pages.add(page.slug);
    }
  }
  if (map?.pages.some(page => page.slug === record.page)) pages.add(record.page);
  return { targets, pages: [...pages] };
}

/**
 * Takes the refreshed baselines' screenshots and pictures again, and the pictures of the adopted
 * pages that show them: a line for each, as the terminal says it.
 */
export async function refreshAfterPromote(
  context: CommandContext,
  input: { api: StudioApi; outbox: Outbox; link: RepoLink },
  record: PromotionRecord,
  devUrl: string,
  environment?: RepoEnvironment
): Promise<string[]> {
  const repoRoot = context.repoRoot!;
  const read = environment ?? (await readEnvironment(repoRoot, input.link));
  const { targets, pages } = refreshedBaselines(repoRoot, record);
  if (!targets.length && !pages.length) return [];
  const lines: string[] = [];
  const shoot = pictureShot(context);
  const share = { repoRoot, ...input, environment: read, force: true as const };
  const work = async (url: string, served: RepoEnvironment) => {
    for (const target of targets) {
      const key = `${target.page}/${target.component}/${target.iteration}`;
      const shots = await queued(repoRoot, () =>
        context.screenshot(
          repoRoot,
          url,
          target,
          context.env,
          undefined,
          undefined,
          undefined,
          served,
          { force: true }
        )
      );
      if (shots.warning) lines.push(`${key}: ${shots.warning}`);
      const files = Object.values(shots.files);
      if (files.length) lines.push(`${key}: screenshots taken again (${files.length}).`);
      if (!files.length || !shoot || !input.api.signedIn || served.mode === 'snapshot') continue;
      const report = await shareIterationPictures(
        { ...share, environment: served, shoot },
        target,
        previewUrl(url, target.page, target.component, target.iteration, served),
        iterationHash(repoRoot, target, served)
      ).catch(() => null);
      const line = report && describePictures(key, report);
      if (line) lines.push(line);
      if (report?.warning) lines.push(report.warning);
    }
  };
  if (environment) await work(devUrl, read);
  else await withPreviews(repoRoot, read, devUrl, work);

  // An adopted page is pictured at its address on the app itself, which a live setup runs.
  const map = readMap(repoRoot)?.map;
  if (shoot && input.api.signedIn && read.mode === 'live' && map) {
    for (const slug of pages) {
      const page = map.pages.find(item => item.slug === slug);
      if (!page) continue;
      const report = await sharePagePictures({ ...share, shoot }, page, devUrl).catch(() => null);
      const line = report && describePictures(`The ${page.slug} page`, report);
      if (line) lines.push(line);
    }
  }
  return lines;
}

/**
 * The map after a page's promote, with each new section under the slug the backend gave it: the
 * component the discoverers found at the section's new file takes the section's slug and name,
 * which later maps keep (the slug follows the file). The new sections found, and those not.
 */
export function placeNewSections(
  map: RepoMap,
  record: Pick<PromotionRecord, 'page' | 'targets'>
): { map: RepoMap; found: string[]; missing: string[] } {
  let components = [...map.components];
  let pages = map.pages;
  const found: string[] = [];
  const missing: string[] = [];
  for (const target of record.targets) {
    const section = target.section;
    if (!section) continue;
    const at = components.find(item => item.files[0] === target.path);
    if (!at) {
      missing.push(section.component);
      continue;
    }
    // A slug the map already gives another component stays that one's.
    const free = !components.some(item => item.slug === section.component && item !== at);
    if (at.slug !== section.component && free) {
      const from = at.slug;
      components = components.map(item =>
        item === at ? { ...item, slug: section.component, name: section.name } : item
      );
      pages = pages.map(page => ({
        ...page,
        sections: page.sections.map(slug => (slug === from ? section.component : slug))
      }));
    }
    found.push(free ? section.component : at.slug);
  }
  return { map: { ...map, components, pages }, found, missing };
}

/**
 * After a page composition's promote that is done (decisions 53 and 55): the app mapped again, the
 * whole page adopted again in its new order, which gives its new sections their baselines, and the
 * page pictured again, with the new baselines' own screenshots and pictures where the app is
 * running. A line for each, as the terminal says it.
 */
export async function refreshAfterPagePromote(
  context: CommandContext,
  input: { api: StudioApi; outbox: Outbox; link: RepoLink },
  record: PromotionRecord,
  devUrl: string,
  environment?: RepoEnvironment
): Promise<string[]> {
  const repoRoot = context.repoRoot!;
  const read = environment ?? (await readEnvironment(repoRoot, input.link));
  const lines: string[] = [];
  const mapped = await mapRepo(repoRoot, read, input.link);
  let map = mapped?.map ?? readMap(repoRoot)?.map;
  if (!map) return [`${record.page}: the app could not be mapped again, so nothing was adopted.`];
  const placed = placeNewSections(map, record);
  if (placed.found.length) {
    writeMap(repoRoot, placed.map);
    map = placed.map;
  }
  for (const slug of placed.missing) {
    lines.push(
      `${record.page}/${slug}: its new file is not in the map, so it was not adopted. Run roughbook map, then roughbook adopt ${record.page}/${slug}.`
    );
  }
  const page = map.pages.find(item => item.slug === record.page);
  if (!page) return [...lines, `rough/map.md no longer has the ${record.page} page.`];
  // The whole page again, new sections or not, so the web's order follows the app's (decision 55).
  const outcome = await adoptHere(
    repoRoot,
    input.api,
    input.link,
    read,
    map,
    chooseAdoption(map, { page: page.slug })
  );
  lines.push(...describeAdoption(outcome));

  // Pictures need the app: the page at its address, and the new baselines' previews.
  if (read.mode !== 'live' || !input.api.signedIn) return lines;
  if (!(await context.askPreview(devUrl, 5000))) {
    lines.push(`Nothing answered at ${devUrl}, so the page was not pictured again.`);
    return lines;
  }
  if (placed.found.length) {
    // The sections already in the app kept their files: only the new ones are pictured.
    const fresh = new Set(placed.found.map(slug => `${page.slug}/${slug}`));
    const present = outcome.baselines.present.filter(key => fresh.has(key));
    const pictured = { ...outcome, baselines: { ...outcome.baselines, present } };
    lines.push(
      ...(await pictureAdopted(context, input.api, input.link, read, map, pictured, devUrl))
    );
    return lines;
  }
  const shoot = pictureShot(context);
  if (!shoot) return lines;
  const report = await sharePagePictures(
    { repoRoot, ...input, environment: read, force: true, shoot },
    page,
    devUrl
  ).catch(() => null);
  const line = report && describePictures(`The ${page.slug} page`, report);
  if (line) lines.push(line);
  return lines;
}

/** Finishes a promote, then, when the app's files changed, refreshes the baselines it changed. */
export async function finishPromotionHere(
  context: CommandContext,
  api: StudioApi,
  outbox: Outbox,
  link: RepoLink,
  promotionId: string,
  options: PromotionFinishOptions
): Promise<{ record: PromotionRecord; refreshed: string[] }> {
  const repoRoot = context.repoRoot!;
  const environment = options.environment ?? (await readEnvironment(repoRoot, link));
  const record = await finishPromotion(repoRoot, api, outbox, environment, promotionId, options);
  const wrote = record.result?.changed.some(item => item.inScope) ?? false;
  if (record.subject === 'page') {
    const refreshed =
      options.refresh && record.result?.outcome === 'done'
        ? await refreshAfterPagePromote(
            context,
            { api, outbox, link },
            record,
            options.devUrl,
            options.environment
          ).catch(error => [`The page could not be refreshed: ${(error as Error).message}`])
        : [];
    return { record, refreshed };
  }
  const refreshed =
    options.refresh && wrote && record.result?.outcome !== 'conflict'
      ? await refreshAfterPromote(
          context,
          { api, outbox, link },
          record,
          options.devUrl,
          options.environment
        ).catch(error => [`The baseline could not be refreshed: ${(error as Error).message}`])
      : [];
  return { record, refreshed };
}
