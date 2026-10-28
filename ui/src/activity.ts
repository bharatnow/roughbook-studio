// What the open runs' agents are doing, as /api/state says (A8 step 5 of
// ROUGHBOOK-APPLE-PLAN.md), in the status button's words. "Waiting" is read from silence plus
// terminal bells (decision 37), so it is worded as a guess: "may be waiting for you".

/** The server's activityOf, as /api/state sends it (src/server/activity.ts). */
export type Activity = {
  state: 'idle' | 'working' | 'waiting' | 'attention';
  where: 'builtin' | 'headless' | 'terminal' | 'editor' | null;
  runId: string | null;
};

export type ActivityView = {
  word: string;
  /** An agent is working: the button spins. */
  spinning: boolean;
  /** An agent may want the designer: the button asks for attention. */
  attention: boolean;
};

/** The button's word for the activity; null when there is nothing to say (or an older server). */
export function activityView(state: { activity?: Activity } | null): ActivityView | null {
  const activity = state?.activity;
  if (!activity) return null;
  switch (activity.state) {
    case 'working':
      return { word: 'An agent is working', spinning: true, attention: false };
    case 'waiting':
      return { word: 'An agent may be waiting for you', spinning: false, attention: true };
    case 'attention':
      return { word: 'An agent is asking for you', spinning: false, attention: true };
    default:
      if (activity.where === 'terminal') {
        return { word: 'In your terminal', spinning: false, attention: false };
      }
      if (activity.where === 'editor') {
        return { word: 'In your editor', spinning: false, attention: false };
      }
      return null;
  }
}
