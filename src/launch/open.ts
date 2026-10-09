import { spawn } from 'node:child_process';

/** A program to start and leave running, such as an editor, without a shell. */
export type Launch = { command: string; args: string[]; env?: Record<string, string> };

/**
 * Starts a program that outlives the studio, such as an editor, and resolves once it has started;
 * rejects when it could not be started at all.
 */
export function launchDetached(
  launch: Launch,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(launch.command, launch.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: launch.env ? { ...env, ...launch.env } : env
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    } catch (error) {
      reject(error as Error);
    }
  });
}

/**
 * How each OS opens a URL in the default browser, or a file in its default app, as an argument
 * array: no shell, so nothing in it is ever interpreted. Null where the studio knows no opener.
 */
export function openerFor(
  url: string,
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[] } | null {
  if (platform === 'win32')
    return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
    return { command: 'xdg-open', args: [url] };
  }
  return null;
}

/** Opens an http(s) URL in the default browser. Resolves false when it could not. */
export function openUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve(false);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return Promise.resolve(false);
  const opener = openerFor(parsed.href);
  if (!opener) return Promise.resolve(false);
  return new Promise(resolve => {
    try {
      const child = spawn(opener.command, opener.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
