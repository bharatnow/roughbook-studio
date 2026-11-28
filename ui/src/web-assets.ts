// The Assets screen (ROUGHBOOK-STUDIO-PARITY-PLAN.md, after T5): a run's proposals of files from
// the web, waiting for the maker's Confirm or Decline, then the project's confirmed files. Through
// the local server, which sends only the asset's id and the licence typed here; the backend
// fetches the file through its own guard, so this machine never opens the address. Pure, so a test
// can read it; `screens/assets.tsx` draws it.
import { Failure, get, post } from './api.ts';

/** A web asset as the local server passes on the backend's view; only what the screen reads. */
export type WebAsset = {
  id: string;
  status: 'pending' | 'confirmed' | 'rejected';
  sourceUrl: string;
  licence: string;
  /** Who named the licence: the maker, or the run that proposed it. */
  licenceFrom: string;
  reason: string | null;
  fileName: string | null;
  contentType: string | null;
  size: number | null;
  confirmedAt: string | null;
  createdAt: string;
};

export type WebAssets = { confirmed: WebAsset[]; pending: WebAsset[] };

/** The longest licence the backend keeps, as the local server's `MAX_LICENCE`. */
export const MAX_LICENCE = 200;

/** Said in the HelpTip beside the heading. */
export const FETCH_LINE =
  "Confirming fetches the file through Roughbook's service; your machine never opens the address.";

/** Said when nothing waits for the maker. */
export const NOTHING_WAITING =
  'Nothing is waiting for you. When a run asks for a file from the web, it appears here.';

export function loadWebAssets(): Promise<WebAssets> {
  return get<WebAssets>('/api/web-assets');
}

export function confirmPath(asset: Pick<WebAsset, 'id'>): string {
  return `/api/web-assets/${encodeURIComponent(asset.id)}/confirm`;
}

export function rejectPath(asset: Pick<WebAsset, 'id'>): string {
  return `/api/web-assets/${encodeURIComponent(asset.id)}/reject`;
}

export function removePath(asset: Pick<WebAsset, 'id'>): string {
  return `/api/web-assets/${encodeURIComponent(asset.id)}/remove`;
}

/** A file's name as the screen says it: its file name, or its address when it has none. */
export function assetName(asset: Pick<WebAsset, 'fileName' | 'sourceUrl'>): string {
  return asset.fileName || asset.sourceUrl;
}

/** Asked in place before Remove; there is no Undo. */
export function removeQuestion(asset: Pick<WebAsset, 'fileName' | 'sourceUrl'>): string {
  return `Remove ${assetName(asset)}? Iterations that use this file will show it missing. Runs can propose it again.`;
}

/** Confirm's body: the licence typed, trimmed, or nothing, so the run's licence stays. */
export function confirmBody(typed: string): { licence?: string } {
  const licence = typed.trim();
  return licence ? { licence } : {};
}

/** A size in words: bytes, KB or MB. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Its type and size, where the backend knows them; null when it knows neither. */
export function assetFacts(asset: Pick<WebAsset, 'contentType' | 'size'>): string | null {
  const parts = [
    asset.contentType || null,
    typeof asset.size === 'number' && asset.size >= 0 ? sizeText(asset.size) : null
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(' · ') : null;
}

/** The licence and who named it. */
export function licenceText(asset: Pick<WebAsset, 'licence' | 'licenceFrom'>): string {
  const licence = asset.licence.trim() || 'No licence named';
  return asset.licenceFrom === 'maker' ? licence : `${licence}, as the run named it`;
}

/** What a row says back after Confirm or Decline. */
export type Answer = { ok: boolean; message: string };

function refusal(error: unknown, fallback: string): Answer {
  return { ok: false, message: error instanceof Failure ? error.message : fallback };
}

export async function confirmAsset(asset: WebAsset, typed: string): Promise<Answer> {
  let confirmed: WebAsset;
  try {
    confirmed = await post<WebAsset>(confirmPath(asset), confirmBody(typed));
  } catch (error) {
    return refusal(error, 'Could not confirm it. Try again.');
  }
  const name = confirmed.fileName || 'The file';
  return { ok: true, message: `Confirmed. ${name} is in the project, under ${confirmed.licence}.` };
}

export async function declineAsset(asset: WebAsset): Promise<Answer> {
  try {
    await post<WebAsset>(rejectPath(asset));
  } catch (error) {
    return refusal(error, 'Could not decline it. Try again.');
  }
  return { ok: true, message: 'Declined. Nothing was fetched.' };
}

export async function removeAsset(asset: WebAsset): Promise<Answer> {
  try {
    await post<{ removed: true }>(removePath(asset));
  } catch (error) {
    return refusal(error, 'Could not remove it. Try again.');
  }
  return { ok: true, message: `Removed. ${assetName(asset)} is no longer in the project.` };
}

/** A row's answer, with the address it was about, so it can still be said once the row is gone. */
export type RowAnswer = Answer & { sourceUrl: string; section?: 'waiting' | 'project' };

/**
 * The answers whose rows are no longer listed (a declined proposal, one another maker answered
 * first, a removed file): the screen says these above their section's list, so no answer
 * disappears with its row.
 */
export function answersWithoutRows(
  answers: Record<string, RowAnswer>,
  assets: WebAssets,
  section: 'waiting' | 'project' = 'waiting'
): RowAnswer[] {
  const listed = new Set([...assets.pending, ...assets.confirmed].map(asset => asset.id));
  return Object.entries(answers)
    .filter(([id, answer]) => !listed.has(id) && (answer.section ?? 'waiting') === section)
    .map(([, answer]) => answer);
}
