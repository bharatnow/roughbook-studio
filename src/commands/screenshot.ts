import { parseArgs } from 'node:util';
import { outboxFor } from '../api/outbox.js';
import { previewUrl, readEnvironment } from '../environment/read.js';
import { picturesAfterShots } from '../pictures/share.js';
import { requireRepoLink } from '../repo/link.js';
import { syncIterations } from '../repo/mirror.js';
import { iterationExists } from '../runs/slots.js';
import { listRuns } from '../runs/store.js';
import { withPreviews } from '../standalone/server.js';
import { openApi, type Command } from './context.js';
import { devUrl } from './done.js';
import { parseIteration } from './shared.js';

/**
 * Takes an iteration's screenshots again: after Done found the dev server down or behind a login,
 * or once the iteration changed. Without a name, the iteration of the run finished last.
 */
export const screenshot: Command = {
  name: 'screenshot',
  summary: "Take an iteration's desktop and phone screenshots again, through the dev server",
  usage: 'screenshot [<page>/<component>/<iteration>] [--dev-url <url>]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { 'dev-url': { type: 'string' } }
    });
    const repoRoot = context.repoRoot!;
    let target: { page: string; component: string; iteration: string };
    if (positionals[0]) {
      target = parseIteration(positionals[0]);
    } else {
      const latest = (await listRuns(repoRoot))
        .filter(run => run.status === 'finished' && run.finishedAt)
        .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!))[0];
      if (!latest) {
        throw new Error(
          'Name the iteration, as in roughbook screenshot homepage/hero/iteration-01.'
        );
      }
      target = { page: latest.page, component: latest.component, iteration: latest.iteration };
    }
    const label = `${target.page}/${target.component}/${target.iteration}`;
    if (!iterationExists(repoRoot, target.page, target.component, target.iteration)) {
      throw new Error(`${label} is not in this repo.`);
    }
    // The preview setup renders only the iterations it knows of.
    const link = await requireRepoLink(repoRoot);
    const environment = await readEnvironment(repoRoot, link);
    let pictures: string | null = null;
    syncIterations(repoRoot, environment);
    // Through the app's dev server, or a standalone server of its own for the time it takes.
    const shots = await withPreviews(
      repoRoot,
      environment,
      devUrl(values['dev-url'], context.env, environment.start.url),
      async (url, shown) => {
        const taken = await context.screenshot(
          repoRoot,
          url,
          target,
          context.env,
          undefined,
          undefined,
          undefined,
          shown
        );
        // Its pictures go up after its screenshots (decisions 21 and 23), when signed in.
        const { api } = await openApi(context);
        pictures = await picturesAfterShots(
          context,
          { repoRoot, api, outbox: outboxFor(repoRoot), link, environment: shown },
          target,
          previewUrl(url, target.page, target.component, target.iteration, shown),
          taken
        ).catch(() => null);
        return taken;
      }
    );
    const files = Object.values(shots.files);
    if (files.length) io.out(`${label}: ${files.join(', ')}`);
    if (pictures) io.out(pictures);
    if (shots.warning) io.err(shots.warning);
    return shots.warning ? 1 : 0;
  }
};
