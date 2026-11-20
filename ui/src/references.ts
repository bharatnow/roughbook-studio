// The studio host's attach for @roughbook/ui's composer (ROUGHBOOK-WHOLE-SITE-PLAN.md, X10). On
// the web an attached file is uploaded to the backend; here it is the client's, so the local
// server copies it into rough/references/ and it stays on this machine. The run's prompt lists it
// by path, and nothing of it goes to Roughbook.
import { post } from './api';
import { describe } from './data';

/** What the local server answers a reference with. */
type Kept = { id: string; path: string; kind: string; roles: string[]; summary: string };

/** The host's answer: the reference's id and its one line, or a refusal in words. */
export type LocalAttached =
  { ok: true; id: string; summary: string } | { ok: false; error: string };

/** A file's bytes as base64, without the data URL's prefix. */
function base64Of(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Copies a file, or keeps a link, in rough/references/ through `POST /api/references`. Takes a
 * link as a string or URL too, for the composer's link field once @roughbook/ui has one.
 */
export async function attachLocalReference(item: File | URL | string): Promise<LocalAttached> {
  try {
    const body =
      typeof item === 'string' || item instanceof URL
        ? { url: String(item) }
        : { fileName: item.name, data: await base64Of(item) };
    const kept = await post<Kept>('/api/references', body);
    return { ok: true, id: kept.id, summary: kept.summary };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** The ids the composer's hidden `references` field holds, comma-joined. */
export function referenceIds(value: FormDataEntryValue | null): string[] {
  return typeof value === 'string'
    ? [
        ...new Set(
          value
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)
        )
      ]
    : [];
}
