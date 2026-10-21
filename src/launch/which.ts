import path from 'node:path';
import { diskProbe, type Probe } from './platform.js';

/**
 * How to start a program without a shell: the executable, and arguments that must come first. An
 * npm install on Windows leaves a `.cmd` shim, which cannot be started without a shell, so its
 * package's script is run with Node instead.
 */
export type Executable = {
  command: string;
  prefixArgs: string[];
  source: string;
  /** Variables it needs set, such as an editor's launcher running its exe as Node. */
  env?: Record<string, string>;
};

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

/** Windows' per-user data folders, with Windows' defaults when the environment lacks them. */
export function windowsDataDirs(lookup: Lookup): { roaming: string; local: string } {
  const p = path.win32;
  return {
    roaming: lookup.env.APPDATA || p.join(lookup.home, 'AppData', 'Roaming'),
    local: lookup.env.LOCALAPPDATA || p.join(lookup.home, 'AppData', 'Local')
  };
}

/** A program in one of `dirs` by name, as an executable file (with .exe or .com on Windows). */
export function findInDirs(name: string, dirs: string[], lookup: Lookup): string | null {
  const p = pathApi(lookup.platform);
  const probe = lookup.probe ?? diskProbe;
  const names = lookup.platform === 'win32' ? [`${name}.exe`, `${name}.com`] : [name];
  for (const dir of dirs) {
    for (const candidate of names) {
      const file = p.join(dir, candidate);
      if (probe.exists(file)) return file;
    }
  }
  return null;
}

/** A program on PATH by name. */
export function findOnPath(name: string, lookup: Lookup): string | null {
  return findInDirs(name, pathDirs(lookup.env, lookup.platform), lookup);
}

/**
 * Folders installers put commands in that PATH can miss, as in a terminal opened before the
 * install or a profile that never adds them: the native installers' ~/.local/bin, WinGet, Scoop,
 * Homebrew, npm's usual global folder, Volta and Bun.
 */
export function installDirs(lookup: Lookup): string[] {
  const p = pathApi(lookup.platform);
  const home = lookup.home;
  if (lookup.platform === 'win32') {
    return [
      p.join(home, '.local', 'bin'),
      p.join(windowsDataDirs(lookup).local, 'Microsoft', 'WinGet', 'Links'),
      p.join(home, 'scoop', 'shims'),
      p.join(home, '.bun', 'bin')
    ];
  }
  return [
    p.join(home, '.local', 'bin'),
    lookup.platform === 'darwin' ? '/opt/homebrew/bin' : '/home/linuxbrew/.linuxbrew/bin',
    '/usr/local/bin',
    p.join(home, '.npm-global', 'bin'),
    p.join(home, '.volta', 'bin'),
    p.join(home, '.bun', 'bin')
  ];
}

/** A program in the install folders, for when it is not on PATH. */
export function findInstalled(name: string, lookup: Lookup): Executable | null {
  const native = pathApi(lookup.platform).join(lookup.home, '.local', 'bin');
  for (const dir of installDirs(lookup)) {
    const file = findInDirs(name, [dir], lookup);
    if (file) {
      return { command: file, prefixArgs: [], source: dir === native ? 'native install' : dir };
    }
  }
  return null;
}

/**
 * An npm-installed command: on Windows, the `.cmd` shim's package script run with Node, looked
 * for on PATH and in npm's default global folder; elsewhere the shim is itself executable, so
 * findOnPath or findInstalled finds it.
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
  const npmGlobal = p.join(windowsDataDirs(lookup).roaming, 'npm');
  for (const dir of [...pathDirs(lookup.env, lookup.platform), npmGlobal]) {
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

/**
 * A program on PATH by name, as a shell would find it: the name itself, and on Windows the
 * executable extensions PATHEXT lists (.exe, .cmd, .bat, .com, .ps1 among them). For doctor's
 * prerequisites check: whether the tools an environment's commands need are here at all.
 */
export function findProgramOnPath(name: string, lookup: Lookup): string | null {
  const p = pathApi(lookup.platform);
  const probe = lookup.probe ?? diskProbe;
  if (name.includes('/') || name.includes('\\')) return probe.exists(name) ? name : null;
  const extensions =
    lookup.platform === 'win32'
      ? [
          '',
          ...(lookup.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD;.PS1')
            .split(';')
            .filter(Boolean)
            .map(extension => extension.toLowerCase())
        ]
      : [''];
  for (const dir of pathDirs(lookup.env, lookup.platform)) {
    for (const extension of extensions) {
      const file = p.join(dir, `${name}${extension}`);
      if (probe.exists(file)) return file;
    }
  }
  return null;
}
