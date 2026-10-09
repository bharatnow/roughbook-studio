// Prepares a repo for the studio: a rough/ workspace that TypeScript and ESLint ignore, so an
// iteration can never break the app's build; the development-only preview route; and git told
// what to keep. Planning only reads; applying writes exactly what the plan showed, so `init` can
// show every change first. Ported from roughbook src/lib/delivery/init.ts (v2-local), which kept
// rough/ out of git; now committing it is the default, since git is its only record.
import fs from 'node:fs';
import path from 'node:path';
import { renderRepoLink, type RepoLink } from './link.js';
import {
  PREVIEW_WRAPPER,
  REGISTRY_FILE,
  detectAppDir,
  isOurPreviewFile,
  listIterations,
  previewRouteDir,
  previewRouteFiles,
  renderPreviewRegistry
} from './preview.js';
import { LINK_FILE, ROUGH_DIR, STATE_DIR, isHomeOrAbove } from './root.js';

export type PrepChange = {
  /** Repo-relative, forward slashes. */
  file: string;
  action: 'create' | 'edit';
  summary: string;
  /** The whole new content of the file. */
  after: string;
};

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

type Planned = PrepChange | { manual: string } | null;

const GITIGNORE_HEADER = '# Roughbook';
const OLD_GITIGNORE_HEADER = '# Roughbook (local only)';
const OURS = 'Written by `roughbook init`';

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

/** The iteration rules every agent reads when it works in rough/, whichever agent it is. */
export const ROUGH_AGENTS = `# Working in rough/

This folder is Roughbook's design workspace. Each iteration is a folder
\`<page>/<component>/iteration-NN/\` whose \`index.tsx\` default-exports the design.
Each run's instructions are in \`<page>/<component>/prompts/\`.

Rules for any agent working here:

- Write only inside the iteration folder your instructions name.
- Never edit an existing iteration. A new idea is a new iteration, and a change
  to one is a fork or refinement that Roughbook creates for you.
- An iteration never imports from another iteration. It may import the app's
  own components, styles and utilities.
- Nothing outside rough/ imports from rough/.
- Do not install dependencies, change the app's configuration, or commit.

${OURS}; it rewrites this file.
`;

/** Claude Code reads CLAUDE.md, so it points at the same rules. */
export const ROUGH_CLAUDE = '@AGENTS.md\n';

/**
 * The app's tsconfig excludes rough/, so an editor would check an iteration alone: without the
 * app's paths such as `@/`, and from TypeScript 6 without @types. This one extends the app's and
 * takes Next.js's types from next-env.d.ts; `tsc` and `next build` read only the app's own, so
 * the build still never sees rough/. An app's tsconfig is usually incremental, so a `tsc -p rough`
 * (an agent checking its work) would leave build info in rough/, which is committed; it goes to
 * the state folder, which is not.
 */
export const ROUGH_TSCONFIG = `// ${OURS}; it rewrites this file. The app's tsconfig.json excludes rough/,
// so iterations never fail its build; this one lets editors check them with the app's settings.
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "tsBuildInfoFile": "${STATE_DIR}/tsconfig.tsbuildinfo" },
  "include": ["../next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": []
}
`;

/** Why a folder cannot be prepared, or nothing. */
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
  if (!fs.existsSync(path.join(repo, 'package.json'))) {
    return ['This folder has no package.json, so it is not an app the studio can work in.'];
  }
  return [];
}

function read(repo: string, file: string): string | null {
  try {
    return fs.readFileSync(path.join(repo, file), 'utf8');
  } catch {
    return null;
  }
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

/** A path pattern written any of the usual ways: "rough", "./rough", "rough/", "/rough/**". */
function normalizePattern(entry: string): string {
  return entry
    .trim()
    .replace(/^\.?\//, '')
    .replace(/\/(\*\*(\/\*)?)?$/, '')
    .replace(/\/$/, '');
}

function covers(entry: string, target: string): boolean {
  return normalizePattern(entry) === normalizePattern(target);
}

/** A list written one item per line gets the new item on its own line. */
function afterComma(space: string): string {
  return space.includes('\n') ? space : ' ';
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
      !(ignoresRough && normalizePattern(entry).startsWith(`${ROUGH_DIR}/`))
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

const TAILWIND_IMPORT = /^\s*@import\s+["']tailwindcss["'][^;\n]*;?[^\n]*$/m;
const TAILWIND_CONFIGS = [
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.mjs',
  'tailwind.config.cjs'
];

function cssFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : cssFiles(full);
    }
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

/**
 * Tailwind v4 finds classes by scanning the repo and skips gitignored folders, so classes used
 * only in an ignored rough/ would never be generated. One @source line in the stylesheet that
 * imports Tailwind fixes that, committed or not. Tailwind v3 is configured in JavaScript, so that
 * is left to the designer.
 */
export function planTailwindSource(repo: string, appDir: string): Planned {
  const v3 = TAILWIND_CONFIGS.find(name => fs.existsSync(path.join(repo, name)));
  for (const file of [
    ...cssFiles(path.join(repo, appDir)),
    ...cssFiles(path.join(repo, 'src', 'styles')),
    ...cssFiles(path.join(repo, 'styles'))
  ]) {
    const text = fs.readFileSync(file, 'utf8');
    const match = TAILWIND_IMPORT.exec(text);
    if (!match) continue;
    const toRough = path
      .relative(path.dirname(file), path.join(repo, ROUGH_DIR))
      .split(path.sep)
      .join('/');
    const escaped = toRough.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`@source\\s+["']${escaped}`).test(text)) return null;
    const end = match.index + match[0].length;
    return {
      file: path.relative(repo, file).split(path.sep).join('/'),
      action: 'edit',
      summary: `Let Tailwind generate the classes used in ${ROUGH_DIR}/.`,
      after: `${text.slice(0, end)}\n@source "${toRough}";${text.slice(end)}`
    };
  }
  if (v3) {
    return {
      manual: `Add "./${ROUGH_DIR}/**/*.{ts,tsx}" to "content" in ${v3}, so previews are styled.`
    };
  }
  return null;
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

/** A file the studio owns: written when missing, rewritten when ours and different. */
function ownFile(
  repo: string,
  file: string,
  content: string,
  summary: string,
  isOurs: (text: string) => boolean
): Planned {
  const current = read(repo, file);
  if (current === content) return null;
  if (current === null) return { file, action: 'create', summary, after: content };
  if (!isOurs(current))
    return { manual: `${file} exists and was not written by Roughbook, so it was left alone.` };
  return { file, action: 'edit', summary, after: content };
}

export type PrepOptions = {
  /** The link written to rough/roughbook.json; its appDir is filled in here. */
  link: Omit<RepoLink, 'appDir'>;
};

export function planPrep(repo: string, options: PrepOptions): PrepPlan {
  const problems = checkRepo(repo);
  if (problems.length) return { repo, problems, changes: [], manual: [], before: {} };
  const root = path.resolve(repo);
  const committed = options.link.roughCommitted;
  const changes: PrepChange[] = [];
  const manual: string[] = [];
  const add = (result: Planned) => {
    if (!result) return;
    if ('manual' in result) manual.push(result.manual);
    else changes.push(result);
  };
  const appDir = detectAppDir(root);
  const link: RepoLink = { ...options.link, appDir };

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
      ROUGH_AGENTS,
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

  const ignoredFromBuild = [ROUGH_DIR];
  const gitWanted = committed
    ? [
        `/${ROUGH_DIR}/${STATE_DIR}/`,
        `/${ROUGH_DIR}/.screenshots/`,
        `/${ROUGH_DIR}/${REGISTRY_FILE}`
      ]
    : [`/${ROUGH_DIR}/`];
  if (!appDir) {
    manual.push(
      'No App Router folder (app/ or src/app/) was found, so previews cannot render through this app. They need the Next.js App Router.'
    );
  } else {
    const routeDir = previewRouteDir(appDir);
    ignoredFromBuild.push(routeDir);
    gitWanted.push(`/${routeDir}/`);
    for (const route of previewRouteFiles(appDir)) {
      const current = read(root, route.file);
      if (current === route.content) continue;
      if (current !== null && !isOurPreviewFile(current)) {
        manual.push(`${route.file} exists and was not written by Roughbook, so it was left alone.`);
        continue;
      }
      changes.push({
        file: route.file,
        action: current === null ? 'create' : 'edit',
        summary:
          current === null
            ? 'Add the development-only preview route.'
            : 'Update the preview route.',
        after: route.content
      });
    }
    if (read(root, `${ROUGH_DIR}/preview.tsx`) === null) {
      changes.push({
        file: `${ROUGH_DIR}/preview.tsx`,
        action: 'create',
        summary: "Add the wrapper for the app's providers.",
        after: PREVIEW_WRAPPER
      });
    }
    add(planTailwindSource(root, appDir));
    if (read(root, `${ROUGH_DIR}/${REGISTRY_FILE}`) === null) {
      changes.push({
        file: `${ROUGH_DIR}/${REGISTRY_FILE}`,
        action: 'create',
        summary: 'Add the registry of iterations the route can render.',
        after: renderPreviewRegistry(listIterations(root))
      });
    }
  }
  add(planGitignore(read(root, '.gitignore'), gitWanted, committed ? [ROUGH_DIR] : []));
  add(planTsconfig(read(root, 'tsconfig.json'), ignoredFromBuild));
  if (read(root, 'tsconfig.json') !== null) {
    add(
      ownFile(
        root,
        `${ROUGH_DIR}/tsconfig.json`,
        ROUGH_TSCONFIG,
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
