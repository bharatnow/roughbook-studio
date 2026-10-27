import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export type LockOptions = {
  /** A lock older than this was left by a process that died; it is broken. */
  staleMs?: number;
  /** How long to wait for another process before giving up. */
  waitMs?: number;
  /**
   * Breaks a lock at once when the process that took it is no longer running (stopped with Ctrl+C
   * in the middle), for a lock held long enough that waiting out `staleMs` would be felt.
   */
  breakDead?: boolean;
};

/** Whether the process that wrote `lock` has gone; false while it cannot be told. */
async function holderGone(lock: string): Promise<boolean> {
  const pid = Number(await readFile(lock, 'utf8').catch(() => ''));
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/**
 * Windows refuses to create a file while one of the same name is still being deleted, so a lock
 * its holder has just let go of can answer these for a moment instead of EEXIST.
 */
const RELEASING = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Runs `work` while holding `<file>.lock`, so the CLI, the local server and the MCP server never
 * write the same state file at once. Creating the lock with `wx` is atomic on every OS.
 */
export async function withLock<T>(
  file: string,
  work: () => Promise<T>,
  { staleMs = 60_000, waitMs = 60_000, breakDead = false }: LockOptions = {}
): Promise<T> {
  const lock = `${file}.lock`;
  await mkdir(path.dirname(lock), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(lock, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (code !== 'EEXIST' && !RELEASING.has(code)) throw error;
      const held = await stat(lock).catch(() => null);
      if (
        code === 'EEXIST' &&
        held &&
        (Date.now() - held.mtimeMs > staleMs || (breakDead && (await holderGone(lock))))
      ) {
        await rm(lock, { force: true });
        continue;
      }
      if (Date.now() - started > waitMs) {
        // A folder that is truly not writable says so, rather than blaming another process.
        if (code !== 'EEXIST') throw error;
        throw new Error(`Another Roughbook process holds ${lock}.`);
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try {
    return await work();
  } finally {
    await rm(lock, { force: true });
  }
}
