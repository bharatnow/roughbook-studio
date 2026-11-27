// What the copied house rules and technique tool (src/rules/vendor/) import from backend files that
// are not copied: only the types they use, by hand. houseChecks.ts reads the backend's Finding from
// its checks.ts, whose code and message the studio's own Finding has, with `blocks` for a floor's;
// technique.ts reads the shape of a web sketch's extra tool, which the studio never runs.

/** One thing a check found: the code the backend records, the sentence the designer reads. */
export type Finding = { code: string; message: string; blocks?: true };

/** What a sketch's extra tool answers. */
export type ExtraToolOutcome = { content: string; isError: boolean };

/** A sketch's extra tool, as the backend offers it to the model: only its shape. */
export type ExtraTool = {
  tool: { name: string; description: string; input: Record<string, unknown> };
  run(input: Record<string, unknown>, context: unknown): Promise<ExtraToolOutcome>;
};
