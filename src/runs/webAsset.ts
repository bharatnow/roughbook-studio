// A confirmed web asset written into a run's own folder (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T5). The
// bytes come from the backend, which fetched them through its guard; the studio writes them under
// the iteration's assets/ folder, by a safe name, within the backend's caps, and nowhere else.
import fs from 'node:fs';
import path from 'node:path';
import type { WebAssetView } from '../api/webAssets.js';
import { ASSETS_FOLDER } from './assets.js';

/** The backend's caps (utils/webAssets/rules.ts): 15 MB a file, 25 MB a video. */
export const WEB_ASSET_FILE_BYTES = 15 * 1024 * 1024;
export const WEB_ASSET_VIDEO_BYTES = 25 * 1024 * 1024;

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*\.[A-Za-z0-9]{1,12}$/;
const SAFE_FOLDER = /^rough(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;

/** The file's name in the folder: the backend's stored name, when it is a plain one. */
export function webAssetName(asset: Pick<WebAssetView, 'fileName'>): string {
  const name = asset.fileName ?? '';
  if (!SAFE_NAME.test(name) || name.length > 120) {
    throw new Error(
      `The asset's file name (${JSON.stringify(name)}) is not one the studio writes.`
    );
  }
  return name;
}

/**
 * Writes the bytes into `<folder>/assets/<name>`, refusing a folder outside rough/, a name that
 * leaves it, more than the backend's caps, or bytes other than the size on record. Answers the
 * repo-relative file and the path an iteration's entry file imports it by.
 */
export function writeWebAsset(
  repoRoot: string,
  targetFolder: string,
  asset: Pick<WebAssetView, 'fileName' | 'size' | 'contentType'>,
  bytes: Buffer
): { file: string; importPath: string } {
  if (!SAFE_FOLDER.test(targetFolder) || targetFolder.split('/').some(part => /^\.+$/.test(part))) {
    throw new Error(`The run's folder ${targetFolder} is not inside rough/.`);
  }
  const name = webAssetName(asset);
  const cap = asset.contentType?.startsWith('video/')
    ? WEB_ASSET_VIDEO_BYTES
    : WEB_ASSET_FILE_BYTES;
  if (bytes.length > cap) {
    throw new Error(`The asset is over the ${Math.round(cap / 1024 / 1024)} MB a run may copy.`);
  }
  if (asset.size !== null && bytes.length !== asset.size) {
    throw new Error('The asset that came down is not the size on record; nothing was written.');
  }
  const folder = path.resolve(repoRoot, ...targetFolder.split('/'));
  const target = path.resolve(folder, ASSETS_FOLDER, name);
  if (!target.startsWith(folder + path.sep)) {
    throw new Error(`The asset would land outside ${targetFolder}; nothing was written.`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return {
    file: `${targetFolder}/${ASSETS_FOLDER}/${name}`,
    importPath: `./${ASSETS_FOLDER}/${name}`
  };
}
