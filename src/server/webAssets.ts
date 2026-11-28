// The local UI's Assets screen (ROUGHBOOK-STUDIO-PARITY-PLAN.md, after T5): `GET /api/web-assets`
// reads the project's confirmed files and the runs' proposals waiting for the maker, and
// `POST /api/web-assets/:id/confirm` or `/reject` answers one. Only the asset's id and the licence
// the maker typed go to the backend, which fetches the file through its own guard; this machine
// never opens the source address, and nothing is kept here.
import type { StudioApi } from '../api/client.js';
import type { ProjectWebAssets, WebAssetView } from '../api/webAssets.js';
import { redactLocalPaths } from '../runs/localPaths.js';
import { BadRequest } from './studio.js';

/** What the routes need from the studio: the client and the linked project. */
export type WebAssetsSource = { api: StudioApi; link: { orgId: string; project: string } };

/** The longest licence the backend keeps. */
export const MAX_LICENCE = 200;

/** An asset's id as the backend issues it; anything else never reaches a URL. */
const ASSET_ID = /^[A-Za-z0-9_-]{1,100}$/;

function list(value: unknown): WebAssetView[] {
  return Array.isArray(value) ? (value as WebAssetView[]) : [];
}

export async function loadWebAssets({ api, link }: WebAssetsSource): Promise<ProjectWebAssets> {
  const reply = await api.projectWebAssets(link.orgId, link.project);
  return { confirmed: list(reply?.confirmed), pending: list(reply?.pending) };
}

function assetId(value: unknown): string {
  if (typeof value !== 'string' || !ASSET_ID.test(value)) {
    throw new BadRequest('That is not a file waiting for you.');
  }
  return value;
}

/**
 * The licence the maker typed, trimmed; undefined when they left it empty, so the run's stays.
 * Refused in words when it is too long or names a path on this machine.
 */
export function parseLicence(body: Record<string, unknown>): string | undefined {
  if (body.licence === undefined || body.licence === null) return undefined;
  if (typeof body.licence !== 'string') throw new BadRequest('Write the licence as words.');
  const licence = body.licence.trim();
  if (!licence) return undefined;
  if (licence.length > MAX_LICENCE) {
    throw new BadRequest(`A licence is ${MAX_LICENCE} characters at most.`);
  }
  if (redactLocalPaths([licence]).paths.size) {
    throw new BadRequest('A licence cannot name a path on this machine. Name the licence itself.');
  }
  return licence;
}

/** Confirm: the backend fetches it; its refusals (409, 503) pass on as ApiErrors, in words. */
export async function confirmWebAsset(
  { api, link }: WebAssetsSource,
  id: unknown,
  body: Record<string, unknown>
): Promise<WebAssetView> {
  const asset = assetId(id);
  const licence = parseLicence(body);
  return api.confirmWebAsset(
    link.orgId,
    link.project,
    asset,
    licence === undefined ? {} : { licence }
  );
}

/** Decline: nothing is fetched. */
export async function rejectWebAsset(
  { api, link }: WebAssetsSource,
  id: unknown
): Promise<WebAssetView> {
  return api.rejectWebAsset(link.orgId, link.project, assetId(id));
}
