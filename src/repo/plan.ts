// What a plan to prepare a repo is made of, and the planning steps a recipe shares with the core:
// reading a file, owning one, and Tailwind's @source line. Planning only reads; applyPrep writes.
import fs from 'node:fs';
import path from 'node:path';
import { ROUGH_DIR } from './root.js';

export type PrepChange = {
  /** Repo-relative, forward slashes. */
  file: string;
  action: 'create' | 'edit';
  summary: string;
  /** The whole new content of the file. */
  after: string;
};

export type Planned = PrepChange | { manual: string } | null;

/** The line a file the studio owns carries, so it may be rewritten. */
export const OURS = 'Written by `roughbook init`';

export function read(repo: string, file: string): string | null {
  try {
    return fs.readFileSync(path.join(repo, file), 'utf8');
  } catch {
    return null;
  }
}

/** A file the studio owns: written when missing, rewritten when ours and different. */
export function ownFile(
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

/** A path pattern written any of the usual ways: "rough", "./rough", "rough/", "/rough/**". */
export function normalizePattern(entry: string): string {
  return entry
    .trim()
    .replace(/^\.?\//, '')
    .replace(/\/(\*\*(\/\*)?)?$/, '')
    .replace(/\/$/, '');
}

export function covers(entry: string, target: string): boolean {
  return normalizePattern(entry) === normalizePattern(target);
}

/** A list written one item per line gets the new item on its own line. */
export function afterComma(space: string): string {
  return space.includes('\n') ? space : ' ';
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
 * is left to the designer. `styleDirs` are the folders the app's stylesheets may be in.
 */
export function planTailwindSource(repo: string, styleDirs: string[]): Planned {
  const v3 = TAILWIND_CONFIGS.find(name => fs.existsSync(path.join(repo, name)));
  for (const file of styleDirs.flatMap(dir => cssFiles(path.join(repo, ...dir.split('/'))))) {
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
