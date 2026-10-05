import os from 'node:os';
import { hostPlatform } from '../launch/platform.js';
import type { Lookup } from '../launch/which.js';
import type { RunAgent } from '../runs/types.js';
import { claudeCode } from './claude.js';
import { codex } from './codex.js';
import type { Detection, TerminalAdapter } from './types.js';

/** The terminal agents this version ships. Editor agents and more CLIs come with S2. */
export const ADAPTERS: TerminalAdapter[] = [claudeCode, codex];

export function adapterFor(id: RunAgent): TerminalAdapter {
  const adapter = ADAPTERS.find(item => item.id === id);
  if (!adapter) throw new Error(`${id} is not supported in this version of the studio.`);
  return adapter;
}

/** Where to look for agents on this machine. */
export function hostLookup(env: NodeJS.ProcessEnv): Lookup {
  return { env, platform: hostPlatform(), home: os.homedir(), node: process.execPath };
}

/** What each agent is on this machine: found or not, its version, sign-in, and headless rule. */
export async function detectAgents(lookup: Lookup): Promise<Detection[]> {
  return Promise.all(ADAPTERS.map(adapter => adapter.detect(lookup)));
}
