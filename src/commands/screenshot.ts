import { parseArgs } from 'node:util';
import { readEnvironment } from '../environment/read.js';
import { fallbackRecipe, recipeFor } from '../recipes/index.js';
import { iterationExists } from '../runs/slots.js';
import { listRuns } from '../runs/store.js';
import type { Command } from './context.js';
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
    const environment = await readEnvironment(repoRoot);
    (recipeFor(environment.recipe) ?? fallbackRecipe).syncPreview(repoRoot);
    const shots = await context.screenshot(
      repoRoot,
      devUrl(values['dev-url'], context.env, environment.start.url),
      target,
      context.env
    );
    const files = Object.values(shots.files);
    if (files.length) io.out(`${label}: ${files.join(', ')}`);
    if (shots.warning) io.err(shots.warning);
    return shots.warning ? 1 : 0;
  }
};
