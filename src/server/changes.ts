// What changed in rough/ while the local UI is open (ROUGHBOOK-FRAMEWORKS-PLAN.md, "The preview
// frame": reload on change). The watcher's file names become iteration keys, each numbered, so
// the page can ask what changed since it last looked and reload a frame when the stack has no
// hot reload of its own, and the studio can take the changed iteration's screenshots again.
import { DOCTOR_PAGE } from '../doctor/run.js';
import { ITERATION, SLUG } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';

/**
 * The iteration a written file belongs to, as `<page>/<component>/<iteration>`, or null for a
 * file that is not inside an iteration folder: a prompt, the studio's state and screenshots, the
 * preview registry, a component's own files, and doctor's own pages.
 */
export function changedKey(file: string): string | null {
  const parts = file.replace(/\\/g, '/').split('/');
  if (parts[0] !== ROUGH_DIR || parts.length < 4) return null;
  const [, page, component, iteration] = parts as [string, string, string, string];
  if (!SLUG.test(page) || !SLUG.test(component) || !ITERATION.test(iteration)) return null;
  if (page === DOCTOR_PAGE || page.startsWith(`${DOCTOR_PAGE}-`)) return null;
  return `${page}/${component}/${iteration}`;
}

export type Changes = { seq: number; keys: string[] };

/** How many changed keys are remembered; a page further behind than that reads them all. */
const KEPT = 500;

/**
 * Changes numbered as they come, each key once at its latest number: `since(n)` is every key
 * changed after n, and `wait(n, ms)` answers as soon as there is one, or with nothing after ms.
 */
export class ChangeFeed {
  seq = 0;
  private entries: { seq: number; key: string }[] = [];
  private waiters: { resolve(): void }[] = [];

  note(key: string): void {
    this.seq += 1;
    this.entries = this.entries.filter(entry => entry.key !== key);
    this.entries.push({ seq: this.seq, key });
    if (this.entries.length > KEPT) this.entries.splice(0, this.entries.length - KEPT);
    const waiting = this.waiters.splice(0);
    for (const waiter of waiting) waiter.resolve();
  }

  since(seq: number): Changes {
    return { seq: this.seq, keys: this.entries.filter(entry => entry.seq > seq).map(e => e.key) };
  }

  wait(seq: number, timeoutMs: number): Promise<Changes> {
    if (this.seq > seq || timeoutMs <= 0) return Promise.resolve(this.since(seq));
    return new Promise(resolve => {
      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve(this.since(seq));
        }
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        resolve(this.since(seq));
      }, timeoutMs);
      timer.unref();
      this.waiters.push(waiter);
    });
  }
}
