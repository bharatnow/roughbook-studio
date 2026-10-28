// What the studio says back after a control is used (A8 step 5 of ROUGHBOOK-APPLE-PLAN.md): a
// line in an <output> beside that control, not a notice floating in the corner. Pure, so the tests
// can read it; `parts/output-line.tsx` draws it.

export type LineTone = 'info' | 'error';

/** One thing said back, with when, so the newest of several wins. */
export type Line = { tone: LineTone; text: string; at: number };

export function lineOf(tone: LineTone, text: string, at = Date.now()): Line {
  return { tone, text, at };
}

export function infoLine(text: string, at = Date.now()): Line {
  return lineOf('info', text, at);
}

/** A failure in words: an Error's message, or the thing itself as text. */
export function errorLine(error: unknown, at = Date.now()): Line {
  const text = error instanceof Error ? error.message : String(error);
  return lineOf('error', text, at);
}

/** The newest of the lines a place can show, or null when none is. */
export function newest(...lines: (Line | null | undefined)[]): Line | null {
  let best: Line | null = null;
  for (const line of lines) {
    if (line && (!best || line.at >= best.at)) best = line;
  }
  return best;
}

/** A decision's words: as sent, or waiting in the outbox. */
export function decidedText(done: string, status: 'sent' | 'queued'): string {
  return status === 'queued'
    ? `${done} It waits in the outbox until the server can be reached.`
    : done;
}

/** A plain verb's answer, or its Undo's. */
export function verbLine(result: { ok: boolean; message: string }, at = Date.now()): Line {
  return lineOf(result.ok ? 'info' : 'error', result.message, at);
}

/** What Take screenshots answers: how many, or the warning. */
export function shotsLine(
  shots: { files: Record<string, string>; warning: string | null },
  at = Date.now()
): Line {
  if (shots.warning) return lineOf('error', shots.warning, at);
  const count = Object.keys(shots.files).length;
  return infoLine(`Took ${count} screenshot${count === 1 ? '' : 's'}.`, at);
}
