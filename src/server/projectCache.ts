// The project and its ratings as the backend last gave them, so the local UI can ask as often as
// it likes while few of its asks reach the backend. Every tab that asks during a read shares it.
// The project is read again once it is older than the wait: 30 seconds after a read that found
// something new, twice as long after each read that found nothing new, up to two minutes.
// Whatever may have changed it makes it stale at once: the page's own actions, the outbox being
// sent, a run starting or finishing or an iteration appearing on disk (from the CLI, or an agent
// through MCP), and the designer coming back to the page. Ratings are read again once per read of
// the project, since a teammate's rating changes nothing in it.

export const FIRST_WAIT_MS = 30_000;
export const LONGEST_WAIT_MS = 120_000;
/** Coming back to the page reads the project again, unless it was read this recently. */
export const FRESH_ENOUGH_MS = 5_000;

export class ProjectCache<Tree, Ratings> {
  private tree: { value: Tree; text: string; at: number; read: number } | null = null;
  private reading: { promise: Promise<Tree>; read: number } | null = null;
  private reads = 0;
  private wait = FIRST_WAIT_MS;
  private stale = false;
  private readonly seen = new Map<string, string>();
  private readonly ratingsFor = new Map<string, { value: Promise<Ratings>; read: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Something may have changed the project, so the next ask reads it. */
  invalidate(): void {
    this.stale = true;
  }

  /**
   * What the studio sees now of something local, such as its runs: when it differs from what it
   * saw before, the project may have changed with it.
   */
  notice(what: string, signature: string): void {
    const before = this.seen.get(what);
    this.seen.set(what, signature);
    if (before !== undefined && before !== signature) this.stale = true;
  }

  /** The project, read from the backend when it is due; `fresh` when the designer came back. */
  project(read: () => Promise<Tree>, fresh = false): Promise<Tree> {
    if (this.reading && !this.stale) return this.reading.promise;
    const age = this.tree ? this.now() - this.tree.at : Infinity;
    const due = this.stale || age >= this.wait || (fresh && age >= FRESH_ENOUGH_MS);
    if (this.tree && !due) return Promise.resolve(this.tree.value);

    this.stale = false;
    const number = ++this.reads;
    const promise = read()
      .then(
        value => {
          // A slower read that started earlier never replaces a later one.
          if (!this.tree || number > this.tree.read) {
            const text = JSON.stringify(value);
            const same = this.tree?.text === text;
            this.wait = same ? Math.min(this.wait * 2, LONGEST_WAIT_MS) : FIRST_WAIT_MS;
            this.tree = { value, text, at: this.now(), read: number };
          }
          return value;
        },
        (error: unknown) => {
          // Asked again next time, rather than answering with the last project as if all were well.
          this.stale = true;
          throw error;
        }
      )
      .finally(() => {
        if (this.reading?.read === number) this.reading = null;
      });
    this.reading = { promise, read: number };
    return promise;
  }

  /** A component's ratings, read again once the project has been. */
  ratings(component: string, read: () => Promise<Ratings>): Promise<Ratings> {
    const generation = this.tree?.read ?? 0;
    const cached = this.ratingsFor.get(component);
    if (cached && cached.read === generation) return cached.value;
    const value = read();
    this.ratingsFor.set(component, { value, read: generation });
    value.catch(() => {
      if (this.ratingsFor.get(component)?.value === value) this.ratingsFor.delete(component);
    });
    return value;
  }
}
