/** The OS as the backend records it: one of four words, nothing more about the machine. */
export type StudioOs = 'windows' | 'macos' | 'linux' | 'other';

export function currentOs(platform: NodeJS.Platform = process.platform): StudioOs {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'other';
}
