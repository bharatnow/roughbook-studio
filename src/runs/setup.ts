// The setup run (ROUGHBOOK-FRAMEWORKS-PLAN.md, "The setup run"): the one run that writes outside
// rough/ and runs commands, in an interactive session the designer watches (decision 8). Its
// prompt comes from the backend with stand-ins the studio fills: the contract, the marker guess,
// the recipe's notes when one fits, and the repo's rule files (decision 15). It writes
// rough/environment.md, rough/setup/ and a sample iteration; it ends with `roughbook doctor`, run
// by the studio, and `setup --fix` starts it again with doctor's failures. Its record and its
// snapshot live in the state folder, so doctor can tell what it changed outside rough/.
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { ROUGH_CONTRACT } from '../doctor/contract.js';
import type { DoctorReport } from '../doctor/types.js';
import { ENVIRONMENT_FILE, SETUP_DIR } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { describeDetection, type Detected } from '../recipes/detect.js';
import type { Recipe } from '../recipes/types.js';
import { ROUGH_DIR, statePath } from '../repo/root.js';
import { assertRunId } from './store.js';
import type { RunAgent, RunMode } from './types.js';

export type SetupKind = 'setup' | 'fix';

/** `rough/.roughbook/setup/<id>.json`: one setup run, from start to the doctor that ends it. */
export type SetupRecord = {
  id: string;
  kind: SetupKind;
  agent: RunAgent;
  mode: RunMode;
  /** Repo-relative, forward slashes. */
  promptFile: string;
  startedAt: string;
  /** Set when doctor ran after it, with doctor's outcome. */
  finishedAt: string | null;
  doctor: DoctorReport['outcome'] | null;
};

/** The stand-ins the backend's setup prompt carries, filled here. */
export type SetupPlaceholders = {
  contract: string;
  guess: string;
  recipeNotes: string;
  ruleFiles: string;
};

export function newSetupId(): string {
  return randomUUID();
}

/** Where a setup run's prompt is kept, committed with rough/ like every other prompt. */
export function setupPromptFile(id: string): string {
  return `${ROUGH_DIR}/prompts/setup-${assertRunId(id)}.md`;
}

function recordFile(repoRoot: string, id: string): string {
  return statePath(repoRoot, 'setup', `${assertRunId(id)}.json`);
}

export async function saveSetup(repoRoot: string, record: SetupRecord): Promise<void> {
  await writeJsonAtomic(recordFile(repoRoot, record.id), record);
}

export async function readSetup(repoRoot: string, id: string): Promise<SetupRecord | null> {
  return readJson<SetupRecord>(recordFile(repoRoot, id));
}

/** Every setup run in this repo, newest first. */
export async function listSetups(repoRoot: string): Promise<SetupRecord[]> {
  let names: string[];
  try {
    names = await readdir(statePath(repoRoot, 'setup'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records = await Promise.all(
    names
      .filter(name => name.endsWith('.json'))
      .map(name => readJson<SetupRecord>(statePath(repoRoot, 'setup', name)))
  );
  return records
    .filter((record): record is SetupRecord => record !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The setup run doctor has not yet ended, if one is open. */
export async function openSetup(repoRoot: string): Promise<SetupRecord | null> {
  return (await listSetups(repoRoot)).find(record => record.finishedAt === null) ?? null;
}

/** The marker guess as the prompt tells it, from detection. */
export function guessText(detected: Detected): string {
  return describeDetection(detected).join('\n');
}

/** What the prompt says about recipes: the one that fits, or that none does. */
export function recipeNotesText(recipe: Recipe | null): string {
  return recipe
    ? recipe.setupNotes
    : 'No recipe fits this stack, so there is no ready-made preview setup to start from: build it from the contract and the example routes above, in this stack. The studio then has a verified setup, not a recipe, which is fine.';
}

export function ruleFilesText(ruleFiles: string[]): string {
  return ruleFiles.length
    ? `This repo already has agent rule files: ${ruleFiles.join(', ')}. Read them and respect them; never overwrite one. Add a short note about rough/ to the one your agent reads only if the repo's own rules would otherwise stop an agent from working in rough/.`
    : 'This repo has no agent rule file of its own; rough/AGENTS.md is the one agents read here.';
}

/** The backend's setup prompt with the studio's values where it left its stand-ins. */
export function fillSetupPrompt(
  prompt: string,
  placeholders: SetupPlaceholders,
  values: { guess: string; recipeNotes: string; ruleFiles: string; contract?: string }
): string {
  // Functions, so a "$" in a value is not read as a replacement pattern.
  return prompt
    .replaceAll(placeholders.contract, () => values.contract ?? ROUGH_CONTRACT.trim())
    .replaceAll(placeholders.guess, () => values.guess)
    .replaceAll(placeholders.recipeNotes, () => values.recipeNotes)
    .replaceAll(placeholders.ruleFiles, () => values.ruleFiles);
}

/**
 * How a setup run ends, added below the backend's prompt: the agent tells the designer, and the
 * studio runs doctor. Never finish_run: a setup run makes no iteration.
 */
export function setupFinishingSection(id: string): string {
  return `<finishing>
Roughbook setup run: ${assertRunId(id)}
This is a setup run, not an iteration: there is nothing to finish with the
roughbook MCP tools. When ${ROUGH_DIR}/${ENVIRONMENT_FILE}, ${ROUGH_DIR}/${SETUP_DIR}/ and the sample
iteration are written and the preview works in the running app, tell the
designer the setup is ready and list every file you changed outside ${ROUGH_DIR}/.
The designer then runs roughbook doctor, which checks the setup against the
contract and names what to fix; roughbook setup --fix brings its findings back
to you. Do not run roughbook doctor yourself.
</finishing>
`;
}

/** The checks doctor failed, as the `--fix` prompt lists them. */
export function fixSection(report: DoctorReport, environment: RepoEnvironment | null): string {
  const failed = report.checks.filter(check => check.status === 'fail');
  const lines = failed.map(
    (check, index) =>
      `${index + 1}. ${check.name} (${check.id}): ${check.detail}${check.fix ? `\n   Fix: ${check.fix}` : ''}`
  );
  const skipped = report.checks.filter(check => check.status === 'skip' && check.id !== 'speed');
  return `<fix>
roughbook doctor ran on this repo's setup and these checks failed${
    environment ? ` (${environment.mode} preview, gate: ${environment.gate})` : ''
  }:
${lines.join('\n')}
${
  skipped.length
    ? `\nNot checked until the failures above are fixed: ${skipped.map(check => check.id).join(', ')}.\n`
    : ''
}
Change the setup so every check passes: edit ${ROUGH_DIR}/${ENVIRONMENT_FILE}, the templates in
${ROUGH_DIR}/${SETUP_DIR}/ and the files they are applied to, and the sample iteration, keeping to
the contract. Keep every file you change outside ${ROUGH_DIR}/ listed in setupFiles with its
template. The designer runs roughbook doctor again when you say the fixes are in.
</fix>
`;
}
