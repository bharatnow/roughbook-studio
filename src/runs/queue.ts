// One command at a time per repo (ROUGHBOOK-FRAMEWORKS-PLAN.md, decision 36): a build, a
// production server for the gate, a snapshot render. Work queued under the same key runs in
// order, each after the one before it has ended, however it ended; different keys do not wait
// for each other. The environment's timeouts say how long each may take; the queue does not.
const chains = new Map<string, Promise<unknown>>();

/** Runs `work` once everything queued before it under `key` has ended. */
export function queued<T>(key: string, work: () => Promise<T>): Promise<T> {
  const before = chains.get(key) ?? Promise.resolve();
  const run = before.then(work, work);
  // The chain never rejects, so one failure does not block what comes after.
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return run;
}

/** How many pieces of work are queued or running under `key`, for tests and the status line. */
export function queueBusy(key: string): boolean {
  return chains.has(key);
}
