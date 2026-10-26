/**
 * The lines an edit takes out and puts in, in order, for showing a planned change. Not a minimal
 * diff: lines are matched from both ends, and what lies between is shown as replaced.
 */
export function changedLines(
  before: string,
  after: string
): { removed: string[]; added: string[] } {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { removed: a.slice(start, endA), added: b.slice(start, endB) };
}

/** One line of a diff: kept, taken out or put in, with its numbers before and after. */
export type DiffLine = {
  kind: 'same' | 'removed' | 'added';
  text: string;
  before: number | null;
  after: number | null;
};

/** A run of changed lines with a few kept ones around it, as a unified diff's hunk. */
export type DiffHunk = { before: number; after: number; lines: DiffLine[] };

/** Past this many line pairs, the middle is shown as replaced rather than matched line by line. */
const MATCH_LIMIT = 4_000_000;

/**
 * The hunks that turn `before` into `after`, line by line (line endings set aside), with
 * `context` kept lines around each change: the longest common subsequence, or, for files too
 * long to match whole, `changedLines`'s ends.
 */
export function lineDiff(before: string, after: string, context = 3): DiffHunk[] {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle: DiffLine['kind'][] = [];
  const n = endA - start;
  const m = endB - start;
  if (n * m > MATCH_LIMIT) {
    middle.push(...Array<'removed'>(n).fill('removed'), ...Array<'added'>(m).fill('added'));
  } else {
    // table[i][j]: the longest common run of a[start+i..] and b[start+j..].
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * width + j + 1]! + 1
            : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        middle.push('same');
        i++;
        j++;
        // What is taken out comes before what is put in its place, as diffs show it.
      } else if (i < n && (j === m || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
        middle.push('removed');
        i++;
      } else {
        middle.push('added');
        j++;
      }
    }
  }
  const all: DiffLine[] = [];
  let ia = 0;
  let ib = 0;
  const push = (kind: DiffLine['kind']) => {
    if (kind === 'same') all.push({ kind, text: a[ia]!, before: ++ia, after: ++ib });
    else if (kind === 'removed') all.push({ kind, text: a[ia]!, before: ++ia, after: null });
    else all.push({ kind, text: b[ib]!, before: null, after: ++ib });
  };
  for (let k = 0; k < start; k++) push('same');
  for (const kind of middle) push(kind);
  while (ia < a.length) push('same');

  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let lastChange = -Infinity;
  for (let k = 0; k < all.length; k++) {
    if (all[k]!.kind === 'same') continue;
    const from = Math.max(0, k - context, lastChange + context + 1);
    if (!current || k - lastChange > context * 2) {
      if (current) current.lines.push(...all.slice(lastChange + 1, lastChange + 1 + context));
      const first = all[from]!;
      current = {
        before: first.before ?? precedingBefore(all, from) + 1,
        after: first.after ?? precedingAfter(all, from) + 1,
        lines: all.slice(from, k)
      };
      hunks.push(current);
    } else {
      current.lines.push(...all.slice(lastChange + 1, k));
    }
    current.lines.push(all[k]!);
    lastChange = k;
  }
  if (current) current.lines.push(...all.slice(lastChange + 1, lastChange + 1 + context));
  return hunks;
}

function precedingBefore(all: DiffLine[], index: number): number {
  for (let k = index - 1; k >= 0; k--) if (all[k]!.before !== null) return all[k]!.before!;
  return 0;
}

function precedingAfter(all: DiffLine[], index: number): number {
  for (let k = index - 1; k >= 0; k--) if (all[k]!.after !== null) return all[k]!.after!;
  return 0;
}

/** Hunks as a unified diff's text, for a terminal: `@@ -a +b @@` and the lines marked. */
export function unifiedText(file: string, hunks: DiffHunk[]): string {
  const out = [`--- ${file}`, `+++ ${file}`];
  for (const hunk of hunks) {
    const removed = hunk.lines.filter(line => line.kind !== 'added').length;
    const added = hunk.lines.filter(line => line.kind !== 'removed').length;
    out.push(`@@ -${hunk.before},${removed} +${hunk.after},${added} @@`);
    for (const line of hunk.lines) {
      out.push(`${line.kind === 'same' ? ' ' : line.kind === 'removed' ? '-' : '+'}${line.text}`);
    }
  }
  return out.join('\n');
}

/** A text's lines, without the empty one after a final newline. */
function lines(text: string): string[] {
  const all = text.split(/\r?\n/);
  if (all[all.length - 1] === '') all.pop();
  return all;
}
