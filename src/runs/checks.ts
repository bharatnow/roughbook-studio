// The backend decides which checks a run's output must pass and sends them with the run; the
// studio applies them here, to the files on this machine. Ported from the backend's
// utils/compile/checks.ts (itself from roughbook runner/validate.ts, v2-local), with a code on
// every finding so the backend records codes, never sentences.
import fs from 'node:fs';
import path from 'node:path';
import { iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import { craftFloorFindings } from './craftFloor.js';
import { detectorFindings } from './detector.js';
import { isPlaceholder } from './placeholder.js';
import type { Check, Finding } from './types.js';

export type FolderFiles = Map<string, string>;

/** Whether a file has one of the extensions, given with their dots. */
export function hasExtension(file: string, extensions: string[]): boolean {
  const lower = file.toLowerCase();
  return extensions.some(extension => lower.endsWith(extension.toLowerCase()));
}

/**
 * The top-level files of a folder with the environment's source extensions, not meta.json; null
 * when the folder does not exist.
 */
export function readFolder(dir: string, sources: string[]): FolderFiles | null {
  if (!fs.existsSync(dir)) return null;
  const files: FolderFiles = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'meta.json' || !hasExtension(entry.name, sources))
      continue;
    files.set(entry.name, fs.readFileSync(path.join(dir, entry.name), 'utf8'));
  }
  return files;
}

/** Letters and digits only, lowercased, single-spaced: what a reader sees. */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether the headline can be found in the source, with JSX tags and string fragments stripped,
 * so a headline split across lines or wrapped in spans still counts. A miss is only a warning.
 */
export function headlineAppearsIn(source: string, headline: string): boolean {
  const wanted = normalizeForMatch(headline);
  if (!wanted) return true;
  const visible = source
    .replace(/<[^<>]*>/g, ' ')
    .replace(/\{\s*["'`]\s*["'`]\s*\}/g, ' ')
    .replace(/["'`{}]/g, ' ');
  return normalizeForMatch(visible).includes(wanted);
}

export type CheckSubject = {
  iterationId: string;
  files: FolderFiles | null;
  parentFiles?: FolderFiles | null;
};

export type CheckOutcome = { failure: Finding | null; warnings: Finding[] };

export function applyChecks(checks: Check[], subject: CheckSubject): CheckOutcome {
  const files = subject.files;
  if (!files) {
    return {
      failure: { code: 'TARGET_MISSING', message: 'The iteration folder does not exist.' },
      warnings: []
    };
  }
  for (const check of checks) {
    if (check.kind !== 'entry-file') continue;
    const entry = files.get(check.file);
    if (entry == null) {
      return {
        failure: { code: 'ENTRY_MISSING', message: `${check.file} was not created.` },
        warnings: []
      };
    }
    if (entry.length === 0) {
      return { failure: { code: 'ENTRY_EMPTY', message: `${check.file} is empty.` }, warnings: [] };
    }
    if (isPlaceholder(entry)) {
      return {
        failure: {
          code: 'PLACEHOLDER',
          message: `${check.file} is still the placeholder. Is the session finished?`
        },
        warnings: []
      };
    }
  }

  const warnings: Finding[] = [];
  for (const check of checks) {
    if (check.kind === 'changed-from-parent')
      warnings.push(...parentFindings(check.parent, subject));
  }
  const source = [...files.values()].join('\n');
  for (const check of checks) {
    if (check.kind === 'approved-headline' && !headlineAppearsIn(source, check.headline)) {
      warnings.push({
        code: 'APPROVED_HEADLINE_MISSING',
        message: `The approved headline (Version ${check.version}) does not appear in the source: "${check.headline}"`
      });
    }
  }
  if (checks.some(check => check.kind === 'craft-floor'))
    warnings.push(...craftFloorFindings(files));
  for (const check of checks) {
    if (check.kind === 'detector') warnings.push(...detectorFindings(files, check));
  }
  return { failure: null, warnings };
}

/** A child starts as a copy of its parent, so "the entry file exists" proves nothing about it. */
function parentFindings(parentId: string, subject: CheckSubject): Finding[] {
  const findings: Finding[] = [];
  const own = subject.files!;
  const foreign = new Set<string>();
  for (const text of own.values()) {
    for (const match of text.matchAll(/iteration-\d{2}/g)) {
      if (match[0] !== subject.iterationId) foreign.add(match[0]);
    }
  }
  if (foreign.has(parentId)) {
    findings.push({
      code: 'NAMES_PARENT',
      message: `The source still names ${parentId} as itself; ${subject.iterationId} should show its own identity.`
    });
  }
  const parent = subject.parentFiles;
  if (parent) {
    const same =
      own.size === parent.size && [...own].every(([name, text]) => parent.get(name) === text);
    if (same) {
      findings.push({
        code: 'UNCHANGED_FROM_PARENT',
        message: `Every file is identical to ${parentId}. The child was not changed from its parent.`
      });
    }
  }
  return findings;
}

const IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'`]([^"'`]+)["'`]/gm;

/**
 * Files outside rough/ that import from it: the app must never depend on a design reference. The
 * recipe's preview setup (`allowed` folders) is the one place allowed to, and only in development.
 * Only files with the environment's code extensions are read.
 */
export function importsFromRough(
  repoRoot: string,
  files: string[],
  allowed: string[],
  code: string[]
): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    if (!hasExtension(file, code) || file.startsWith(`${ROUGH_DIR}/`)) continue;
    if (allowed.some(folder => file.startsWith(`${folder}/`))) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(repoRoot, ...file.split('/')), 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(IMPORT)) {
      if (match[1]!.split('/').includes(ROUGH_DIR)) {
        offenders.push(file);
        break;
      }
    }
  }
  return offenders;
}

/** The backend's checks for one run, read from its folder and its parent's. */
export function checkIteration(
  repoRoot: string,
  run: {
    page: string;
    component: string;
    iteration: string;
    parent: string | null;
    checks: Check[];
  },
  sources: string[]
): CheckOutcome {
  const dir = (id: string) =>
    path.join(repoRoot, ...iterationDir(run.page, run.component, id).split('/'));
  return applyChecks(run.checks, {
    iterationId: run.iteration,
    files: readFolder(dir(run.iteration), sources),
    parentFiles: run.parent ? readFolder(dir(run.parent), sources) : null
  });
}
