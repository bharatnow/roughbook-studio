import os from 'node:os';
import path from 'node:path';

/**
 * Where the studio keeps the install token: the place each OS sets aside for an application's
 * settings, outside every repo. `ROUGHBOOK_CONFIG_DIR` overrides it.
 */
export function userConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir()
): string {
  if (env.ROUGHBOOK_CONFIG_DIR) return path.resolve(env.ROUGHBOOK_CONFIG_DIR);
  if (platform === 'win32') {
    return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Roughbook');
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', 'Roughbook');
  }
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), 'roughbook');
}
