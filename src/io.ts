import { createInterface } from 'node:readline/promises';

/** Where a command writes and asks. The CLI passes the terminal; tests pass a recorder. */
export type Io = {
  out(line: string): void;
  err(line: string): void;
  /** Asks a question and returns the answer, or null when nobody is there to answer. */
  ask(question: string): Promise<string | null>;
};

export function terminalIo(): Io {
  return {
    out: line => void process.stdout.write(`${line}\n`),
    err: line => void process.stderr.write(`${line}\n`),
    async ask(question) {
      if (!process.stdin.isTTY) return null;
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return (await readline.question(question)).trim();
      } finally {
        readline.close();
      }
    }
  };
}

/** How a refusal starts when nobody could answer: an agent's shell, CI, an IDE task. */
export const NOBODY_ANSWERS = 'Nobody can answer here (no terminal)';

/**
 * Asks a yes or no question: `fallback` when the answer is empty, null when nobody can answer.
 * Nobody answering is never a yes (decision 18).
 */
export async function askYesNo(
  io: Io,
  question: string,
  fallback: boolean
): Promise<boolean | null> {
  const answer = await io.ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `);
  if (answer === null) return null;
  if (!answer) return fallback;
  return /^y(es)?$/i.test(answer);
}

/** Asks a yes or no question; `fallback` when the answer is empty, no when nobody can answer. */
export async function confirm(io: Io, question: string, fallback: boolean): Promise<boolean> {
  return (await askYesNo(io, question, fallback)) ?? false;
}
