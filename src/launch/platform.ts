import fs from 'node:fs';

/** The OS as the backend records it: one of four words, nothing more about the machine. */
export type StudioOs = 'windows' | 'macos' | 'linux' | 'other';

export function currentOs(platform: NodeJS.Platform = process.platform): StudioOs {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'other';
}

/** This machine's platform, for code outside launch/ and screenshot/ that takes one as input. */
export function hostPlatform(): NodeJS.Platform {
  return process.platform;
}

/** What the file system looks like, replaced in tests so every OS can be checked on any OS. */
export type Probe = {
  exists(file: string): boolean;
  /** Folder names directly inside `dir`; empty when it cannot be read. */
  dirs(dir: string): string[];
};

export const diskProbe: Probe = {
  exists(file) {
    try {
      // lstat: Windows app execution aliases (wt.exe) are links that existsSync cannot follow.
      fs.lstatSync(file);
      return true;
    } catch {
      return false;
    }
  },
  dirs(dir) {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } catch {
      return [];
    }
  }
};
