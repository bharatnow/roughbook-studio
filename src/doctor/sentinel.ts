import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** Files larger than this are skipped: a sentinel in a bundle is found long before. */
const READ_LIMIT = 64 * 1024 * 1024;
/** An archive's entry larger than this, unpacked, is skipped likewise. */
const ENTRY_LIMIT = 64 * 1024 * 1024;

/**
 * Archives a build packs its output into, whose entries are compressed: the sentinel is looked for
 * in each entry unpacked, since a compressed one would hide it.
 */
const ARCHIVES = /\.(?:zip|jar|aar|apk|aab|ipa|appx|msix|war)$/i;

/**
 * The entries of a zip archive, unpacked one at a time: stored and deflated ones (what every
 * build tool writes), from the central directory. Nothing for bytes that are not a zip.
 */
export function zipEntries(bytes: Buffer): { name: string; data: () => Buffer | null }[] {
  // The end of central directory record is in the last 64 KB and 22 bytes.
  const from = Math.max(0, bytes.length - 0xffff - 22);
  let end = -1;
  for (let at = bytes.length - 22; at >= from; at -= 1) {
    if (bytes.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end === -1) return [];
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const entries: { name: string; data: () => Buffer | null }[] = [];
  for (let index = 0; index < count && at + 46 <= bytes.length; index += 1) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    entries.push({
      name,
      data: () => {
        if (size > ENTRY_LIMIT || local + 30 > bytes.length) return null;
        if (bytes.readUInt32LE(local) !== 0x04034b50) return null;
        const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
        const packed = bytes.subarray(start, start + compressed);
        try {
          if (method === 0) return packed;
          if (method === 8) return zlib.inflateRawSync(packed, { maxOutputLength: ENTRY_LIMIT });
        } catch {
          return null;
        }
        return null;
      }
    });
  }
  return entries;
}

/**
 * Where the sentinel appears under the build's output folders, repo-relative with forward
 * slashes: proof that something from rough/ reached the production build (decision 11). Inside an
 * archive (an app package, a jar), the entry is named after the archive: `app.apk!classes.dex`.
 */
export function findSentinel(repo: string, output: string[], sentinel: string): string[] {
  const found: string[] = [];
  const needle = Buffer.from(sentinel);
  const walk = (dir: string, relative: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) {
        try {
          if (fs.statSync(full).size > READ_LIMIT) continue;
          const bytes = fs.readFileSync(full);
          if (bytes.includes(needle)) found.push(rel);
          else if (ARCHIVES.test(entry.name)) {
            for (const item of zipEntries(bytes)) {
              if (item.data()?.includes(needle)) found.push(`${rel}!${item.name}`);
            }
          }
        } catch {
          // Unreadable: not part of the build we can check.
        }
      }
    }
  };
  for (const folder of output) {
    // `.` is the repo itself, as a site published from its root lists it.
    const clean =
      folder === '.' || folder === './' ? '' : folder.replace(/^\.\//, '').replace(/\/+$/, '');
    walk(path.join(repo, ...clean.split('/')), clean);
  }
  return found.sort();
}
