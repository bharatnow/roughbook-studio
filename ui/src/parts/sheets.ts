// Which of the local UI's one-time sheets shows now (A4 of ROUGHBOOK-APPLE-PLAN.md): the
// project's pictures question while nobody has answered it, then the privacy sheet once per
// install. Pure, so a test can read it.

/** What /api/state says of the two. `pictures` is absent while the project cannot be read. */
export type SheetsState = {
  pictures?: boolean | null;
  privacySheet?: readonly string[] | null;
};

export type SheetsSession = {
  /** "Ask me later" this session, or the question closed without an answer. */
  later: boolean;
  /** The privacy sheet was closed here, before the state says so. */
  privacyClosed: boolean;
};

export function nextSheet(
  state: SheetsState | null,
  session: SheetsSession
): 'pictures' | 'privacy' | null {
  if (!state) return null;
  if (state.pictures === null && !session.later) return 'pictures';
  if (state.privacySheet?.length && !session.privacyClosed) return 'privacy';
  return null;
}

/** The CLI's privacy lines as the sheet shows them: its heading, then "Label: sentence" items. */
export function privacyWords(lines: readonly string[]): {
  title: string;
  items: { label: string; text: string }[];
} {
  const [heading = '', ...rest] = lines;
  return {
    title: heading.trim().replace(/:$/, ''),
    items: rest.map(line => {
      const trimmed = line.trim();
      const colon = trimmed.indexOf(':');
      return colon > 0
        ? { label: trimmed.slice(0, colon), text: trimmed.slice(colon + 1).trim() }
        : { label: '', text: trimmed };
    })
  };
}
