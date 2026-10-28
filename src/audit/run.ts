// The accessibility-audit contract (A13 of ROUGHBOOK-APPLE-PLAN.md). Apple's
// performAccessibilityAudit() runs only in a UI test target with a host app, which no recipe can
// make for a repo; so the repo's own environment provides the command, as it does for snapshots,
// and the studio runs it per iteration with the key where `{key}` stands and in ROUGHBOOK_KEY.
// The command prints `roughbook: audit <key>: ok`, or one `roughbook: audit <key>: issue <message>`
// line per issue; anything else it prints is ignored, and a line may carry a runner's prefix.
// Issues are ACCESSIBILITY_AUDIT warnings, never a failure. No command means no audit and no
// warning; a command that fails, times out, says nothing of the key or is not approved here is
// one warning saying the audit could not run. Nothing here names a stack.
import type { RepoEnvironment } from '../environment/types.js';
import { runCapture } from '../launch/processes.js';
import { isApproved, readApprovals } from '../repo/approvals.js';
import { syncIterations } from '../repo/mirror.js';
import type { Finding } from '../runs/types.js';
import { outputTail } from '../snapshot/contract.js';

/** The warning code every audit finding carries, the issues and the audit that could not run. */
export const AUDIT_CODE = 'ACCESSIBILITY_AUDIT';

/** Where the command line takes the key. */
export const AUDIT_KEY_STAND_IN = '{key}';

/** How many issues one iteration's audit reports; the rest are counted in the last. */
export const AUDIT_ISSUE_LIMIT = 20;

/** Runs the command with ROUGHBOOK_KEY, to its end: replaced in tests. */
export type AuditExec = (
  command: string,
  cwd: string,
  timeoutMs: number,
  shell: RepoEnvironment['shell'],
  env: Record<string, string>
) => Promise<{ code: number | null; output: string }>;

/** The audit command line for one key. */
export function auditCommandFor(command: string, key: string): string {
  return command.replaceAll(AUDIT_KEY_STAND_IN, () => key);
}

const LINE = /(?:^|\s)roughbook:\s*audit\s+(\S+?):\s*(ok|issue)\b[ \t]*(.*)$/gm;

/**
 * What the command said of `key`: whether it passed, and its issues in order, each once; null when
 * it printed no line for the key. Any issue outweighs an `ok`.
 */
export function parseAuditOutput(
  output: string,
  key: string
): { ok: boolean; issues: string[] } | null {
  let said = false;
  let passed = false;
  const issues: string[] = [];
  for (const match of output.replace(/\r\n?/g, '\n').matchAll(LINE)) {
    if (match[1] !== key) continue;
    said = true;
    if (match[2] === 'ok') {
      passed = true;
      continue;
    }
    const message = match[3]!.trim() || 'An issue the audit did not describe';
    if (!issues.includes(message)) issues.push(message);
  }
  if (!said) return null;
  return { ok: passed && !issues.length, issues };
}

function couldNotRun(key: string, why: string): Finding[] {
  return [{ code: AUDIT_CODE, message: `The accessibility audit could not run on ${key}: ${why}` }];
}

/**
 * Audits one iteration with the environment's approved audit command and gives what Done and
 * get_checks warn of: one finding per issue, one when the audit could not run, none when it
 * passed or the repo has no audit command. The iterations are mirrored first, so a test target
 * reading them in the source tree sees them as they are. The caller queues it on the repo.
 */
export async function auditIteration(
  repoRoot: string,
  environment: RepoEnvironment,
  key: string,
  exec: AuditExec = runCapture
): Promise<Finding[]> {
  const command = environment.audit;
  if (!command) return [];
  if (!isApproved(await readApprovals(repoRoot), command, environment.shell)) {
    return couldNotRun(
      key,
      `the audit command is not approved on this machine (${command}). Run roughbook doctor in a terminal and approve it.`
    );
  }
  syncIterations(repoRoot, environment);
  const seconds = environment.timeouts.build;
  const startedAt = Date.now();
  const ran = await exec(
    auditCommandFor(command, key),
    repoRoot,
    seconds * 1000,
    environment.shell,
    { ROUGHBOOK_KEY: key }
  );
  // A command stopped at its timeout may report the exit code its stopping gave it instead.
  if (ran.code === null || Date.now() - startedAt >= seconds * 1000) {
    return couldNotRun(key, `it did not finish within ${seconds} s.`);
  }
  const said = parseAuditOutput(ran.output, key);
  if (!said) {
    const tail = outputTail(ran.output);
    return couldNotRun(
      key,
      ran.code === 0
        ? `the command said nothing of ${key}; it prints "roughbook: audit ${key}: ok" or an issue line.`
        : `the command failed (exit ${ran.code})${tail ? `: ${tail}` : '.'}`
    );
  }
  const shown = said.issues.slice(0, AUDIT_ISSUE_LIMIT);
  const findings = shown.map(issue => ({
    code: AUDIT_CODE,
    message: `Accessibility audit of ${key}: ${issue}`
  }));
  const more = said.issues.length - shown.length;
  if (more > 0) {
    findings.push({
      code: AUDIT_CODE,
      message: `Accessibility audit of ${key}: ${more} more issue${more === 1 ? '' : 's'}.`
    });
  }
  return findings;
}
