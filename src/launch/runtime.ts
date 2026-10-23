// Which Node.js runs a Node script for the studio. Installed from npm, the studio runs on the
// machine's Node.js, which also runs npm's and npx's own scripts and an agent's npm-installed one.
// The standalone binary (decision 35 of the frameworks plan) carries its own runtime, which is the
// studio itself: it runs a script given to it as Node would, but npm is not inside it, so npm, npx
// and agents' scripts run on the Node.js on the PATH, when the machine has one.
import os from 'node:os';
import { isSea } from 'node:sea';
import { findProgramOnPath } from './which.js';

/** Whether this studio is the standalone binary rather than the npm package. */
export function standaloneBinary(): boolean {
  return isSea();
}

const found = new Map<string, string | null>();

/**
 * The Node.js that runs npm's and npx's scripts and agents' npm-installed ones: the one running the
 * studio, or in the binary the first `node` on the PATH, or null when the machine has none.
 */
export function scriptNode(
  env: NodeJS.ProcessEnv = process.env,
  binary: boolean = standaloneBinary()
): string | null {
  if (!binary) return process.execPath;
  const key = env.PATH ?? env.Path ?? '';
  if (!found.has(key)) {
    found.set(
      key,
      findProgramOnPath('node', {
        env,
        platform: process.platform,
        home: os.homedir(),
        node: process.execPath
      })
    );
  }
  return found.get(key)!;
}
