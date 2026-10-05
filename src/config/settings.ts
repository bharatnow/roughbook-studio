import path from 'node:path';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import type { RunAgent } from '../runs/types.js';

/** This install's preferences, beside the credentials in the user config folder. */
export type Settings = {
  /** The agent `run` and the local UI use when none is chosen. */
  defaultAgent: RunAgent | null;
};

const DEFAULTS: Settings = { defaultAgent: null };

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
