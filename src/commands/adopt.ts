// `roughbook adopt` (B2 of ROUGHBOOK-BROWNFIELD-PLAN.md): makes pages and components of the map
// project records, by name, slug and kind only (decisions 6 and 7), then writes each new
// component's baseline here, iteration 0, a pointer to the real file with the map's fixture
// (decision 2). With the app running, the baselines' screenshots are taken, and they and the
// adopted pages are pictured for the team and the project's client reviewers (decision 21).
import { parseArgs } from 'node:util';
import type { StudioApi } from '../api/client.js';
import { describeError } from '../api/errors.js';
import { outboxFor } from '../api/outbox.js';
import type { Adopted, ProjectTree } from '../api/types.js';
import { previewUrl, readEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { askYesNo, NOBODY_ANSWERS } from '../io.js';
import {
  ASK_PAST,
  BASELINE,
  chooseAdoption,
  countAdoption,
  parseChoice,
  sendAdoption,
  writeBaselines,
  type AdoptChoice,
  type Adoption,
  type Baselines
} from '../map/adopt.js';
import { MAP_FILE, MapFormatError, readMap } from '../map/file.js';
import type { RepoMap } from '../map/types.js';
import {
  describePictures,
  pictureShot,
  picturesAfterShots,
  sharePagePictures
} from '../pictures/share.js';
import { leaveForStart, SCREENFUL } from '../pictures/queue.js';
import { recipeOf } from '../recipes/index.js';
import { requireRepoLink, type RepoLink } from '../repo/link.js';
import { syncIterations } from '../repo/mirror.js';
import { ROUGH_DIR } from '../repo/root.js';
import { queued } from '../runs/queue.js';
import { requireApi, type Command, type CommandContext } from './context.js';
import { devUrl } from './done.js';

/** The map, or an error saying how to make one. */
export function requireMap(repoRoot: string): RepoMap {
  try {
    const read = readMap(repoRoot);
    if (read) return read.map;
  } catch (error) {
    if (error instanceof MapFormatError) {
      throw new Error(`${error.message} Fix the header, or run roughbook map to write it again.`);
    }
    throw error;
  }
  throw new Error(`There is no ${ROUGH_DIR}/${MAP_FILE} yet. Run roughbook map first.`);
}

/** The question "Adopt all" asks past 50 components (decision 29). */
export function adoptAllQuestion(adoption: Adoption[]): string {
  const count = countAdoption(adoption);
  return `Adopt all ${adoption.length} page${adoption.length === 1 ? '' : 's'} and ${count} components? Each becomes a record on the project, with its name and pictures, for its team and client reviewers.`;
}

export type AdoptOutcome = { adopted: Adopted; baselines: Baselines };

/** Adopts on the backend, then writes the baselines this repo does not have. */
export async function adoptHere(
  repoRoot: string,
  api: StudioApi,
  link: RepoLink,
  environment: RepoEnvironment,
  map: RepoMap,
  adoption: Adoption[]
): Promise<AdoptOutcome> {
  const adopted = await sendAdoption(api, link, adoption);
  const baselines = writeBaselines(repoRoot, map, recipeOf(environment), adopted);
  // The preview setup renders only the iterations it knows of.
  if (baselines.written.length) syncIterations(repoRoot, environment);
  return { adopted, baselines };
}

/** What adoption made, for the terminal. */
export function describeAdoption({ adopted, baselines }: AdoptOutcome): string[] {
  const components = adopted.pages.flatMap(page => page.components);
  const newPages = adopted.pages.filter(page => page.created).length;
  const newComponents = components.filter(component => component.created).length;
  const lines = [
    `Adopted ${adopted.pages.length} page${adopted.pages.length === 1 ? '' : 's'} (${newPages} new) and ${components.length} component${components.length === 1 ? '' : 's'} (${newComponents} new).`
  ];
  if (baselines.written.length) {
    lines.push(
      `Baselines written: ${baselines.written.map(key => `${ROUGH_DIR}/${key}/${BASELINE}`).join(', ')}.`
    );
  }
  if (baselines.present.length) {
    lines.push(`Already here: ${baselines.present.join(', ')}.`);
  }
  for (const { key, why } of baselines.unpointed)
    lines.push(`  ! ${key}: no baseline, since ${why}.`);
  return lines;
}

/**
 * With the app answering: the first screenful of adopted components' baselines screenshotted and
 * pictured, the rest left for start's picture queue, and each adopted page pictured at its
 * address. A line for each, as the terminal says it.
 */
export async function pictureAdopted(
  context: CommandContext,
  api: StudioApi,
  link: RepoLink,
  environment: RepoEnvironment,
  map: RepoMap,
  outcome: AdoptOutcome,
  base: string
): Promise<string[]> {
  const repoRoot = context.repoRoot!;
  const lines: string[] = [];
  const outbox = outboxFor(repoRoot);
  let tree: ProjectTree | null = null;
  try {
    tree = await api.project(link.orgId, link.project);
  } catch {
    // Offline since: the pictures wait in the outbox, which checks the project before sending.
  }
  // A screenful now; the rest in start's queue, behind the cards on screen (decision 65).
  const baselines = [...outcome.baselines.written, ...outcome.baselines.present];
  const later = baselines.slice(SCREENFUL);
  for (const key of baselines.slice(0, SCREENFUL)) {
    const [page, component] = key.split('/') as [string, string];
    const target = { page, component, iteration: BASELINE };
    const shots = await queued(repoRoot, () =>
      context.screenshot(
        repoRoot,
        base,
        target,
        context.env,
        undefined,
        undefined,
        undefined,
        environment
      )
    );
    if (shots.warning) lines.push(`  ${key}: ${shots.warning}`);
    const pictures = await picturesAfterShots(
      context,
      { repoRoot, api, outbox, link, environment, tree },
      target,
      previewUrl(base, page, component, BASELINE, environment),
      shots
    );
    if (pictures) lines.push(`  ${pictures}`);
  }
  if (later.length) {
    await leaveForStart(
      repoRoot,
      later.map(key => `${key}/${BASELINE}`)
    );
    lines.push(
      `  The other ${later.length} baselines are pictured by roughbook start, those on screen first, or with roughbook screenshot <page>/<component>/${BASELINE}.`
    );
  }
  const shoot = pictureShot(context);
  if (shoot) {
    for (const slug of outcome.adopted.pages.map(page => page.slug)) {
      const page = map.pages.find(item => item.slug === slug);
      if (!page) continue;
      const report = await sharePagePictures(
        { repoRoot, api, outbox, link, environment, shoot, tree },
        page,
        base
      );
      const line = describePictures(`The ${page.slug} page`, report);
      if (line) lines.push(`  ${line}`);
      if (report.warning) lines.push(`  ${report.warning}`);
    }
  }
  return lines;
}

export const adopt: Command = {
  name: 'adopt',
  summary: "Make the map's pages and components project records, with their baselines",
  usage: 'adopt <page>[/<component>] | --all [--yes] [--dev-url <url>]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        all: { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
        'dev-url': { type: 'string' }
      }
    });
    const repoRoot = context.repoRoot!;
    let choice: AdoptChoice | null = values.all ? { all: true } : null;
    if (!choice && positionals[0]) choice = parseChoice(positionals[0]);
    if (!choice || (values.all && positionals.length)) {
      throw new Error(
        `Name a page, or a page and one of its components, as in roughbook adopt home or roughbook adopt home/hero; or adopt everything with --all. The names are in ${ROUGH_DIR}/${MAP_FILE}.`
      );
    }
    const link = await requireRepoLink(repoRoot);
    const environment = await readEnvironment(repoRoot, link);
    const map = requireMap(repoRoot);
    const adoption = chooseAdoption(map, choice);
    if (!adoption.length) {
      io.out(`${ROUGH_DIR}/${MAP_FILE} has no sections or shared parts to adopt.`);
      return 0;
    }
    // A large app does not flood the project with records nobody works on (decisions 6 and 29).
    if ('all' in choice && countAdoption(adoption) > ASK_PAST && !values.yes) {
      const yes = await askYesNo(io, adoptAllQuestion(adoption), false);
      if (yes === null) {
        io.out(
          `${NOBODY_ANSWERS}, so nothing was adopted. Run it with --yes once you have read this.`
        );
        return 1;
      }
      if (!yes) {
        io.out('Nothing was adopted. Adopt a page at a time with roughbook adopt <page>.');
        return 0;
      }
    }
    const api = await requireApi(context);
    const outcome = await adoptHere(repoRoot, api, link, environment, map, adoption);
    for (const line of describeAdoption(outcome)) io.out(line);

    // Pictures need the app: its pages, and the previews the baselines are.
    if (environment.mode !== 'live') {
      io.out(
        'Take the baselines’ screenshots with roughbook screenshot <page>/<component>/iteration-00.'
      );
      return 0;
    }
    const base = devUrl(values['dev-url'], context.env, environment.start.url);
    if (!(await context.askPreview(base, 5000))) {
      io.out(
        `Nothing answered at ${base}, so no screenshots or pictures were taken. Start the app, then take them with roughbook screenshot <page>/<component>/iteration-00.`
      );
      return 0;
    }
    // The adoption is done: pictures that fail now are taken with the next screenshots.
    const lines = await pictureAdopted(context, api, link, environment, map, outcome, base).catch(
      error => [`Pictures: ${describeError(error)}`]
    );
    for (const line of lines) io.out(line);
    return 0;
  }
};
