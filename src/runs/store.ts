import { readdir } from 'node:fs/promises';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { statePath } from '../repo/root.js';
import type { RunRecord } from './types.js';

/** Run ids come from the backend; only a UUID becomes part of a file name. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function assertRunId(runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`Not a run id: ${runId}`);
  return runId;
}

function runFile(repoRoot: string, runId: string): string {
  return statePath(repoRoot, 'runs', `${assertRunId(runId)}.json`);
}

export async function saveRun(repoRoot: string, run: RunRecord): Promise<void> {
  await writeJsonAtomic(runFile(repoRoot, run.runId), run);
}

export async function readRun(repoRoot: string, runId: string): Promise<RunRecord | null> {
  return readJson<RunRecord>(runFile(repoRoot, runId));
}

/**
 * Whether `name` is this run: its id or the id's first eight characters, its iteration alone or
 * as <page>/<component>/<iteration>, or its folder or prompt file, relative or absolute. An agent
 * names a run by whatever it has in front of it.
 */
export function namesRun(run: RunRecord, name: string): boolean {
  const clean = name.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const isPath = (file: string) => clean === file || clean.endsWith(`/${file}`);
  return (
    run.runId === clean ||
    (clean.length >= 8 && run.runId.startsWith(clean)) ||
    run.iteration === clean ||
    `${run.page}/${run.component}/${run.iteration}` === clean ||
    isPath(run.targetFolder) ||
    isPath(run.promptFile)
  );
}

/** Every run in this repo, newest first. */
export async function listRuns(repoRoot: string): Promise<RunRecord[]> {
  let names: string[];
  try {
    names = await readdir(statePath(repoRoot, 'runs'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const runs = await Promise.all(
    names
      .filter(name => name.endsWith('.json') && RUN_ID.test(name.slice(0, -5)))
      .map(name => readRun(repoRoot, name.slice(0, -5)))
  );
  return runs
    .filter((run): run is RunRecord => run !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
