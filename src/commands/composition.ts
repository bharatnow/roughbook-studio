// A page's composition from the terminal (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 46 to 52):
// `roughbook section` makes a new section for a page, whose first iteration is a run like any
// other; the other command saves a composition of the page's sections, numbered by the backend,
// with the page's files kept in `.base/`, and takes the composed preview's pictures where the
// recipe composes and the app is running.
import { parseArgs } from 'node:util';
import { describeError } from '../api/errors.js';
import { outboxFor } from '../api/outbox.js';
import { parseSections } from '../compositions/composition.js';
import { describePlan, sectionNames } from '../compositions/composition.js';
import {
  composedAddress,
  makeSection,
  saveComposition,
  shareComposition
} from '../compositions/save.js';
import { readComposition } from '../compositions/store.js';
import { readEnvironment } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { readMap } from '../map/file.js';
import { describePictures, pictureShot } from '../pictures/share.js';
import { SLUG } from '../repo/iterations.js';
import { requireRepoLink, type RepoLink } from '../repo/link.js';
import { requireApi, type Command, type CommandContext } from './context.js';
import { devUrl } from './done.js';

/** The command that saves a composition, as B6's contract names it. */
export const COMPOSE_COMMAND = 'compose';

function pageArgument(text: string | undefined, usage: string): string {
  const page = text?.trim().replace(/\/+$/, '') ?? '';
  if (!SLUG.test(page)) throw new Error(`Name the page by its slug, as in roughbook ${usage}.`);
  return page;
}

/** A composition's pictures, with the app answering at `base`: a line, or why none were taken. */
async function pictureComposition(
  context: CommandContext,
  link: RepoLink,
  environment: RepoEnvironment,
  target: { page: string; id: string },
  flag: string | undefined
): Promise<string[]> {
  const repoRoot = context.repoRoot!;
  const kept = readComposition(repoRoot, target.page, target.id);
  if (!kept) return [];
  if (!composedAddress(environment, target.page, kept.composition.sections)) {
    return [
      'This stack’s preview route does not render a page’s composition yet, so the composition has no pictures: the local UI shows its sections one under another.'
    ];
  }
  const shoot = pictureShot(context);
  const api = await requireApi(context);
  if (!shoot || !api.signedIn) return [];
  const base = devUrl(flag, context.env, environment.start.url);
  const retake = `roughbook ${COMPOSE_COMMAND} ${target.page} --pictures ${target.id}`;
  if (!(await context.askPreview(base, 5000))) {
    return [
      `Nothing answered at ${base}, so no pictures were taken. Start the app, then ${retake}.`
    ];
  }
  const report = await shareComposition(
    { repoRoot, api, outbox: outboxFor(repoRoot), link, environment, shoot },
    target,
    base
  ).catch(error => ({
    sent: [],
    queued: [],
    unchanged: [],
    skipped: null,
    warning: `Pictures: ${describeError(error)}`
  }));
  return [describePictures(target.id, report), report.warning].filter((line): line is string =>
    Boolean(line)
  );
}

export const section: Command = {
  name: 'section',
  summary: 'Make a new section for one of the app’s pages, to iterate on and compose',
  usage: 'section <page> --name "<name>"',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { name: { type: 'string' } }
    });
    const page = pageArgument(positionals[0], 'section home --name "Customer logos"');
    if (values.name === undefined)
      throw new Error('Name the new section: --name "Customer logos".');
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const environment = await readEnvironment(repoRoot, link);
    const api = await requireApi(context);
    const made = await makeSection(repoRoot, api, link, environment, { page, name: values.name });
    io.out(
      `Made ${made.name} (${made.page}/${made.slug}), a new section of the page, not in the app yet.`
    );
    io.out(`  Its folder: ${made.folder}/`);
    io.out(`  Its first iteration is a run: roughbook run ${made.page}/${made.slug}`);
    io.out(
      `  Then place it: roughbook ${COMPOSE_COMMAND} ${made.page} --sections …,${made.slug}:iteration-01,…`
    );
    return 0;
  }
};

export const composition: Command = {
  name: COMPOSE_COMMAND,
  summary: 'Save a composition of a page’s sections, to preview and promote',
  usage: `${COMPOSE_COMMAND} <page> --sections <component>[:<iteration>],… [--name "<name>"] [--parent composition-NN] [--dev-url <url>] | ${COMPOSE_COMMAND} <page> --pictures composition-NN`,
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        sections: { type: 'string' },
        name: { type: 'string' },
        parent: { type: 'string' },
        pictures: { type: 'string' },
        'dev-url': { type: 'string' }
      }
    });
    const page = pageArgument(positionals[0], `${COMPOSE_COMMAND} home --sections hero,pricing`);
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const environment = await readEnvironment(repoRoot, link);

    if (values.pictures !== undefined) {
      if (!readComposition(repoRoot, page, values.pictures)) {
        throw new Error(`${values.pictures} is not one of ${page}'s compositions in this repo.`);
      }
      const lines = await pictureComposition(
        context,
        link,
        environment,
        { page, id: values.pictures },
        values['dev-url']
      );
      for (const line of lines.length ? lines : ['No pictures were taken.']) io.out(line);
      return 0;
    }
    if (values.sections === undefined) {
      throw new Error(
        `Name the sections in order: roughbook ${COMPOSE_COMMAND} ${page} --sections hero,testimonials,features:iteration-02`
      );
    }
    const sections = parseSections(values.sections);
    const api = await requireApi(context);
    const saved = await saveComposition(repoRoot, api, link, environment, {
      page,
      sections,
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.parent !== undefined ? { parent: values.parent } : {})
    });
    // A new section is named as it was made, which only the project knows.
    const tree = await api.project(link.orgId, link.project).catch(() => null);
    const names = sectionNames(readMap(repoRoot)?.map ?? null, tree, page);
    io.out(
      `Saved ${saved.id} of ${page}${saved.composition.name ? `, “${saved.composition.name}”` : ''}: ${saved.folder}/`
    );
    for (const line of describePlan(saved.plan, names)) io.out(line);
    const lines = await pictureComposition(
      context,
      link,
      environment,
      { page, id: saved.id },
      values['dev-url']
    );
    for (const line of lines) io.out(line);
    io.out(`Promote it with roughbook promote ${page} --composition ${saved.id}.`);
    return 0;
  }
};
