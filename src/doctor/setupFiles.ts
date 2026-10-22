// Doctor's check 8, the same in every mode: every file the setup wrote outside rough/ is listed
// with its template and matches it; a recipe's files are what it writes now; an in-tree mirror is
// never committed; and nothing else changed outside rough/ since the setup run started.
import fs from 'node:fs';
import path from 'node:path';
import type { RepoEnvironment } from '../environment/types.js';
import type { Recipe } from '../recipes/types.js';
import type { RepoLink } from '../repo/link.js';
import { covers, read } from '../repo/plan.js';
import { PREP_FILES, planPrep } from '../repo/prep.js';
import { ROUGH_DIR } from '../repo/root.js';
import { checkSetupFiles } from '../repo/setup.js';
import { openSetup } from '../runs/setup.js';
import { allChanged, compareFiles, hashRepo, ignored, readSnapshot } from '../runs/snapshot.js';
import { NAMES, result } from './checks.js';
import type { CheckId, CheckResult } from './types.js';

/** Manifests and lockfiles a dev dependency added with approval changes (decision 19). */
const MANIFESTS = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'composer.json',
  'composer.lock',
  'Gemfile',
  'Gemfile.lock',
  'pubspec.yaml',
  'pubspec.lock',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'uv.lock'
];

/**
 * Check 8: every file the setup wrote outside rough/ is listed with its template and matches it
 * (decision 28); a recipe's files are what the recipe writes now; an in-tree mirror is in
 * .gitignore (decision 25); and when a setup run is open, nothing else outside rough/ changed since
 * it started, besides init's own prep files and the manifests a dev dependency touches with
 * approval (decision 19).
 */
export async function setupFilesCheck(
  repoRoot: string,
  environment: RepoEnvironment,
  recipe: Recipe | null,
  link: RepoLink | null,
  names: Record<CheckId, string> = NAMES
): Promise<CheckResult> {
  const problems = checkSetupFiles(repoRoot, environment);
  const fixes: string[] = [];
  if (problems.length) {
    fixes.push(
      `Make each file in setupFiles match its template in ${ROUGH_DIR}/setup/ (roughbook setup --apply writes the templates into place), and list every template.`
    );
  }
  if (environment.placement.kind === 'in-tree') {
    const mirror = environment.placement.path;
    const gitignore = read(repoRoot, '.gitignore') ?? '';
    if (!gitignore.split(/\r?\n/).some(line => covers(line, mirror))) {
      problems.push(
        `The in-tree mirror ${mirror}/ is not in .gitignore, so the studio's copies of rough/ would be committed.`
      );
      fixes.push(`Run roughbook init again, which adds it, or add /${mirror}/ to .gitignore.`);
    }
  }
  let recipeFiles: string[] = [];
  if (recipe && link) {
    recipeFiles = recipe.setupFiles(repoRoot, link);
    const plan = planPrep(repoRoot, { link, recipe });
    const stale = plan.changes.filter(change => recipeFiles.includes(change.file));
    if (stale.length) {
      problems.push(
        `The ${recipe.name} recipe would write ${stale.map(change => change.file).join(', ')} differently now.`
      );
      fixes.push('Run roughbook setup --upgrade to bring the preview setup up to date.');
    }
  }
  const setup = await openSetup(repoRoot);
  const snapshot = setup ? await readSnapshot(repoRoot, setup.id) : null;
  if (snapshot) {
    const now = await hashRepo(repoRoot, environment.ignore);
    const listed = new Set([
      ...environment.setupFiles.map(file => file.path),
      ...recipeFiles,
      ...PREP_FILES,
      ...MANIFESTS
    ]);
    // The setup run wrote the environment, whose ignore list the snapshot before it did not have:
    // a file that only left the listing because the environment now ignores its folder, and is
    // still on disk, did not change.
    const unlisted = allChanged(compareFiles(snapshot.files, now.files)).filter(
      file =>
        !file.startsWith(`${ROUGH_DIR}/`) &&
        !listed.has(file) &&
        !(
          !(file in now.files) &&
          ignored(file, environment.ignore) &&
          fs.existsSync(path.join(repoRoot, ...file.split('/')))
        )
    );
    if (unlisted.length) {
      problems.push(
        `The setup run changed ${unlisted.length} file${unlisted.length === 1 ? '' : 's'} outside ${ROUGH_DIR}/ that setupFiles does not list: ${unlisted.slice(0, 5).join(', ')}${unlisted.length > 5 ? ', …' : ''}.`
      );
      fixes.push(
        `List each in setupFiles with its template in ${ROUGH_DIR}/setup/ (a whole file, or "<path> (snippet)" for lines added to a file the app has), or put it back (contract point 6).`
      );
    }
  }
  if (problems.length) {
    return result('setup-files', 'fail', problems.join(' '), fixes.join(' '), names);
  }
  const count = environment.setupFiles.length + recipeFiles.length;
  return result(
    'setup-files',
    'pass',
    count
      ? `${count} setup file${count === 1 ? '' : 's'} in place and matching${snapshot ? ', and nothing else changed outside rough/ since the setup run started' : ''}.`
      : `The setup writes nothing outside ${ROUGH_DIR}/.`,
    null,
    names
  );
}
