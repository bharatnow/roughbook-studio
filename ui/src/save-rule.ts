// The prompt's `saveRule` (I3 of the chat audit): a rule goes to `POST /api/rules` with its scope and,
// for a component, the selection's slugs. The answer is a line for the card: where the rule went, or
// the refusal in words.

type Selection = { page: string | null; component: string | null; name: string | null };
type RuleInput = {
  text: string;
  scope: 'component' | 'project';
  page?: string;
  component?: string;
};

/** The prompt's rule saver for this selection; `post` is the local server's call. */
export function saveRuleFrom(
  selection: Selection,
  post: (path: string, body: unknown) => Promise<unknown>,
  describe: (error: unknown) => string
) {
  const { page, component, name } = selection;
  return async (input: RuleInput): Promise<{ ok: boolean; message: string }> => {
    const { text, scope } = input;
    // The card may name the component the words were about, rather than the selection.
    const to = input.component ?? component;
    try {
      await post('/api/rules', {
        text,
        scope,
        ...(scope === 'component' ? { page: input.page ?? page, component: to } : {})
      });
      return {
        ok: true,
        message:
          scope === 'component'
            ? `Saved to ${to === component ? (name ?? to) : to}’s constraints`
            : 'Saved to the project’s rules'
      };
    } catch (error) {
      return { ok: false, message: describe(error) };
    }
  };
}
