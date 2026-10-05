import { spawn } from 'node:child_process';
import type { Executable } from '../launch/which.js';

export type CommandResult = { ok: boolean; stdout: string; stderr: string; code: number | null };

/** Runs a short command and collects its output. Never through a shell. */
export function runCommand(
  executable: Executable,
  args: string[],
  timeoutMs = 10_000
): Promise<CommandResult> {
  return new Promise(resolve => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const child = spawn(executable.command, [...executable.prefixArgs, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, stdout, stderr: `${stderr}\n(timed out)`.trim(), code: null });
    }, timeoutMs);
    child.stdout.on('data', chunk => (stdout += String(chunk)));
    child.stderr.on('data', chunk => (stderr += String(chunk)));
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message, code: null });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, code });
    });
  });
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}
