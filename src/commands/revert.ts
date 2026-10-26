import { parseArgs } from 'node:util';
import { putBack } from '../runs/lifecycle.js';
import { listPromotions, putBackPromoted } from '../runs/promotion.js';
import { listRuns } from '../runs/store.js';
import type { Command } from './context.js';
import { parseIteration } from './shared.js';

const SAID = {
  restored: 'Put back as it was before the run.',
  removed: 'Removed: the run created it.',
  unchanged: 'Already as it was before the run.',
  cannot: 'Cannot put it back: the studio kept no copy of it. Restore it from git or your editor.'
} as const;

const SAID_PROMOTE = {
  restored: 'Put back as it was before the promote.',
  removed: 'Removed: the promote created it.',
  unchanged: 'Already as it was before the promote.',
  cannot: SAID.cannot
} as const;

export const revert: Command = {
  name: 'revert',
  summary: 'Put back a file a run changed outside its iteration, or one a promote changed',
  usage: 'revert <page>/<component>/<iteration> <file>',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
    const target = parseIteration(positionals[0]);
    const file = (positionals[1] ?? '').replace(/\\/g, '/');
    if (!file) throw new Error('Name the file to put back, as roughbook done listed it.');
    const repoRoot = context.repoRoot!;
    const same = (item: { page: string; component: string; iteration: string }) =>
      item.page === target.page &&
      item.component === target.component &&
      item.iteration === target.iteration;

    const runs = (await listRuns(repoRoot)).filter(
      item => same(item) && item.status === 'finished'
    );
    // Only what the run was flagged for: anything else is the designer's own work.
    const run = runs.find(item => item.outOfScope.includes(file));
    if (run) {
      const result = await putBack(repoRoot, run, file);
      io.out(`${file}: ${SAID[result]}`);
      return result === 'cannot' ? 1 : 0;
    }
    // A file a promote changed, in its scope or out of it, from its snapshot (B4).
    const promotions = (await listPromotions(repoRoot)).filter(
      item => same(item) && item.status === 'finished'
    );
    const promoted = promotions.find(item =>
      item.result?.changed.some(changed => changed.path === file)
    );
    if (promoted) {
      const result = await putBackPromoted(repoRoot, promoted, file);
      io.out(`${file}: ${SAID_PROMOTE[result]}`);
      return result === 'cannot' ? 1 : 0;
    }
    if (!runs.length && !promotions.length) {
      throw new Error(`No finished run made ${positionals[0]}. Run roughbook done first.`);
    }
    throw new Error(
      runs.length
        ? `${file} is not among the files ${positionals[0]}'s run changed outside it.`
        : `${file} is not among the files ${positionals[0]}'s promote changed.`
    );
  }
};
