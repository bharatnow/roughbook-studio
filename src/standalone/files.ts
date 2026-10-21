// The files the standalone server hands a browser: from the site's public folder, at the paths
// its pages link them by, and from an iteration's own folder. Only what a browser loads, never a
// dotfile, and nothing outside the folder it was asked of.
import fs from 'node:fs';
import path from 'node:path';

/** What a browser loads, by extension: the only files served. Server code and sources are not. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json'
};

/** The content type a file is served with, or null for a file the server does not hand out. */
export function contentType(name: string): string | null {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? null;
}

/**
 * The file under `root` that a path on the site names, with its type: a folder's index.html
 * for a folder. Null for a dotfile or dot folder, anything outside `root`, a file the server
 * does not hand out, or one `refuse` turns down (given its path relative to `root`).
 */
export function siteFile(
  root: string,
  sitePath: string,
  refuse: (relative: string) => boolean = () => false
): { file: string; type: string } | null {
  let segments: string[];
  try {
    segments = sitePath.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.some(segment => segment.startsWith('.') || /[\\/\0]/.test(segment))) return null;
  const base = path.resolve(root);
  let file = path.resolve(base, ...segments);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  const relative = path.relative(base, file).split(path.sep).join('/');
  if (refuse(relative)) return null;
  const type = contentType(file);
  return type ? { file, type } : null;
}
