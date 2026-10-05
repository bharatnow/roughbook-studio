import { mkdir, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export type LockOptions = {
  /** A lock older than this was left by a process that died; it is broken. */
  staleMs?: number;
  /** How long to wait for another process before giving up. */
  waitMs?: number;
};

/**
 * Runs `work` while holding `<file>.lock`, so the CLI and the local server never write the same
 * state file at once. Creating the lock with `wx` is atomic on every OS.
 */
export async function withLock<T>(
  file: string,
  work: () => Promise<T>,
  { staleMs = 60_000, waitMs = 60_000 }: LockOptions = {}
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
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const held = await stat(lock).catch(() => null);
      if (held && Date.now() - held.mtimeMs > staleMs) {
        await rm(lock, { force: true });
        continue;
      }
      if (Date.now() - started > waitMs)
        throw new Error(`Another Roughbook process holds ${lock}.`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try {
    return await work();
  } finally {
    await rm(lock, { force: true });
  }
}
