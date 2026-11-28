// The brief sheet's notices, kept apart from the sheet so a test reads them without
// @roughbook/ui's components.

import type { Component, StoredWordNotice } from '../types';

/**
 * The backend's notices on the primary message (ROUGHBOOK-PICK-WORDS-PLAN.md, W5): what the
 * sketches do with a saved line that meets the media or the look's structure. None from an older
 * backend, which sends no `notices`.
 */
export function primaryMessageNotices(component: Pick<Component, 'notices'>): StoredWordNotice[] {
  return (component.notices ?? []).filter(
    notice => notice.doc === 'component' && notice.key === 'messages.primary'
  );
}

/**
 * A person's line that is kept but loses is a warning; a pick's line left out or replaced is info,
 * as the web's `noticeTone` says.
 */
export const noticeTone = (
  notice: Pick<StoredWordNotice, 'source' | 'resolution'>
): 'warning' | 'info' =>
  notice.source === 'user' && notice.resolution === 'mark' ? 'warning' : 'info';
