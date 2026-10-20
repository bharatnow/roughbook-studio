/** The sentence every recipe's placeholder shows, so a slot not yet written can be told apart. */
export const PLACEHOLDER_LINE =
  'Not yet generated. Your agent writes this iteration from its prompt in rough/.';

/** v2's placeholder, which named Claude Code; a repo it prepared may still have some. */
const V2_PLACEHOLDER_LINE =
  'Not yet generated. Paste the compiled prompt into Claude Code to fill this iteration.';

export function isPlaceholder(text: string): boolean {
  return text.includes(PLACEHOLDER_LINE) || text.includes(V2_PLACEHOLDER_LINE);
}
