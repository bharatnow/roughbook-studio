import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentEvent, HeadlessInvocation, TerminalAdapter, UsageReport } from './types.js';

export type HeadlessResult = {
  /** Exited 0 and reported no failure. */
  ok: boolean;
  exitCode: number | null;
  cancelled: boolean;
  /** Why it failed, in one line, when it did. */
  error: string | null;
  usage: UsageReport | null;
};

/**
 * Runs an agent unattended: never through a shell, every argument separate. Each line of its
 * output is parsed by the adapter into events for the local UI and, at the end, token counts.
 * Aborting stops the process, and then kills it if it lingers.
 */
export function runHeadless(
  adapter: TerminalAdapter,
  invocation: HeadlessInvocation,
  options: {
    env: NodeJS.ProcessEnv;
    model: string | null;
    signal?: AbortSignal;
    onEvent?: (event: AgentEvent) => void;
    onOutput?: (line: string) => void;
  }
): Promise<HeadlessResult> {
  return new Promise(resolve => {
    let settled = false;
    let usage: UsageReport | null = null;
    let reportedFailure: string | null = null;
    const finish = (result: HeadlessResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...options.env, ...invocation.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    const abort = () => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 5000).unref();
    };
    options.signal?.addEventListener('abort', abort, { once: true });

    child.on('error', error =>
      finish({
        ok: false,
        exitCode: null,
        cancelled: false,
        error: `${adapter.name} could not be started: ${error.message}`,
        usage
      })
    );
    createInterface({ input: child.stdout }).on('line', line => {
      options.onOutput?.(line);
      const parsed = adapter.parseLine(line);
      if (parsed.usage) {
        usage = { ...parsed.usage, model: parsed.usage.model || options.model || adapter.id };
      }
      if (parsed.event) {
        if (parsed.event.kind === 'result' && !parsed.event.ok) {
          reportedFailure = parsed.event.text ?? `${adapter.name} reported a failure.`;
        }
        options.onEvent?.(parsed.event);
      }
    });
    child.stderr.on('data', () => {});
    child.on('close', code => {
      options.signal?.removeEventListener('abort', abort);
      const cancelled = options.signal?.aborted ?? false;
      const ok = !cancelled && code === 0 && !reportedFailure;
      finish({
        ok,
        exitCode: code,
        cancelled,
        error: ok
          ? null
          : cancelled
            ? 'Cancelled.'
            : (reportedFailure ?? `${adapter.name} exited with code ${code}.`),
        usage
      });
    });

    child.stdin.on('error', () => {});
    if (invocation.stdin !== null) child.stdin.write(invocation.stdin);
    child.stdin.end();
  });
}
