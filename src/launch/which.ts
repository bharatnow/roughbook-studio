import path from 'node:path';
import { diskProbe, type Probe } from './platform.js';

/**
 * How to start a program without a shell: the executable, and arguments that must come first. An
 * npm install on Windows leaves a `.cmd` shim, which cannot be started without a shell, so its
 * package's script is run with Node instead.
 */
export type Executable = { command: string; prefixArgs: string[]; source: string };

export type Lookup = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  /** The Node that runs the studio, for npm-installed scripts. */
  node: string;
  probe?: Probe;
};

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** The folders on PATH, in order. */
export function pathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  return (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
}

/** A program on PATH by name, as an executable file (with .exe or .com on Windows). */
export function findOnPath(name: string, lookup: Lookup): string | null {
  const p = pathApi(lookup.platform);
  const probe = lookup.probe ?? diskProbe;
  const names = lookup.platform === 'win32' ? [`${name}.exe`, `${name}.com`] : [name];
  for (const dir of pathDirs(lookup.env, lookup.platform)) {
    for (const candidate of names) {
      const file = p.join(dir, candidate);
      if (probe.exists(file)) return file;
    }
  }
  return null;
}

/**
 * An npm-installed command: on Windows, the `.cmd` shim's package script run with Node; elsewhere
 * the shim on PATH is itself executable, so findOnPath already found it.
 */
export function findNpmScript(
  name: string,
  npmPackage: string,
  script: string,
  lookup: Lookup
): Executable | null {
  if (lookup.platform !== 'win32') return null;
  const p = path.win32;
  const probe = lookup.probe ?? diskProbe;
  for (const dir of pathDirs(lookup.env, lookup.platform)) {
    const target = p.join(dir, 'node_modules', ...npmPackage.split('/'), ...script.split('/'));
    if (probe.exists(p.join(dir, `${name}.cmd`)) && probe.exists(target)) {
      return { command: lookup.node, prefixArgs: [target], source: 'npm' };
    }
  }
  return null;
}

/** `ROUGHBOOK_<NAME>_BIN`, when it names a file that exists. */
export function fromEnv(variable: string, lookup: Lookup): Executable | null {
  const explicit = lookup.env[variable]?.trim();
  if (!explicit || !(lookup.probe ?? diskProbe).exists(explicit)) return null;
  return { command: explicit, prefixArgs: [], source: variable };
}

/** Compares dotted version strings numerically: 2.1.286 > 2.1.9. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(part => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map(part => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
