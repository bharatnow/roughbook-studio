import { execFile } from 'node:child_process';

/** `git init`, so rough/ has a record from the start. False when git is not installed. */
export function gitInit(dir: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile('git', ['init', '--quiet'], { cwd: dir, windowsHide: true, timeout: 30_000 }, error =>
      resolve(!error)
    );
  });
}
