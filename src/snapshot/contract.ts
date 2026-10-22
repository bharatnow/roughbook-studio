// The snapshot contract (rough/CONTRACT.md; ROUGHBOOK-FRAMEWORKS-PLAN.md, "The preview contract"):
// the environment's `snapshot` command renders the keys it is given to images, at each viewport in
// each variant, one image per shot under rough/.screenshots/<key>/, and says per key what came of
// it. Keys go in three ways, so any tool can take them: `{keys}` in the command line, the
// ROUGHBOOK_KEYS variable, and a request file. Per key, the command prints a line
// (`roughbook: ready <key>`, `roughbook: missing <key>`, `roughbook: error <key>: <why>`) or, where
// its runner swallows what tests print, writes result.txt beside the key's images; its exit code is
// 0 when every key rendered. Nothing here names a stack.
import type { RepoEnvironment, Viewport } from '../environment/types.js';
import { screenshotSet, type ResolvedVariant } from '../environment/variants.js';

/** Where the command line takes the keys, joined by commas. */
export const KEYS_STAND_IN = '{keys}';

/** The variables every snapshot command gets, on top of the studio's own environment. */
export const SNAPSHOT_VARIABLES = {
  keys: 'ROUGHBOOK_KEYS',
  out: 'ROUGHBOOK_OUT',
  shots: 'ROUGHBOOK_SHOTS',
  request: 'ROUGHBOOK_REQUEST',
  iterations: 'ROUGHBOOK_ITERATIONS',
  fixture: 'ROUGHBOOK_FIXTURE',
  devUrl: 'ROUGHBOOK_DEV_URL'
} as const;

/** Beside a key's images: what the command made of it, for a runner that swallows its output. */
export const RESULT_FILE = 'result.txt';

/** Inside the state folder: the request the command may read instead of the variables. */
export const REQUEST_FILE = 'snapshot-request.json';

export type KeyState = 'ready' | 'missing' | 'failed';

/** What the command said of one key, in its output or in result.txt. */
export type Said = { state: KeyState; message: string | null };

/** One image the command makes for every key: a viewport in a variant, named as screenshots are. */
export type SnapshotShot = {
  name: string;
  viewport: Viewport;
  variant: ResolvedVariant | null;
};

/** Every image a key gets: each viewport in each variant, in the order screenshots take them. */
export function snapshotShots(
  environment: Pick<RepoEnvironment, 'viewports' | 'variants'>
): SnapshotShot[] {
  return screenshotSet(environment.viewports, environment.variants).map(shot => ({
    name: shot.name,
    viewport: environment.viewports.find(item => item.name === shot.viewport)!,
    variant: shot.variant
  }));
}

/** The command line with the keys where `{keys}` stands. */
export function commandFor(command: string, keys: string[]): string {
  return command.replaceAll(KEYS_STAND_IN, () => keys.join(','));
}

/** The shots as one variable: `name:<width>x<height>:<variant>`, comma-joined. */
export function shotsVariable(shots: SnapshotShot[]): string {
  return shots
    .map(
      shot =>
        `${shot.name}:${shot.viewport.width}x${shot.viewport.height}:${shot.variant?.id ?? ''}`
    )
    .join(',');
}

const KEY = '[a-z0-9]+(?:-[a-z0-9]+)*\\/[a-z0-9]+(?:-[a-z0-9]+)*\\/[a-z0-9]+(?:-[a-z0-9]+)*';
const LINE = new RegExp(
  `(?:^|\\s)roughbook:\\s*(ready|missing|error)\\s+(${KEY})(?::\\s*(.*))?$`,
  'gm'
);

/**
 * What the command printed of each key: its last word on each, so a tool that retries a key says
 * what finally came of it. A line may carry a runner's prefix before `roughbook:`.
 */
export function parseSnapshotOutput(output: string): Map<string, Said> {
  const said = new Map<string, Said>();
  for (const match of output.replace(/\r\n?/g, '\n').matchAll(LINE)) {
    const word = match[1] as 'ready' | 'missing' | 'error';
    const message = match[3]?.trim() || null;
    said.set(match[2]!, {
      state: word === 'error' ? 'failed' : word,
      message: word === 'ready' ? null : message
    });
  }
  return said;
}

/** What a key's result.txt says: `ready`, `missing`, or `error: <why>`; null when it says neither. */
export function parseResultFile(text: string): Said | null {
  const first = text.replace(/\r\n?/g, '\n').trim();
  if (/^ready\b/i.test(first)) return { state: 'ready', message: null };
  const missing = /^missing\b:?\s*([\s\S]*)$/i.exec(first);
  if (missing) return { state: 'missing', message: missing[1]!.trim() || null };
  const error = /^error\b:?\s*([\s\S]*)$/i.exec(first);
  if (error) return { state: 'failed', message: error[1]!.trim() || null };
  return null;
}

/** The last lines a command printed, for a failure no key explains. */
export function outputTail(output: string, lines = 3): string {
  return output
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-lines)
    .join(' / ');
}
