import { parseArgs } from 'node:util';
import { putBack } from '../runs/lifecycle.js';
import { listRuns } from '../runs/store.js';
import type { Command } from './context.js';
import { parseIteration } from './shared.js';

const SAID = {
  restored: 'Put back as it was before the run.',
  removed: 'Removed: the run created it.',
  unchanged: 'Already as it was before the run.',
  cannot: 'Cannot put it back: the studio kept no copy of it. Restore it from git or your editor.'
} as const;

export const revert: Command = {
  name: 'revert',
  summary: 'Put back a file a run changed outside its iteration',
  usage: 'revert <page>/<component>/<iteration> <file>',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
    const target = parseIteration(positionals[0]);
    const file = (positionals[1] ?? '').replace(/\\/g, '/');
    if (!file) throw new Error('Name the file to put back, as roughbook done listed it.');

    const run = (await listRuns(context.repoRoot!)).find(
      item =>
        item.page === target.page &&
        item.component === target.component &&
        item.iteration === target.iteration &&
        item.status === 'finished'
    );
    if (!run) {
      throw new Error(`No finished run made ${positionals[0]}. Run roughbook done first.`);
    }
    // Only what the run was flagged for: anything else is the designer's own work.
    if (!run.outOfScope.includes(file)) {
      throw new Error(`${file} is not among the files ${positionals[0]}'s run changed outside it.`);
    }
    const result = await putBack(context.repoRoot!, run, file);
    io.out(`${file}: ${SAID[result]}`);
    return result === 'cannot' ? 1 : 0;
  }
};
