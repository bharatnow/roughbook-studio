// The setup run's outputs outside rough/ are kept as templates in rough/setup/ and applied by the
// studio without an agent (ROUGHBOOK-FRAMEWORKS-PLAN.md, decision 28): `init` on a teammate's
// clone, `setup --apply` and `setup --upgrade` copy them into place; `roughbook uninstall` removes
// exactly them; doctor checks each is in place and matches. A whole file is copied as it is; a
// snippet is appended to a file the app already has (a line in a route file, an @source line in a
// stylesheet) and taken out again by its exact text.
import fs from 'node:fs';
import path from 'node:path';
import { SETUP_DIR } from '../environment/read.js';
import type { RepoEnvironment, SetupFile } from '../environment/types.js';
import { ROUGH_DIR } from './root.js';

/** Where a setup file's template lives: rough/setup/<path>, or <path>.snippet for a snippet. */
export function templatePath(file: SetupFile): string {
  return `${ROUGH_DIR}/${SETUP_DIR}/${file.path}${file.kind === 'snippet' ? '.snippet' : ''}`;
}

function disk(repoRoot: string, relative: string): string {
  return path.join(repoRoot, ...relative.split('/'));
}

function read(repoRoot: string, relative: string): string | null {
  try {
    return fs.readFileSync(disk(repoRoot, relative), 'utf8');
  } catch {
    return null;
  }
}

const normalize = (text: string) => text.replace(/\r\n/g, '\n');

/** A file's text with the snippet appended, on a line of its own, when it is not already there. */
export function withSnippet(current: string, snippet: string): string {
  const text = normalize(current);
  const piece = normalize(snippet).replace(/\n+$/, '');
  if (!piece.trim() || text.includes(piece)) return text;
  const joined = text.length && !text.endsWith('\n') ? `${text}\n` : text;
  return `${joined}${piece}\n`;
}

/** A file's text with the snippet taken out, with the line break that followed it. */
export function withoutSnippet(current: string, snippet: string): string {
  const text = normalize(current);
  const piece = normalize(snippet).replace(/\n+$/, '');
  if (!piece.trim()) return text;
  const at = text.indexOf(piece);
  if (at === -1) return text;
  const end = at + piece.length;
  return text.slice(0, at) + text.slice(text[end] === '\n' ? end + 1 : end);
}

export type SetupStep = {
  file: SetupFile;
  template: string;
  /** What applying does: writes the file, appends the snippet, leaves it as it is, or cannot. */
  action: 'create' | 'replace' | 'append' | 'unchanged' | 'cannot';
  /** Why it cannot, when it cannot. */
  reason: string | null;
};

/** What applying the templates to this repo would do, file by file, without writing anything. */
export function planSetup(repoRoot: string, environment: RepoEnvironment): SetupStep[] {
  return environment.setupFiles.map(file => {
    const template = templatePath(file);
    const content = read(repoRoot, template);
    const step = (action: SetupStep['action'], reason: string | null = null): SetupStep => ({
      file,
      template,
      action,
      reason
    });
    if (content === null)
      return step('cannot', `${template} is missing, so ${file.path} cannot be applied.`);
    const current = read(repoRoot, file.path);
    if (file.kind === 'snippet') {
      if (current === null) {
        return step(
          'cannot',
          `${file.path} does not exist, so the snippet has nothing to be added to.`
        );
      }
      return withSnippet(current, content) === normalize(current)
        ? step('unchanged')
        : step('append');
    }
    if (current === null) return step('create');
    return normalize(current) === normalize(content) ? step('unchanged') : step('replace');
  });
}

/** Writes what the plan says, and returns the files written. Steps that cannot be applied are skipped. */
export function applySetup(repoRoot: string, steps: SetupStep[]): string[] {
  const written: string[] = [];
  for (const step of steps) {
    if (step.action === 'unchanged' || step.action === 'cannot') continue;
    const template = read(repoRoot, step.template) ?? '';
    const target = disk(repoRoot, step.file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (step.file.kind === 'snippet') {
      fs.writeFileSync(target, withSnippet(read(repoRoot, step.file.path) ?? '', template));
    } else {
      fs.writeFileSync(target, template);
    }
    written.push(step.file.path);
  }
  return written;
}

/** Each listed file in place and matching its template; the problems, or none. */
export function checkSetupFiles(repoRoot: string, environment: RepoEnvironment): string[] {
  const problems: string[] = [];
  for (const step of planSetup(repoRoot, environment)) {
    if (step.action === 'unchanged') continue;
    if (step.action === 'cannot') problems.push(step.reason!);
    else if (step.action === 'create') {
      problems.push(`${step.file.path} is listed in setupFiles but is not in the repo.`);
    } else if (step.action === 'append') {
      problems.push(`${step.file.path} does not hold its snippet from ${step.template}.`);
    } else problems.push(`${step.file.path} differs from its template ${step.template}.`);
  }
  for (const orphan of orphanTemplates(repoRoot, environment)) {
    problems.push(`${orphan} is a template no setupFiles entry names.`);
  }
  return problems;
}

/**
 * Templates under rough/setup/ that no setupFiles entry names, repo-relative. The sample
 * iterations doctor renders (rough/setup/sample/) are not templates and are left out.
 */
export function orphanTemplates(repoRoot: string, environment: RepoEnvironment): string[] {
  const root = disk(repoRoot, `${ROUGH_DIR}/${SETUP_DIR}`);
  if (!fs.existsSync(root)) return [];
  const listed = new Set(environment.setupFiles.map(templatePath));
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (dir === root && entry.isDirectory() && entry.name === 'sample') continue;
      if (entry.isDirectory()) walk(full);
      else {
        const relative = path.relative(repoRoot, full).split(path.sep).join('/');
        if (!listed.has(relative)) found.push(relative);
      }
    }
  };
  walk(root);
  return found.sort();
}

export type Removal = { removed: string[]; kept: string[] };

/**
 * `roughbook uninstall`: takes every listed file out of the repo (a whole file is deleted, a
 * snippet is taken out of its file) and nothing else. The templates stay in rough/setup/.
 */
export function removeSetup(repoRoot: string, environment: RepoEnvironment): Removal {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const file of environment.setupFiles) {
    const current = read(repoRoot, file.path);
    if (current === null) {
      kept.push(`${file.path} was not in the repo.`);
      continue;
    }
    if (file.kind === 'snippet') {
      const template = read(repoRoot, templatePath(file));
      if (template === null) {
        kept.push(`${file.path}: its snippet template is missing, so nothing was taken out.`);
        continue;
      }
      const after = withoutSnippet(current, template);
      if (after === normalize(current)) kept.push(`${file.path} did not hold its snippet.`);
      else {
        fs.writeFileSync(disk(repoRoot, file.path), after);
        removed.push(`the snippet in ${file.path}`);
      }
      continue;
    }
    fs.rmSync(disk(repoRoot, file.path), { force: true });
    removed.push(file.path);
    // Folders the setup made and left empty go too, up to the repo.
    let dir = path.dirname(disk(repoRoot, file.path));
    while (dir !== repoRoot && dir.startsWith(repoRoot) && fs.existsSync(dir)) {
      if (fs.readdirSync(dir).length) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }
  return { removed, kept };
}
