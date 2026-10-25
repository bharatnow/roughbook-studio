// The map run (decision 3 of the brownfield plan): an agent session, like the setup run, that
// reads the app the discoverers mapped, names and groups what they found, adds what they could not
// see, and writes fixtures, writing only rough/map.md and fixtures inside rough/. Its prompt comes
// from the backend with stand-ins the studio fills with what only this machine knows (the
// discoverers' findings, the fixture file, doctor's last word on the map); its record and its
// snapshot live in the state folder, so the next `roughbook map` can tell what it changed.
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import type { DoctorReport } from '../doctor/types.js';
import type { RepoEnvironment } from '../environment/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { ROUGH_DIR, statePath } from '../repo/root.js';
import { allChanged, compareFiles, hashRepo, readSnapshot } from '../runs/snapshot.js';
import { assertRunId } from '../runs/store.js';
import type { RunAgent, RunMode } from '../runs/types.js';
import { MAP_FILE, MAP_FIXTURES } from './file.js';
import { countMap } from './run.js';
import type { RepoMap } from './types.js';

/** `rough/.roughbook/map-runs/<id>.json`: one map run, from its start to the map that ends it. */
export type MapRunRecord = {
  id: string;
  agent: RunAgent;
  mode: RunMode;
  /** Repo-relative, forward slashes. */
  promptFile: string;
  startedAt: string;
  finishedAt: string | null;
};

/** The stand-ins the backend's map prompt carries, filled here. */
export type MapPlaceholders = {
  discovered: string;
  fixtureFile: string;
  guess: string;
  doctor: string;
};

export function newMapRunId(): string {
  return randomUUID();
}

export function mapPromptFile(id: string): string {
  return `${ROUGH_DIR}/prompts/map-${assertRunId(id)}.md`;
}

function recordFile(repoRoot: string, id: string): string {
  return statePath(repoRoot, 'map-runs', `${assertRunId(id)}.json`);
}

export async function saveMapRun(repoRoot: string, record: MapRunRecord): Promise<void> {
  await writeJsonAtomic(recordFile(repoRoot, record.id), record);
}

/** The map run not yet ended by a `roughbook map`, if one is open; the newest first. */
export async function openMapRun(repoRoot: string): Promise<MapRunRecord | null> {
  let names: string[];
  try {
    names = await readdir(statePath(repoRoot, 'map-runs'));
  } catch {
    return null;
  }
  const records = await Promise.all(
    names
      .filter(name => name.endsWith('.json'))
      .map(name => readJson<MapRunRecord>(statePath(repoRoot, 'map-runs', name)))
  );
  return (
    records
      .filter((record): record is MapRunRecord => record !== null && record.finishedAt === null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
  );
}

/** What the discoverers found, as the prompt tells the agent. */
export function discoveredText(map: RepoMap | null, by: string[]): string {
  if (!map) {
    return `No discoverer fits this stack, so ${ROUGH_DIR}/${MAP_FILE} does not exist yet: you write it, from the app's own routes, views and screens.`;
  }
  return `The studio's discoverers (${by.length ? by.join(', ') : 'none'}) wrote ${ROUGH_DIR}/${MAP_FILE}: ${countMap(map)}; ${map.missed.length} thing${map.missed.length === 1 ? '' : 's'} they could not place (missed) and ${map.unplaced.length} component file${map.unplaced.length === 1 ? '' : 's'} nothing renders (unplaced).`;
}

/** The fixture file the stack's previews read, as the prompt names it. */
export function fixtureFileText(environment: RepoEnvironment): string {
  return environment.fixture
    ? `${ROUGH_DIR}/${MAP_FIXTURES}/<component>/${environment.fixture}, in the format an iteration's ${environment.fixture} has in this repo (its inputs, which the preview passes in)`
    : "none: this stack's preview takes no fixture, so a component that needs inputs is marked alone: no with why";
}

/** What doctor last said of the map, from its report: its map checks' findings, or that it has not. */
export function doctorText(report: DoctorReport | null): string {
  const checks = report?.checks.filter(check => check.id.startsWith('map-')) ?? [];
  if (!checks.length) return 'roughbook doctor has not checked the map yet.';
  return checks
    .map(
      check =>
        `- ${check.name} (${check.status}): ${check.detail}${check.fix ? ` Fix: ${check.fix}` : ''}`
    )
    .join('\n');
}

/** The backend's map prompt with the studio's values where it left its stand-ins. */
export function fillMapPrompt(
  prompt: string,
  placeholders: MapPlaceholders,
  values: Record<keyof MapPlaceholders, string>
): string {
  // Functions, so a "$" in a value is not read as a replacement pattern.
  return prompt
    .replaceAll(placeholders.discovered, () => values.discovered)
    .replaceAll(placeholders.fixtureFile, () => values.fixtureFile)
    .replaceAll(placeholders.guess, () => values.guess)
    .replaceAll(placeholders.doctor, () => values.doctor);
}

/** How a map run ends, added below the backend's prompt. */
export function mapFinishingSection(id: string): string {
  return `<finishing>
Roughbook map run: ${assertRunId(id)}
This is a map run, not an iteration: there is nothing to finish with the
roughbook MCP tools. When ${ROUGH_DIR}/${MAP_FILE} and the fixtures are written, tell the
designer the map is ready and list the fixtures you wrote. The designer then runs
roughbook map, which keeps your work, and roughbook doctor, which renders every
section and shared part with its fixture. Do not run either yourself.
</finishing>
`;
}

/** Whether a file is one the map run may write: the map, and fixtures under rough/map/. */
export function mapRunMayWrite(file: string): boolean {
  return (
    file === `${ROUGH_DIR}/${MAP_FILE}` ||
    file.startsWith(`${ROUGH_DIR}/map/`) ||
    file.startsWith(`${ROUGH_DIR}/prompts/`) ||
    file.startsWith(`${ROUGH_DIR}/.roughbook/`)
  );
}

/** The files a map run changed that it should not have: anything but the map and its fixtures. */
export async function mapRunStrays(
  repoRoot: string,
  run: MapRunRecord,
  ignore: string[]
): Promise<string[] | null> {
  const snapshot = await readSnapshot(repoRoot, run.id);
  if (!snapshot) return null;
  const now = await hashRepo(repoRoot, ignore);
  return allChanged(compareFiles(snapshot.files, now.files)).filter(file => !mapRunMayWrite(file));
}
