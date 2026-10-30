// Ground rule 2 of the split plan, for typed words. A direction or an intent may name a path on
// this machine. The backend stores those words and compiles them into the run's prompt, so a path
// goes out as a numbered stand-in, and the studio puts it back in the prompt it writes here: the
// agent reads what was typed, and the server never holds the path. Pure: no file is read.
import type { StartRunRequest } from './types.js';

/** What ends a bare path: space, the quotes around it, and what no file name holds. */
const REST = String.raw`[^\s"'${'`'}<>|*?]*`;
/** Not inside a longer word, a URL or a relative path. */
const OPEN = String.raw`(?<![\p{L}\p{N}_\-.:/\\~@%])`;

const WINDOWS = String.raw`(?<![\p{L}\p{N}_])[A-Za-z]:[\\/]`;
const UNC = String.raw`(?<![\\\p{L}\p{N}_])\\\\[^\s\\/"'${'`'}<>|*]+[\\/]`;
const FILE_URL = String.raw`(?<![\p{L}\p{N}_])[Ff][Ii][Ll][Ee]:[\\/]+`;
const TILDE = String.raw`${OPEN}~[\\/]`;
/** A root alone, such as the page /home, is a route; a path has something under it. */
const ROOT = String.raw`${OPEN}/(?:home|Users|root|etc|var|usr|opt|tmp|mnt|media|srv|bin|sbin|lib|lib64|boot|proc|sys|dev|run|nix|snap|private|Applications|Library|Volumes|System)/(?=[^\s"'${'`'}<>|*?])`;

/** Words after a backslashed path that end in another of its folders: C:\Program Files\app. */
const SPACED = String.raw`(?: [^\s"'${'`'}<>|*?\\/]+){1,3}\\${REST}`;

const START = `(?:${WINDOWS}|${UNC}|${FILE_URL}|${TILDE}|${ROOT})`;
const LOCAL_PATH = new RegExp(
  [
    // In quotes a path may hold spaces, and the quotes say where it ends.
    `(?<quote>["'${'`'}])(?<quoted>${START}[^"'${'`'}\\n]*)\\k<quote>`,
    `(?:${WINDOWS}|${UNC})${REST}(?:${SPACED})*`,
    `${START}${REST}`
  ].join('|'),
  'gu'
);
/** Sentence punctuation after a bare path is the sentence's. */
const TRAILING = /[.,;:!?)\]}]+$/;

const standIn = (number: number) => `[local path ${number}]`;

/** The stand-ins this request's words went out with, and the paths they hold. */
export type LocalPaths = Map<string, string>;

/**
 * Swaps each path in `texts` for a stand-in, the same path for the same stand-in. Everything else
 * stays as typed, and a stand-in the designer typed themselves is not reused.
 */
export function redactLocalPaths<T extends string[]>(
  texts: [...T]
): { texts: [...T]; paths: LocalPaths } {
  const paths: LocalPaths = new Map();
  const seen = new Map<string, string>();
  let number = 0;
  const next = () => {
    do number += 1;
    while (texts.some(text => text.includes(standIn(number))));
    return standIn(number);
  };
  const swap = (found: string) => {
    let name = seen.get(found);
    if (!name) {
      name = next();
      seen.set(found, name);
      paths.set(name, found);
    }
    return name;
  };
  const redacted = texts.map(text =>
    text.replace(LOCAL_PATH, (match: string, ...rest: unknown[]) => {
      const groups = rest.at(-1) as { quote?: string; quoted?: string };
      if (groups.quote) return `${groups.quote}${swap(groups.quoted!)}${groups.quote}`;
      const tail = TRAILING.exec(match)?.[0] ?? '';
      return `${swap(match.slice(0, match.length - tail.length))}${tail}`;
    })
  ) as [...T];
  return { texts: redacted, paths };
}

/** Puts the paths back into a prompt the backend compiled from redacted words. */
export function restoreLocalPaths(prompt: string, paths: LocalPaths): string {
  let restored = prompt;
  for (const [name, found] of paths) restored = restored.replaceAll(name, () => found);
  return restored;
}

/** Each typed field of a run request, by where it sits, for reading and for writing back. */
function typedWords(request: StartRunRequest): {
  texts: string[];
  rebuild: (texts: string[]) => StartRunRequest;
} {
  if (request.kind === 'generate') {
    const texts = request.directions.flatMap(item => [item.direction, item.hypothesis ?? '']);
    return {
      texts,
      rebuild: words => ({
        ...request,
        directions: request.directions.map((item, index) => ({
          ...item,
          direction: words[index * 2]!,
          ...(item.hypothesis === undefined ? {} : { hypothesis: words[index * 2 + 1]! })
        }))
      })
    };
  }
  if (request.kind === 'fork' && request.intent) {
    const { change, remain } = request.intent;
    return {
      texts: [change, ...remain],
      rebuild: ([newChange, ...newRemain]) => ({
        ...request,
        intent: { change: newChange!, remain: newRemain }
      })
    };
  }
  if (request.kind === 'refine') {
    return {
      texts: [request.intent, request.preserve ?? ''],
      rebuild: ([intent, preserve]) => ({
        ...request,
        intent: intent!,
        ...(request.preserve === undefined ? {} : { preserve: preserve! })
      })
    };
  }
  return { texts: [], rebuild: () => request };
}

/** The request as it may leave this machine, and what the prompt needs put back. */
export function redactRunRequest(request: StartRunRequest): {
  request: StartRunRequest;
  paths: LocalPaths;
} {
  const { texts, rebuild } = typedWords(request);
  const redacted = redactLocalPaths(texts);
  return { request: rebuild(redacted.texts), paths: redacted.paths };
}
