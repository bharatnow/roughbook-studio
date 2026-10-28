// The quiet budget (DESIGN.md in the roughbook repo, "Quiet"): how many always-on hint paragraphs
// each file of the local UI may hold. A hint paragraph is a <p> whose class holds text-slate or
// text-steel, or their new names (ROUGHBOOK-APPLE-PLAN.md, A1) text-label-secondary and
// text-label-meta. quiet.test.ts counts them in every .tsx under ui/src, and `npm run quiet-budget`
// records the counts in quiet-budget.json. A budget only goes down.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const QUIET_ROOTS = ['ui/src'] as const;

const HINT_CLASS = /\btext-(?:slate|steel|label-secondary|label-meta)\b/;

/** Counts the <p> elements whose opening tag names one of the hint classes. */
export function countQuietHints(source: string): number {
  let count = 0;
  for (const match of source.matchAll(/<p(?=[\s>])/g)) {
    if (HINT_CLASS.test(openingTag(source, match.index + 2))) count += 1;
  }
  return count;
}

/** The attributes of an opening tag, up to its ">", skipping any inside strings or braces. */
export function openingTag(source: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    } else if (char === '>' && depth === 0) {
      return source.slice(from, index);
    }
  }
  return source.slice(from);
}

/** Every .tsx under the roots, by its path from the repo with forward slashes, and its count. */
export function quietCounts(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const dir of QUIET_ROOTS) {
    for (const entry of readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })) {
      if (!entry.endsWith('.tsx')) continue;
      const file = path.posix.join(dir, entry.split(path.sep).join('/'));
      counts[file] = countQuietHints(readFileSync(path.join(root, file), 'utf8'));
    }
  }
  return counts;
}

/** What breaks the budget: a file over its number, or a file with hints and no entry. */
export function budgetProblems(
  counts: Record<string, number>,
  budget: Record<string, number>
): string[] {
  const problems: string[] = [];
  for (const [file, count] of Object.entries(counts)) {
    if (count === 0) continue;
    const allowed = budget[file];
    if (allowed === undefined) {
      problems.push(
        `${file} has ${count} hint paragraph${count === 1 ? '' : 's'} and no budget entry.`
      );
    } else if (count > allowed) {
      problems.push(`${file} has ${count} hint paragraphs; its budget is ${allowed}.`);
    }
  }
  return problems;
}
