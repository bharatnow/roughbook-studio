// Commands are approved once per machine (ROUGHBOOK-FRAMEWORKS-PLAN.md, decision 18): every
// command rough/environment.md names is shown to the designer with the shell it runs in, and its
// hash is kept in this clone's state folder, never committed. A command changed by a commit has
// another hash, so it is asked again; a teammate's clone has no approvals and asks for each. A
// committed file is never a way to run code on someone's machine unseen.
import { createHash } from 'node:crypto';
import type { RepoEnvironment, Shell } from '../environment/types.js';
import { readJson, writeJsonAtomic } from '../fs/json.js';
import { statePath } from './root.js';

/** One command the environment names, with the field it comes from and the shell it runs in. */
export type EnvironmentCommand = { field: string; command: string; shell: Shell };

export type Approval = { command: string; shell: Shell; approvedAt: string };

/** By hash. */
export type Approvals = Record<string, Approval>;

export function approvalsFile(repoRoot: string): string {
  return statePath(repoRoot, 'approvals.json');
}

/** The hash an approval is kept under: the shell and the command, so a change to either asks again. */
export function commandHash(command: string, shell: Shell): string {
  return createHash('sha256').update(`${shell}\n${command.trim()}`).digest('hex');
}

/** Every command the environment would have the studio run, each once. */
export function environmentCommands(environment: RepoEnvironment): EnvironmentCommand[] {
  const commands: EnvironmentCommand[] = [];
  const add = (field: string, command: string | null | undefined) => {
    if (!command || commands.some(item => item.command === command)) return;
    commands.push({ field, command, shell: environment.shell });
  };
  add('start', environment.start.command);
  add('snapshot', environment.snapshot);
  add('device', environment.device);
  add('audit', environment.audit);
  add('build', environment.build.command);
  add('production', environment.production?.command);
  for (const check of environment.checks) add('checks', check);
  return commands;
}

export async function readApprovals(repoRoot: string): Promise<Approvals> {
  return (await readJson<Approvals>(approvalsFile(repoRoot))) ?? {};
}

export function isApproved(approvals: Approvals, command: string, shell: Shell): boolean {
  const approval = approvals[commandHash(command, shell)];
  return Boolean(approval && approval.command === command.trim() && approval.shell === shell);
}

/** The environment's commands not yet approved on this machine. */
export function unapprovedCommands(
  environment: RepoEnvironment,
  approvals: Approvals
): EnvironmentCommand[] {
  return environmentCommands(environment).filter(
    item => !isApproved(approvals, item.command, item.shell)
  );
}

/** Records the designer's yes for each command, as it is now. */
export async function approveCommands(
  repoRoot: string,
  commands: { command: string; shell: Shell }[],
  now: Date = new Date()
): Promise<Approvals> {
  const approvals = await readApprovals(repoRoot);
  for (const item of commands) {
    approvals[commandHash(item.command, item.shell)] = {
      command: item.command.trim(),
      shell: item.shell,
      approvedAt: now.toISOString()
    };
  }
  await writeJsonAtomic(approvalsFile(repoRoot), approvals);
  return approvals;
}

/** A command as the designer sees it before approving: its field, its shell and the line. */
export function describeCommand(item: EnvironmentCommand): string {
  const where = item.shell === 'none' ? 'run by name' : `in ${item.shell}`;
  return `${item.field}: ${item.command}  (${where})`;
}
