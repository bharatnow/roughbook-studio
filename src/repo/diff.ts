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

/** A text's lines, without the empty one after a final newline. */
function lines(text: string): string[] {
  const all = text.split(/\r?\n/);
  if (all[all.length - 1] === '') all.pop();
  return all;
}
