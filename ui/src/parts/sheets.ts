// Which of the local UI's one-time sheets shows now (A4 of ROUGHBOOK-APPLE-PLAN.md): the
// project's pictures question while nobody has answered it, then the privacy sheet once per
// install. Pure, so a test can read it.

/**
 * What No does, said before it: the backend deletes a project's stored pictures on a no, and the
 * studio cannot tell whether there are any, so the sheet always says it.
 */
export const PICTURES_NO_WARNING =
  'If this project already has pictures on Roughbook, No deletes them for good, for its team and client reviewers too.';

/** The sheet's line once the no is saved. */
export const PICTURES_NO_SAID =
  "This project's pictures stay on this machine. Any already on Roughbook are deleted. Turn them on with roughbook pictures on.";

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
