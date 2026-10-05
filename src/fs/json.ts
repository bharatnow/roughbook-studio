import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A JSON file's value, or null when the file does not exist. */
export async function readJson<T>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(text) as T;
}

/** Two-space JSON with `\n` line endings and a final newline, the same on every OS. */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Writes beside the file and renames over it, so a reader never sees half a file. Windows refuses
 * the rename while another process has the file open, so it is retried for a moment.
 */
export async function writeJsonAtomic(
  file: string,
  value: unknown,
  options: { mode?: number } = {}
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, formatJson(value), { mode: options.mode });
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, file);
      return;
    } catch (error) {
      if (attempt >= 10 || !BUSY.has((error as NodeJS.ErrnoException).code ?? '')) {
        await rm(temp, { force: true });
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}
