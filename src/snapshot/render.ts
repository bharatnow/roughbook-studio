// Snapshot mode's renderer: runs the environment's snapshot command for the keys whose files
// changed since their images were made, and reads what came of each (rough/CONTRACT.md, the
// snapshot contract). The images are the iteration's screenshots, at the same paths, so the frame,
// the canvas's cards and doctor read them as they read screenshots. The caller queues the work on
// the repo (decision 36): this never waits on the queue itself.
import fs from 'node:fs';
import path from 'node:path';
import type { RepoEnvironment, Shell } from '../environment/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { runCapture } from '../launch/processes.js';
import { syncIterations } from '../repo/mirror.js';
import { ROUGH_DIR, statePath } from '../repo/root.js';
import { SHOTS_MANIFEST, iterationHash, screenshotPath } from '../screenshot/iteration.js';
import {
  REQUEST_FILE,
  RESULT_FILE,
  SNAPSHOT_VARIABLES,
  commandFor,
  outputTail,
  parseResultFile,
  parseSnapshotOutput,
  shotsVariable,
  snapshotShots,
  type KeyState,
  type Said
} from './contract.js';

/** Runs the command with the contract's variables, to its end: replaced in tests. */
export type SnapshotExec = (
  command: string,
  cwd: string,
  timeoutMs: number,
  shell: Shell,
  env: Record<string, string>
) => Promise<{ code: number | null; output: string }>;

export const runSnapshotCommand: SnapshotExec = runCapture;

export type KeyResult = {
  state: KeyState;
  /** Why it failed or is missing, in the command's words where it gave some. */
  message: string | null;
  /** Its images by shot name, repo-relative; only those there are. */
  files: Record<string, string>;
  /** The command said what came of it, in a line or in result.txt. */
  said: boolean;
};

export type SnapshotRun = {
  /** The keys the command was asked for: those whose files changed, or every key with `force`. */
  asked: string[];
  /** The keys left alone, their images already of their files as they are. */
  unchanged: string[];
  results: Record<string, KeyResult>;
  /** The command's exit code; null when it timed out, or when nothing needed rendering. */
  code: number | null;
  /** What the command printed last. */
  tail: string;
  /** How long the command took, in milliseconds; 0 when it did not run. */
  ms: number;
};

export type RenderOptions = {
  exec?: SnapshotExec;
  /** Render every key given, changed or not. */
  force?: boolean;
  now?: () => number;
};

type Manifest = { hash: string; files: Record<string, string> };

type Target = { page: string; component: string; iteration: string };

function target(key: string): Target {
  const [page, component, iteration] = key.split('/') as [string, string, string];
  return { page, component, iteration };
}

function keyDir(repoRoot: string, key: string): string {
  return path.join(repoRoot, ROUGH_DIR, '.screenshots', ...key.split('/'));
}

function disk(repoRoot: string, relative: string): string {
  return path.join(repoRoot, ...relative.split('/'));
}

/** Where the stack sees the iterations: the in-tree mirror, or rough/ itself. */
export function iterationsRoot(repoRoot: string, environment: RepoEnvironment): string {
  return environment.placement.kind === 'in-tree'
    ? disk(repoRoot, environment.placement.path)
    : path.join(repoRoot, ROUGH_DIR);
}

/** When each of a key's images was last written, by shot name; the ones not there are left out. */
function stamps(repoRoot: string, key: string, names: string[]): Map<string, number> {
  const { page, component, iteration } = target(key);
  const found = new Map<string, number>();
  for (const name of names) {
    try {
      const stat = fs.statSync(disk(repoRoot, screenshotPath(page, component, iteration, name)));
      if (stat.isFile() && stat.size > 0) found.set(name, stat.mtimeMs);
    } catch {
      // Not there.
    }
  }
  return found;
}

/**
 * The images a key has now, by shot name; with `before`, only those written since: new, or
 * written again (another modification time), so an image left from an earlier render never
 * counts as this one's.
 */
function imagesOf(
  repoRoot: string,
  key: string,
  names: string[],
  before?: Map<string, number>
): Record<string, string> {
  const { page, component, iteration } = target(key);
  const files: Record<string, string> = {};
  for (const [name, at] of stamps(repoRoot, key, names)) {
    if (before && before.get(name) === at) continue;
    files[name] = screenshotPath(page, component, iteration, name);
  }
  return files;
}

/**
 * Renders the keys' images through the snapshot command: only the keys whose files changed since
 * their images were last made (each iteration's hash beside its images, as screenshots keep it),
 * unless `force`. The mirror and the recipe's setup are brought up to date first, the request is
 * written, and each key's result is read from the command's lines, then its result.txt, then its
 * images; a key the command says nothing of has rendered only if every image is new.
 */
export async function renderSnapshots(
  repoRoot: string,
  environment: RepoEnvironment,
  keys: string[],
  options: RenderOptions = {}
): Promise<SnapshotRun> {
  const command = environment.snapshot;
  if (!command) {
    throw new Error(
      `${ROUGH_DIR}/environment.md names no snapshot command, so nothing can render the images.`
    );
  }
  const now = options.now ?? (() => Date.now());
  const shots = snapshotShots(environment);
  const names = shots.map(shot => shot.name);
  const results: Record<string, KeyResult> = {};
  const asked: string[] = [];
  const unchanged: string[] = [];
  const hashes = new Map<string, string | null>();
  for (const key of [...new Set(keys)]) {
    const hash = iterationHash(repoRoot, target(key), environment);
    hashes.set(key, hash);
    const manifest = hash
      ? await readJson<Manifest>(path.join(keyDir(repoRoot, key), SHOTS_MANIFEST))
      : null;
    const present =
      manifest &&
      Object.values(manifest.files).every(file => fs.existsSync(disk(repoRoot, file))) &&
      Object.keys(manifest.files).length === names.length;
    if (!options.force && manifest && manifest.hash === hash && present) {
      unchanged.push(key);
      results[key] = { state: 'ready', message: null, files: manifest.files, said: false };
    } else asked.push(key);
  }
  if (!asked.length) return { asked, unchanged, results, code: null, tail: '', ms: 0 };

  syncIterations(repoRoot, environment);
  const out = path.join(repoRoot, ROUGH_DIR, '.screenshots');
  const before = new Map<string, Map<string, number>>();
  for (const key of asked) {
    fs.mkdirSync(keyDir(repoRoot, key), { recursive: true });
    fs.rmSync(path.join(keyDir(repoRoot, key), RESULT_FILE), { force: true });
    before.set(key, stamps(repoRoot, key, names));
  }
  const iterations = iterationsRoot(repoRoot, environment);
  const requestFile = statePath(repoRoot, REQUEST_FILE);
  fs.mkdirSync(path.dirname(requestFile), { recursive: true });
  await writeJsonAtomic(requestFile, {
    contract: 1,
    keys: asked,
    out,
    iterations,
    fixture: environment.fixture,
    shots: shots.map(shot => ({
      name: shot.name,
      width: shot.viewport.width,
      height: shot.viewport.height,
      mobile: shot.viewport.mobile,
      variant: shot.variant
    }))
  });
  const startedAt = now();
  const ran = await (options.exec ?? runSnapshotCommand)(
    commandFor(command, asked),
    repoRoot,
    environment.timeouts.preview * 1000,
    environment.shell,
    {
      [SNAPSHOT_VARIABLES.keys]: asked.join(','),
      [SNAPSHOT_VARIABLES.out]: out,
      [SNAPSHOT_VARIABLES.shots]: shotsVariable(shots),
      [SNAPSHOT_VARIABLES.request]: requestFile,
      [SNAPSHOT_VARIABLES.iterations]: iterations,
      [SNAPSHOT_VARIABLES.fixture]: environment.fixture ?? '',
      // Where the app's dev server answers, for a command that renders through it on a device.
      [SNAPSHOT_VARIABLES.devUrl]: environment.start.url
    }
  );
  const ms = Math.max(0, now() - startedAt);
  const said = parseSnapshotOutput(ran.output);
  const tail = outputTail(ran.output);
  for (const key of asked) {
    let word: Said | null = said.get(key) ?? null;
    if (!word) {
      try {
        word = parseResultFile(
          fs.readFileSync(path.join(keyDir(repoRoot, key), RESULT_FILE), 'utf8')
        );
      } catch {
        word = null;
      }
    }
    const fresh = imagesOf(repoRoot, key, names, before.get(key));
    const all = Object.keys(fresh).length === names.length;
    const missingShots = names.filter(name => !fresh[name]);
    let result: KeyResult;
    if (word?.state === 'missing') {
      result = {
        state: 'missing',
        message: word.message ?? `There is no iteration ${key} for the snapshot command to render.`,
        files: {},
        said: true
      };
    } else if (word?.state === 'failed') {
      result = {
        state: 'failed',
        message: word.message ?? 'The snapshot command could not render it.',
        files: imagesOf(repoRoot, key, names),
        said: true
      };
    } else if (all) {
      result = { state: 'ready', message: null, files: fresh, said: word !== null };
    } else {
      const why =
        ran.code === null
          ? `The snapshot command did not finish within ${environment.timeouts.preview} s.`
          : word?.state === 'ready'
            ? `The snapshot command said it rendered ${key} but wrote no image for ${missingShots.join(', ')}.`
            : ran.code !== 0
              ? `The snapshot command failed (exit ${ran.code})${tail ? `: ${tail}` : '.'}`
              : `The snapshot command wrote no image for ${missingShots.join(', ')}.`;
      result = {
        state: 'failed',
        message: why,
        files: imagesOf(repoRoot, key, names),
        said: word !== null
      };
    }
    results[key] = result;
    const manifestFile = path.join(keyDir(repoRoot, key), SHOTS_MANIFEST);
    const hash = hashes.get(key);
    if (result.state === 'ready' && hash) {
      await writeJsonAtomic(manifestFile, { hash, files: result.files } satisfies Manifest);
    } else {
      // Rendered again next time: what is on disk is not of the files as they are.
      fs.rmSync(manifestFile, { force: true });
    }
  }
  return { asked, unchanged, results, code: ran.code, tail, ms };
}

/** A key's last result in words, for a warning: null when it rendered. */
export function describeResult(key: string, result: KeyResult): string | null {
  if (result.state === 'ready') return null;
  return result.state === 'missing'
    ? `${key}: missing. ${result.message ?? ''}`.trim()
    : `${key}: ${result.message ?? 'not rendered.'}`;
}
