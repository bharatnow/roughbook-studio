// A late fact change in the local UI (ROUGHBOOK-FACT-CHANGE-PLAN.md, U5): @roughbook/ui's FactSheet
// posts FormData, as the web's server actions take it; here each form becomes the JSON body of the
// local server's /api/facts/… route, by the sheet's own field names. A call that fails reads as a
// sheet or a change that says so in words, never as a thrown error.
import { FACT_FIELDS, type FactChangeDone, type FactSheetData } from '@roughbook/ui/fact-sheet';

type Post = (path: string, body: unknown) => Promise<unknown>;
type Describe = (error: unknown) => string;

/** The change's body: the summary and the edits as shown, and the ticked places' ids. */
export function changeBody(form: FormData): { summary: string; edits: unknown; places: string[] } {
  const raw = form.get(FACT_FIELDS.edits);
  let edits: unknown = null;
  try {
    edits = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    edits = null;
  }
  const summary = form.get(FACT_FIELDS.summary);
  return {
    summary: typeof summary === 'string' ? summary : '',
    edits,
    places: form
      .getAll(FACT_FIELDS.place)
      .filter((value): value is string => typeof value === 'string' && value !== '')
  };
}

/** The undo's body: every change id the sheet holds. */
export function undoBody(form: FormData): { changeIds: string[] } {
  return {
    changeIds: form
      .getAll(FACT_FIELDS.changeId)
      .filter((value): value is string => typeof value === 'string' && value !== '')
  };
}

/** What a sheet shows when its reading could not be had. */
export function unreadSheet(words: string, refusal: string): FactSheetData {
  return { reading: { summary: words, edits: [], unsure: null }, places: [], adds: [], refusal };
}

/** Reads the words into a sheet through the local server; a failure is a refusal in words. */
export async function readSheet(
  words: string,
  post: Post,
  describe: Describe
): Promise<FactSheetData> {
  try {
    return (await post('/api/facts/read', { words })) as FactSheetData;
  } catch (error) {
    return unreadSheet(words, describe(error));
  }
}

/** The sheet's `change`: the form as the change's body, and the answer, or the refusal, in words. */
export function changeFrom(post: Post, describe: Describe, onDone?: () => void) {
  return async (previous: FactChangeDone | null, form: FormData): Promise<FactChangeDone> => {
    void previous;
    const body = changeBody(form);
    try {
      return (await post('/api/facts/change', body)) as FactChangeDone;
    } catch (error) {
      return { ok: false, message: describe(error), summary: body.summary, changeIds: [] };
    } finally {
      onDone?.();
    }
  };
}

/** The sheet's `undo`: every change id, newest first on the server. What is left stays to try again. */
export function undoFrom(post: Post, describe: Describe, onDone?: () => void) {
  return async (previous: FactChangeDone | null, form: FormData): Promise<FactChangeDone> => {
    const body = undoBody(form);
    try {
      return (await post('/api/facts/undo', body)) as FactChangeDone;
    } catch (error) {
      return {
        ok: false,
        message: describe(error),
        summary: previous?.summary ?? '',
        changeIds: body.changeIds
      };
    } finally {
      onDone?.();
    }
  };
}
