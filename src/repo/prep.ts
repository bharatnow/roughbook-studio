// Prepares a repo for the studio: a rough/ workspace that TypeScript and ESLint ignore, so an
// iteration can never break the app's build; the recipe's development-only preview setup, when a
// recipe fits the stack; and git told what to keep. Planning only reads; applying writes exactly
// what the plan showed, so `init` can show every change first. Ported from roughbook
// src/lib/delivery/init.ts (v2-local), which kept rough/ out of git; now committing it is the
// default, since git is its only record. A repo no recipe fits (F3 of the frameworks plan) gets
// the workspace alone; its preview setup comes from the setup run.
import fs from 'node:fs';
import path from 'node:path';
import { ROUGH_CONTRACT } from '../doctor/contract.js';
import { bareEnvironment } from '../environment/bare.js';
import { ENVIRONMENT_FILE, hasEnvironmentFile, readEnvironmentSync } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { detectStack } from '../recipes/detect.js';
import { fallbackRecipe } from '../recipes/index.js';
import type { Recipe } from '../recipes/types.js';
import { renderRepoLink, type RepoLink } from './link.js';
import { OURS, afterComma, covers, ownFile, read, type Planned, type PrepChange } from './plan.js';
import { LINK_FILE, ROUGH_DIR, STATE_DIR, isHomeOrAbove, looksLikeApp } from './root.js';

export type { PrepChange } from './plan.js';

export type PrepPlan = {
  repo: string;
  /** Problems that stop anything from being written. */
  problems: string[];
  changes: PrepChange[];
  /** What the studio could not change safely, for the designer to do by hand. */
  manual: string[];
  /** Each edited file as it is now, for showing the edit. */
  before: Record<string, string>;
};

const GITIGNORE_HEADER = '# Roughbook';
const OLD_GITIGNORE_HEADER = '# Roughbook (local only)';

function readme(committed: boolean): string {
  return `# rough/

Roughbook's design workspace for this repo: design iterations, the prompts that
made them, and the link to this repo's Roughbook project (\`roughbook.json\`).

TypeScript and ESLint ignore this folder, so an iteration can never fail the
app's build, and nothing in the app imports from it. \`roughbook promote\` turns
a chosen iteration into a real component.

${
  committed
    ? `This folder is committed: git is the only record of these iterations, since
Roughbook's server keeps only their review decisions. Run state
(\`${STATE_DIR}/\`) and screenshots (\`.screenshots/\`) are not committed.`
    : `This folder is not committed (see .gitignore), so nothing backs these
iterations up. Run \`roughbook init\` again to commit it.`
}

${OURS}; it rewrites this file.
`;
}

/**
 * The iteration rules every agent reads when it works in rough/, whichever agent it is: the
 * rules every stack shares, with the recipe's own among them, or the environment's entry file
 * when the setup run wrote the environment instead of a recipe.
 */
export function roughAgents(environment: RepoEnvironment, recipe: Recipe | null): string {
  const entry = environment.entry
    ? `\`${environment.entry}\` default-exports the design`
    : `entry file (named by \`${ENVIRONMENT_FILE}\`, once the setup run has written it) holds the design`;
  const own = recipe
    ? recipe.agentRules(environment)
    : `- Read \`${ENVIRONMENT_FILE}\` in this folder first: it says how this repo's
  components, styles and tokens work, and what an iteration here must hold.
`;
  return `# Working in rough/

This folder is Roughbook's design workspace. Each iteration is a folder
\`<page>/<component>/iteration-NN/\` whose ${entry}.
Each run's instructions are in \`<page>/<component>/prompts/\`.

Rules for any agent working here:

- Write only inside the iteration folder your instructions name.
- Never edit an existing iteration. A new idea is a new iteration, and a change
  to one is a fork or refinement that Roughbook creates for you.
- An iteration never imports from another iteration. It may import the app's
  own components, styles and utilities.
- Nothing outside rough/ imports from rough/.
${own}- Do not install dependencies, change the app's configuration, or commit.

${OURS}; it rewrites this file.
`;
}

/** Claude Code reads CLAUDE.md, so it points at the same rules. */
export const ROUGH_CLAUDE = '@AGENTS.md\n';

/**
 * Why a folder cannot be prepared, or nothing. Any repo with git is one the studio can work in,
 * package.json or not; without git, a folder with a package.json or another project file.
 */
export function checkRepo(repo: string, home?: string): string[] {
  if (!path.isAbsolute(repo)) return ['The repo path must be absolute.'];
  if (isHomeOrAbove(repo, home)) {
    return ['That is your home folder, or contains it. Run roughbook init inside the app’s repo.'];
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(repo);
  } catch {
    return ['That folder does not exist.'];
  }
  if (!stat.isDirectory()) return ['That path is a file, not a folder.'];
  // A folder of pages with no manifest counts when init is run in it, not when found on the way up.
  if (!looksLikeApp(repo) && !detectStack(repo).isProject) {
    return [
      'This folder has no git repository, no package.json and no other project file, so it does not look like an app the studio can work in. Run git init in the app’s folder first, or run roughbook init from inside the app.'
    ];
  }
  return [];
}

/** JSON with comments and trailing commas, as tsconfig and .eslintrc allow, made parseable. */
export function stripJsonc(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function parseJsonc(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(stripJsonc(text));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Brings .gitignore to `wanted` (entries written as "/path/" or "/file") and takes out any line
 * in `unwanted`: a repo prepared before rough/ was committed ignores the whole folder.
 */
export function planGitignore(
  current: string | null,
  wanted: string[],
  unwanted: string[] = []
): PrepChange | null {
  const lines = (current ?? '').split(/\r?\n/);
  const kept = lines
    .filter(line => !unwanted.some(entry => covers(line, entry)))
    // v2's header said "local only", which is no longer true once rough/ is committed.
    .map(line => (line.trim() === OLD_GITIGNORE_HEADER ? GITIGNORE_HEADER : line));
  const removed = lines.length - kept.length;
  // Ignoring the whole of rough/ already covers what is inside it.
  const ignoresRough = kept.some(line => covers(line, ROUGH_DIR));
  const missing = wanted.filter(
    entry =>
      !kept.some(line => covers(line, entry)) &&
      !(ignoresRough && entry.replace(/^\/+/, '').startsWith(`${ROUGH_DIR}/`))
  );

  const body = kept.join('\n').replace(/\n*$/, '');
  let after = body ? `${body}\n` : '';
  if (missing.length) {
    const hasHeader = kept.some(line => line.trim() === GITIGNORE_HEADER);
    after = hasHeader
      ? `${body}\n${missing.join('\n')}\n`
      : `${body}${body ? '\n\n' : ''}${GITIGNORE_HEADER}\n${missing.join('\n')}\n`;
  }
  const renamed = lines.some(line => line.trim() === OLD_GITIGNORE_HEADER);
  if (!missing.length && !removed && !renamed) return null;
  const parts = [
    removed ? `stop ignoring ${ROUGH_DIR}/, so it is committed` : '',
    missing.length ? `ignore ${missing.join(', ')}` : ''
  ].filter(Boolean);
  return {
    file: '.gitignore',
    action: current === null ? 'create' : 'edit',
    summary: parts.length
      ? `${parts.join('; ').replace(/^./, char => char.toUpperCase())}.`
      : 'Rename the Roughbook section.',
    after
  };
}

/**
 * Adds folders to tsconfig's exclude with a small text edit, keeping the file's own formatting
 * and comments. A manual step when the edit cannot be made safely. An exclude that did not exist
 * gets node_modules too, since setting exclude replaces TypeScript's default of excluding it.
 */
export function planTsconfig(current: string | null, folders: string[]): Planned {
  if (current === null) return null;
  const list = (items: string[]) => items.map(item => JSON.stringify(item)).join(', ');
  const parsed = parseJsonc(current);
  if (!parsed) {
    return {
      manual: `tsconfig.json could not be read. Add ${list(folders)} to its "exclude" list by hand.`
    };
  }
  const exclude = Array.isArray(parsed.exclude) ? (parsed.exclude as unknown[]) : null;
  const missing = folders.filter(
    folder => !exclude?.some(item => typeof item === 'string' && covers(item, folder))
  );
  if (!missing.length) return null;

  const items = missing.map(folder => JSON.stringify(folder));
  let after: string;
  if (exclude) {
    after = current.replace(/("exclude"\s*:\s*\[)(\s*)/, (_match, open: string, space: string) =>
      exclude.length
        ? `${open}${space}${items.map(item => `${item},${afterComma(space)}`).join('')}`
        : `${open}${space}${items.join(', ')}`
    );
  } else {
    const end = current.lastIndexOf('}');
    if (end === -1) {
      return {
        manual: `Add "exclude": ["node_modules", ${list(missing)}] to tsconfig.json by hand.`
      };
    }
    const head = current.slice(0, end).replace(/\s*$/, '');
    const needsComma = !head.endsWith('{') && !head.endsWith(',');
    after = `${head}${needsComma ? ',' : ''}\n  "exclude": ["node_modules", ${items.join(', ')}]\n${current.slice(end)}`;
  }
  const check = parseJsonc(after);
  const ok =
    Array.isArray(check?.exclude) &&
    missing.every(folder => (check.exclude as unknown[]).includes(folder));
  if (!ok)
    return { manual: `Add ${list(missing)} to the "exclude" list in tsconfig.json by hand.` };
  return {
    file: 'tsconfig.json',
    action: 'edit',
    summary: `Exclude ${missing.map(folder => `${folder}/`).join(' and ')} from type checking, so an iteration can never fail the build.`,
    after
  };
}

const FLAT_CONFIGS = [
  'eslint.config.mjs',
  'eslint.config.js',
  'eslint.config.ts',
  'eslint.config.cjs'
];

export function planEslint(files: Record<string, string | null>): Planned {
  const flat = FLAT_CONFIGS.find(name => files[name] != null);
  if (flat) {
    const text = files[flat] as string;
    if (/["'`]\.?\/?rough\//.test(text)) return null;
    for (const anchor of [/(globalIgnores\(\s*\[)(\s*)/, /(ignores\s*:\s*\[)(\s*)/]) {
      if (anchor.test(text)) {
        return {
          file: flat,
          action: 'edit',
          summary: `Ignore ${ROUGH_DIR}/ in ESLint.`,
          after: text.replace(
            anchor,
            (_match, open: string, space: string) =>
              `${open}${space}"${ROUGH_DIR}/**",${afterComma(space)}`
          )
        };
      }
    }
    return { manual: `Add "${ROUGH_DIR}/**" to the ignores in ${flat} by hand.` };
  }
  const ignoreFile = files['.eslintignore'];
  if (ignoreFile != null) {
    if (/^\/?rough\/?(\*\*)?$/m.test(ignoreFile)) return null;
    return {
      file: '.eslintignore',
      action: 'edit',
      summary: `Ignore ${ROUGH_DIR}/ in ESLint.`,
      after: `${ignoreFile}${ignoreFile.endsWith('\n') || !ignoreFile ? '' : '\n'}${ROUGH_DIR}/\n`
    };
  }
  if (files['.eslintrc.json'] != null) {
    return { manual: `Add "${ROUGH_DIR}/**" to "ignorePatterns" in .eslintrc.json by hand.` };
  }
  return null;
}

/** The files `init`'s own prep may write or edit outside rough/, which no setup run has to list. */
export const PREP_FILES = ['.gitignore', 'tsconfig.json', '.eslintignore', ...FLAT_CONFIGS];

export type PrepOptions = {
  /** The link written to rough/roughbook.json; its appDir is filled in here. */
  link: Omit<RepoLink, 'appDir'>;
  /**
   * The stack's recipe: the fallback when not given (a repo prepared before detection), null
   * when no recipe fits and the setup run builds the preview (F3 of the frameworks plan).
   */
  recipe?: Recipe | null;
};

export function planPrep(repo: string, options: PrepOptions): PrepPlan {
  const problems = checkRepo(repo);
  if (problems.length) return { repo, problems, changes: [], manual: [], before: {} };
  const root = path.resolve(repo);
  const committed = options.link.roughCommitted;
  const recipe = options.recipe === undefined ? fallbackRecipe : options.recipe;
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  const add = (result: Planned) => {
    if (!result) return;
    if ('manual' in result) manual.push(result.manual);
    else changes.push(result);
  };
  const link: RepoLink = { ...options.link, appDir: recipe ? recipe.appDir(root) : null };
  // The environment file when the repo has one (a clone, or a setup run's work), else the recipe's
  // own; with neither, the bare environment of a repo whose setup run is still to come.
  const effective: RepoEnvironment = hasEnvironmentFile(root)
    ? readEnvironmentSync(root, link)
    : recipe
      ? recipe.environment(link)
      : bareEnvironment(link);

  add(
    ownFile(
      root,
      `${ROUGH_DIR}/README.md`,
      readme(committed),
      `Explain the ${ROUGH_DIR}/ workspace.`,
      // v2's README said the folder was never committed.
      text =>
        text.includes(OURS) || text.startsWith("# rough/\n\nRoughbook's local design workspace")
    )
  );
  add(
    ownFile(
      root,
      `${ROUGH_DIR}/AGENTS.md`,
      roughAgents(effective, recipe),
      'Give every agent the iteration rules.',
      text => text.includes(OURS)
    )
  );
  add(
    ownFile(
      root,
      `${ROUGH_DIR}/CLAUDE.md`,
      ROUGH_CLAUDE,
      'Point Claude Code at the same rules.',
      text => text.trim() === ROUGH_CLAUDE.trim()
    )
  );
  add(
    ownFile(
      root,
      `${ROUGH_DIR}/CONTRACT.md`,
      ROUGH_CONTRACT,
      'Write down what a preview must do, for the agent that sets one up.',
      text => text.includes(OURS)
    )
  );
  const linkFile = `${ROUGH_DIR}/${LINK_FILE}`;
  const linkText = renderRepoLink(link);
  const currentLink = read(root, linkFile);
  if (currentLink !== linkText) {
    changes.push({
      file: linkFile,
      action: currentLink === null ? 'create' : 'edit',
      summary: `Link this repo to the project ${link.project}.`,
      after: linkText
    });
  }

  const preview = recipe
    ? recipe.planPreview(root, link)
    : { changes: [], manual: [], ignoredFromBuild: [], gitWanted: [] };
  changes.push(...preview.changes);
  manual.push(...preview.manual);
  const ignoredFromBuild = [ROUGH_DIR, ...preview.ignoredFromBuild];
  const gitWanted = [
    ...(committed
      ? [`/${ROUGH_DIR}/${STATE_DIR}/`, `/${ROUGH_DIR}/.screenshots/`]
      : [`/${ROUGH_DIR}/`]),
    ...preview.gitWanted
  ];
  add(planGitignore(read(root, '.gitignore'), gitWanted, committed ? [ROUGH_DIR] : []));
  add(planTsconfig(read(root, 'tsconfig.json'), ignoredFromBuild));
  const roughTsconfig = recipe ? recipe.roughTsconfig(root) : null;
  if (roughTsconfig !== null) {
    add(
      ownFile(
        root,
        `${ROUGH_DIR}/tsconfig.json`,
        roughTsconfig,
        "Let editors check iterations with the app's TypeScript settings.",
        text => text.includes(OURS)
      )
    );
  }
  add(
    planEslint(
      Object.fromEntries(
        [...FLAT_CONFIGS, '.eslintignore', '.eslintrc.json'].map(name => [name, read(root, name)])
      )
    )
  );
  const before = Object.fromEntries(
    changes
      .filter(change => change.action === 'edit')
      .map(change => [change.file, read(root, change.file) ?? ''])
  );
  return { repo: root, problems, changes, manual, before };
}

/** Writes a plan. Each file is written whole, as the plan showed it, with `\n` line endings. */
export function applyPrep(plan: PrepPlan): void {
  if (plan.problems.length) throw new Error(plan.problems[0]);
  for (const change of plan.changes) {
    const file = path.join(plan.repo, ...change.file.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, change.after);
  }
}
