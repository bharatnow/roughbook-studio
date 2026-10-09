import os from 'node:os';
import { hostPlatform } from '../launch/platform.js';
import type { Lookup } from '../launch/which.js';
import type { RunAgent } from '../runs/types.js';
import { claudeCode } from './claude.js';
import { codex } from './codex.js';
import { antigravity, cursor, ownEditor, vscode, windsurf } from './editors.js';
import type { AgentAdapter, Detection, EditorAdapter, TerminalAdapter } from './types.js';

/** The terminal agents this version ships. Gemini CLI and Cursor's CLI come later in S2. */
export const ADAPTERS: TerminalAdapter[] = [claudeCode, codex];

/** The editors whose own agent the designer drives, then any other editor through the OS. */
export const EDITORS: EditorAdapter[] = [cursor, vscode, antigravity, windsurf, ownEditor];

/** Every agent and editor, terminal agents first: the order `agents` lists and `run` tries. */
export const ALL_AGENTS: AgentAdapter[] = [...ADAPTERS, ...EDITORS];

export function adapterFor(id: RunAgent): AgentAdapter {
  const adapter = ALL_AGENTS.find(item => item.id === id);
  if (!adapter) throw new Error(`${id} is not supported in this version of the studio.`);
  return adapter;
}

/** Where to look for agents on this machine. */
export function hostLookup(env: NodeJS.ProcessEnv): Lookup {
  return { env, platform: hostPlatform(), home: os.homedir(), node: process.execPath };
}

/** What each agent is on this machine: found or not, its version, sign-in, and headless rule. */
export async function detectAgents(lookup: Lookup): Promise<Detection[]> {
  return Promise.all(ALL_AGENTS.map(adapter => adapter.detect(lookup)));
}
