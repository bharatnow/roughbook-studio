import path from 'node:path';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import type { RunAgent } from '../runs/types.js';

/** Where `roughbook start` serves the local UI when no port was chosen. */
export const DEFAULT_LOCAL_PORT = 4848;

/** This install's preferences, beside the credentials in the user config folder. */
export type Settings = {
  /** The agent `run` and the local UI use when none is chosen. */
  defaultAgent: RunAgent | null;
  /**
   * The local server's port. Iterations load their asset files from it, so it is kept: a port
   * chosen once with `roughbook start --port` stays the one prompts name.
   */
  localPort: number | null;
};

const DEFAULTS: Settings = { defaultAgent: null, localPort: null };

/** The local server's address, which prompts give agents for the asset files. */
export function localOrigin(settings: Pick<Settings, 'localPort'>): string {
  return `http://127.0.0.1:${settings.localPort ?? DEFAULT_LOCAL_PORT}`;
}

export function settingsFile(configDir: string): string {
  return path.join(configDir, 'settings.json');
}

export async function readSettings(configDir: string): Promise<Settings> {
  return { ...DEFAULTS, ...(await readJson<Partial<Settings>>(settingsFile(configDir))) };
}

export async function saveSettings(configDir: string, patch: Partial<Settings>): Promise<Settings> {
  const settings = { ...(await readSettings(configDir)), ...patch };
  await writeJsonAtomic(settingsFile(configDir), settings);
  return settings;
}
