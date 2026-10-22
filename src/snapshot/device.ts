// Snapshot mode's optional `device` command (ROUGHBOOK-FRAMEWORKS-PLAN.md, "The preview contract"):
// opens one iteration on a simulator, an emulator or a device, through a debug-only screen the
// setup reaches by a deep link, for the interaction its images cannot give. The command is the
// environment's, approved on this machine like every other, with the key where `{key}` stands.
import type { RepoEnvironment } from '../environment/types.js';
import { isApproved, readApprovals } from '../repo/approvals.js';
import { syncIterations } from '../repo/mirror.js';
import { outputTail } from './contract.js';
import { runSnapshotCommand, type SnapshotExec } from './render.js';

export const KEY_STAND_IN = '{key}';

/** The device command line for one key. */
export function deviceCommandFor(command: string, key: string): string {
  return command.replaceAll(KEY_STAND_IN, () => key);
}

/**
 * Opens one key on the device with the environment's approved command; says what happened, in
 * words for the designer. Refused when the environment has no device command, or it is not
 * approved here (decision 18).
 */
export async function openOnDevice(
  repoRoot: string,
  environment: RepoEnvironment,
  key: string,
  exec: SnapshotExec = runSnapshotCommand
): Promise<{ ok: boolean; message: string }> {
  const command = environment.device;
  if (!command) {
    return {
      ok: false,
      message:
        'rough/environment.md names no device command, so iterations open only as images here.'
    };
  }
  if (!isApproved(await readApprovals(repoRoot), command, environment.shell)) {
    return {
      ok: false,
      message: `The device command is not approved on this machine (${command}). Run roughbook doctor in a terminal and approve it.`
    };
  }
  // The device's debug build reads the iteration from where the stack sees it.
  syncIterations(repoRoot, environment);
  const ran = await exec(
    deviceCommandFor(command, key),
    repoRoot,
    environment.timeouts.start * 1000,
    environment.shell,
    { ROUGHBOOK_KEY: key }
  );
  if (ran.code === 0) return { ok: true, message: `Opened ${key} on the device.` };
  const tail = outputTail(ran.output);
  return {
    ok: false,
    message:
      ran.code === null
        ? `The device command did not finish within ${environment.timeouts.start} s.`
        : `The device command failed (exit ${ran.code})${tail ? `: ${tail}` : '.'} Is a simulator, emulator or device running?`
  };
}
