import { rm } from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../fs/json.js';

/** This machine's sign-in: one install token per user config folder. */
export type Credentials = {
  server: string;
  installId: string;
  token: string;
  /** Shown by `roughbook status`; never sent anywhere. */
  signedInAs: string | null;
  savedAt: string;
};

export function credentialsFile(configDir: string): string {
  return path.join(configDir, 'credentials.json');
}

export async function readCredentials(configDir: string): Promise<Credentials | null> {
  return readJson<Credentials>(credentialsFile(configDir));
}

/** Readable by this user only, where the OS has file modes. */
export async function saveCredentials(configDir: string, credentials: Credentials): Promise<void> {
  await writeJsonAtomic(credentialsFile(configDir), credentials, { mode: 0o600 });
}

export async function clearCredentials(configDir: string): Promise<void> {
  await rm(credentialsFile(configDir), { force: true });
}
