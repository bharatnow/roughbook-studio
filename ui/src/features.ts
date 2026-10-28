// The Complete features switch in the local UI (A7 of ROUGHBOOK-APPLE-PLAN.md, decision 12). The
// account's answer comes through /api/state; the local server sends a change to the backend.

/** The switch as the state says it; a studio server from before the switch reads as on. */
export function completeFeaturesOf(state: { completeFeatures?: boolean } | null): boolean {
  return state?.completeFeatures ?? true;
}

/**
 * Sets the switch through the local server, which calls PUT /studio/me/features, then reads the
 * state again. A refusal comes back in words for the switch to show beside it.
 */
export async function switchCompleteFeatures(
  on: boolean,
  deps: {
    post: (path: string, body: { on: boolean }) => Promise<unknown>;
    refresh: () => Promise<void>;
  }
): Promise<{ ok: boolean; message: string }> {
  try {
    await deps.post('/api/features', { on });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  await deps.refresh();
  return {
    ok: true,
    message: on
      ? 'Complete features on: every tool is in reach.'
      : 'Complete features off: the everyday tools only.'
  };
}
