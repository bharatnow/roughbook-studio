// The canvas prompt's Fork (B3): its words say what the fork changes, a line starting with
// `Keep:` what it keeps as the parent has it (comma-separated), and Clean start makes it radical.
// The local server checks the same fields as `roughbook run --fork --intent --keep --radical`.

/** A line that says what the fork keeps, rather than what it changes. */
const KEEP = /^keep:\s*/i;

/** The backend's limits for a fork, as src/runs/forkIntent.ts says them for the CLI. */
const MAX_KEPT = 12;
const KEPT_LENGTH = 80;
const CHANGE_LENGTH = 2000;

export type ForkPrompt = {
  intent?: { remain: string[]; change: string };
  radical?: true;
};

/** The fork's fields from the prompt's text, or the words to say beside it when it cannot be sent. */
export function forkPrompt(
  text: string,
  radical: boolean
): { fields: ForkPrompt } | { refusal: string } {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const remain = [
    ...new Set(
      lines
        .filter(line => KEEP.test(line))
        .flatMap(line => line.replace(KEEP, '').split(','))
        .map(item => item.trim())
        .filter(Boolean)
    )
  ];
  const change = lines
    .filter(line => !KEEP.test(line))
    .join('\n')
    .trim();
  if (remain.length && !change) {
    return { refusal: 'Say what the fork changes, beside the Keep: line.' };
  }
  if (remain.length > MAX_KEPT) {
    return {
      refusal: `Keep at most ${MAX_KEPT} things in one fork; this one lists ${remain.length}.`
    };
  }
  const long = remain.find(item => item.length > KEPT_LENGTH);
  if (long) {
    return {
      refusal: `Say each thing to keep in ${KEPT_LENGTH} characters or fewer: “${long.slice(0, 24)}…” is longer.`
    };
  }
  if (change.length > CHANGE_LENGTH) {
    return {
      refusal: `Say what changes in ${CHANGE_LENGTH} characters or fewer; this is ${change.length}.`
    };
  }
  return {
    fields: {
      ...(change ? { intent: { remain, change } } : {}),
      ...(radical ? { radical: true as const } : {})
    }
  };
}
