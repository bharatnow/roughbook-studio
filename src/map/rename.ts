// Renames (B7 of ROUGHBOOK-BROWNFIELD-PLAN.md, decision 63): a component no longer found at its
// file and export is the same one as a component found new when its code is mostly the same.
// Its code's shape is the set of its own statement's lines that say something, with its imports
// left out (a move rewrites them) and its own name set aside (a rename in place changes only
// that), each line hashed short so the studio's state keeps a component's shape, never its code.
import { createHash } from 'node:crypto';

/**
 * What a rename is matched by: the component (a slug for one lost, a key for one found), where it
 * was or is, what it exports, and its shape.
 */
export type Shaped = { id: string; file: string; export: string; shape: string[] };

/** How much of the code must be the same: more when neither the file nor the export is. */
export const SAME_PLACE = 0.6;
export const ELSEWHERE = 0.8;

const IMPORTS = [
  /^\s*import\s[\s\S]*?\sfrom\s*['"][^'"]+['"];?/gm,
  /^\s*import\s*['"][^'"]+['"];?/gm,
  /^\s*export\s*(?:\*|\{[^}]*\})\s*from\s*['"][^'"]+['"];?/gm
];

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A line that starts a statement of the file's own, at its left edge. */
const TOP_LEVEL =
  /^(?:export\b|function\b|const\b|let\b|var\b|class\b|async\b|type\b|interface\b|enum\b|\/\*\*|\/\/|[A-Za-z_$][\w$]*\s*\.)/;

/**
 * The statement that declares `name` in `code`, up to the next statement at the file's left edge:
 * one component of a file of several (shadcn's card.tsx), so another's change is not its own.
 * The whole code when nothing declares it by that name (a template, an anonymous default).
 */
function ownStatement(code: string, name: string): string {
  if (!name) return code;
  const declares = new RegExp(
    `^(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?\\s+|(?:const|let|var|class)\\s+)${escaped(name)}\\b`
  );
  const lines = code.split('\n');
  const start = lines.findIndex(line => declares.test(line));
  if (start === -1) return code;
  let end = start + 1;
  while (end < lines.length && !TOP_LEVEL.test(lines[end]!)) end += 1;
  return lines.slice(start, end).join('\n');
}

/**
 * A component's shape: each line of the statement that declares it (the file, when none does),
 * trimmed and with runs of space made one, the component's name as `$`, imports and lines of
 * punctuation alone left out, hashed.
 */
export function codeShape(text: string, name: string): string[] {
  let code = text.replace(/\r\n/g, '\n');
  for (const pattern of IMPORTS) code = code.replace(pattern, '');
  code = ownStatement(code, name);
  const own = name ? new RegExp(`\\b${escaped(name)}\\b`, 'g') : null;
  const shape: string[] = [];
  for (const raw of code.split('\n')) {
    const line = (own ? raw.replace(own, '$') : raw).trim().replace(/\s+/g, ' ');
    if ((line.match(/[A-Za-z0-9_]/g) ?? []).length < 3) continue;
    shape.push(createHash('sha1').update(line).digest('hex').slice(0, 8));
  }
  return shape;
}

/** How alike two shapes are, counting repeated lines: what both have over what either has. */
export function likeness(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const counts = new Map<string, number>();
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1);
  let both = 0;
  for (const line of b) {
    const left = counts.get(line) ?? 0;
    if (left > 0) {
      both += 1;
      counts.set(line, left - 1);
    }
  }
  return both / (a.length + b.length - both);
}

/**
 * Which of the components no longer found (`lost`) are which of those found new (`fresh`), by id
 * (lost to fresh), each at most once, the likest first. A pair is the same component when its
 * code is the same past `SAME_PLACE` and it kept its file or its export, or past `ELSEWHERE`
 * when it kept neither. A file split in two or two merged into one are none: each part has too
 * little of the whole.
 */
export function matchRenames(lost: Shaped[], fresh: Shaped[]): Map<string, string> {
  const pairs: { lost: string; fresh: string; score: number }[] = [];
  for (const before of lost) {
    for (const now of fresh) {
      const score = likeness(before.shape, now.shape);
      const kept = before.file === now.file || before.export === now.export;
      if (score >= (kept ? SAME_PLACE : ELSEWHERE)) {
        // The same place breaks a tie: a file's two components move together.
        pairs.push({ lost: before.id, fresh: now.id, score: score + (kept ? 0.001 : 0) });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const matched = new Map<string, string>();
  const taken = new Set<string>();
  for (const pair of pairs) {
    if (matched.has(pair.lost) || taken.has(pair.fresh)) continue;
    matched.set(pair.lost, pair.fresh);
    taken.add(pair.fresh);
  }
  return matched;
}
