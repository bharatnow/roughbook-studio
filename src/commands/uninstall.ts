import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ENVIRONMENT_FILE, readEnvironment } from '../environment/read.js';
import { confirm } from '../io.js';
import { recipeFor } from '../recipes/index.js';
import { requireRepoLink } from '../repo/link.js';
import { ROUGH_DIR } from '../repo/root.js';
import { removeSetup } from '../repo/setup.js';
import type { Command } from './context.js';

/**
 * `roughbook uninstall`: takes the preview setup out of the app and nothing else (decision 28):
 * every file setupFiles lists (a whole file deleted, a snippet taken out of its file), and a
 * recipe's own route files and generated files. rough/ stays, since it is the record of the
 * iterations; so do the lines init added to .gitignore, tsconfig and ESLint, which are named for
 * the designer to remove by hand.
 */
export const uninstall: Command = {
  name: 'uninstall',
  summary: 'Remove the preview setup from the app, and nothing else; rough/ stays',
  usage: 'uninstall [--yes]',
  needsRepo: true,
  async run(args, context) {
    const { io } = context;
    const { values } = parseArgs({
      args,
      options: { yes: { type: 'boolean', short: 'y', default: false } }
    });
    const repoRoot = context.repoRoot!;
    const link = await requireRepoLink(repoRoot);
    const environment = await readEnvironment(repoRoot, link);
    const recipe = recipeFor(environment.recipe);
    const recipeFiles = recipe
      ? [...recipe.setupFiles(repoRoot, link), ...recipe.generatedFiles].filter(file =>
          fs.existsSync(path.join(repoRoot, ...file.split('/')))
        )
      : [];
    const listed = environment.setupFiles.map(file =>
      file.kind === 'snippet' ? `the snippet in ${file.path}` : file.path
    );
    if (!listed.length && !recipeFiles.length) {
      io.out(
        `Nothing to remove: ${ROUGH_DIR}/${ENVIRONMENT_FILE} lists no setup files, and no recipe files are here.`
      );
      return 0;
    }
    io.out('This removes the preview setup from the app:');
    for (const item of [...listed, ...recipeFiles]) io.out(`  - ${item}`);
    io.out(
      `${ROUGH_DIR}/ stays (it is the record of the iterations), and so do the lines roughbook init added to .gitignore, tsconfig and ESLint; remove those by hand if you want them gone.`
    );
    if (!values.yes && !(await confirm(io, 'Remove them?', false))) {
      io.out('Nothing was removed.');
      return 0;
    }
    const removal = removeSetup(repoRoot, environment);
    for (const file of recipeFiles) {
      fs.rmSync(path.join(repoRoot, ...file.split('/')), { force: true });
      removal.removed.push(file);
      let dir = path.dirname(path.join(repoRoot, ...file.split('/')));
      while (dir !== repoRoot && dir.startsWith(repoRoot) && fs.existsSync(dir)) {
        if (fs.readdirSync(dir).length) break;
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      }
    }
    for (const item of removal.removed) io.out(`  removed ${item}`);
    for (const item of removal.kept) io.out(`  ! ${item}`);
    io.out(
      `Removed ${removal.removed.length} item${removal.removed.length === 1 ? '' : 's'}. Run roughbook setup --apply (or roughbook init) to put the setup back.`
    );
    return 0;
  }
};
