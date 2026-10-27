// Whether an iteration compiles, for a switch whose bundler keeps a module that once failed in the
// graph of every page that can import it (B5b of ROUGHBOOK-BROWNFIELD-PLAN.md, decision 45): such a
// dev server, once a swap has asked it for an iteration that does not compile, fails the plain page
// too. The studio checks each iteration with esbuild before the switch's registry may import it:
// its files parse, and every import it makes resolves. One that does not is left out of the graph,
// and only a swap that asks for it fails. The answer is kept until a file in the folder or one it
// was bundled from changes, so the registry can be rewritten every few seconds (roughbook start)
// without checking again.
import fs from 'node:fs';
import path from 'node:path';
import { buildSync, type Message } from 'esbuild';

/** Files that never fail a compile here: styles, pictures, fonts and media, loaded as nothing. */
const ASSETS = [
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp4',
  '.webm',
  '.mp3'
];

/** How many bundles were made, for the tests: none while nothing an answer was kept for changed. */
export const compileStats = { bundles: 0 };

/**
 * Each folder's answer, kept for its own files' stamp and those of the files it was bundled from
 * outside it (review finding 10): a fixed app file lets the iteration back in, the folder unchanged.
 * `inputs` is null when the answer cannot be kept (an import the studio cannot place).
 */
const checked = new Map<
  string,
  { stamp: string; inputs: string[] | null; inputsStamp: string; problem: string | null }
>();

/** Files and folders by time and size, or as absent: what else an answer is kept for. */
function stampPaths(repo: string, files: string[]): string {
  return files
    .map(file => {
      const stat = fs.statSync(path.resolve(repo, file), { throwIfNoEntry: false });
      return `${file}:${stat ? `${stat.mtimeMs}:${stat.size}` : 'none'}`;
    })
    .join('|');
}

/**
 * What a failed bundle depends on outside the folder: the file each error is in, and for a
 * relative import it could not find, the folder that file would be in, which changes when it is
 * made. Null for an import the studio cannot place (an alias), so that answer is not kept.
 */
function failureInputs(errors: Message[], repo: string, dir: string): string[] | null {
  const inputs = new Set<string>();
  for (const error of errors) {
    if (!error.location) continue;
    const importer = path.resolve(repo, error.location.file);
    if (!importer.startsWith(dir + path.sep)) inputs.add(importer);
    const missing = /^Could not resolve "([^"]+)"/.exec(error.text)?.[1];
    if (missing === undefined) continue;
    if (!missing.startsWith('.')) return null;
    inputs.add(path.dirname(path.resolve(path.dirname(importer), missing)));
  }
  return [...inputs];
}

/** What the folder holds now, by name, time and size: what the answer is kept for. */
function stamp(dir: string): string {
  const parts: string[] = [];
  const walk = (at: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      // The kept base of a fork from the app is never imported (decision 31).
      if (entry.name === '.base' || entry.name === 'node_modules') continue;
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else {
        const stat = fs.statSync(full, { throwIfNoEntry: false });
        if (stat) parts.push(`${prefix}${entry.name}:${stat.mtimeMs}:${stat.size}`);
      }
    }
  };
  walk(dir, '');
  return parts.join('|');
}

/** esbuild's message with where it is, from the iteration's folder; its paths are from the repo. */
function describe(message: Message, repo: string, dir: string): string {
  const where = message.location
    ? `${path.relative(dir, path.resolve(repo, message.location.file)).split(path.sep).join('/')}:${message.location.line}:${message.location.column} `
    : '';
  return `${where}${message.text}`;
}

/**
 * Why the iteration in `folder` (repo-relative) does not compile from its `entry`, in esbuild's
 * words with the file and line, or null when it does. The app's own files and packages it imports
 * are bundled as the app's bundler would follow them, packages left out: a broken app file breaks
 * the page anyway.
 */
export function compileProblem(repo: string, folder: string, entry: string): string | null {
  const dir = path.join(repo, ...folder.split('/'));
  const now = stamp(dir);
  const known = checked.get(dir);
  if (
    known?.stamp === now &&
    known.inputs !== null &&
    known.inputsStamp === stampPaths(repo, known.inputs)
  ) {
    return known.problem;
  }
  let problem: string | null = null;
  let inputs: string[] | null = [];
  compileStats.bundles += 1;
  try {
    const built = buildSync({
      entryPoints: [path.join(dir, entry)],
      absWorkingDir: repo,
      bundle: true,
      write: false,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      jsx: 'automatic',
      logLevel: 'silent',
      loader: Object.fromEntries(ASSETS.map(extension => [extension, 'empty' as const])),
      metafile: true
    });
    // The app's files it was bundled from; its own are in the folder's stamp.
    inputs = Object.keys(built.metafile.inputs)
      .map(file => path.resolve(repo, file))
      .filter(file => !file.startsWith(dir + path.sep));
  } catch (error) {
    // esbuild's own failure (no binary for this machine) says nothing of the iteration.
    const errors = (error as { errors?: Message[] }).errors ?? [];
    problem = errors[0] ? describe(errors[0], repo, dir) : null;
    inputs = errors.length ? failureInputs(errors, repo, dir) : null;
  }
  checked.set(dir, {
    stamp: now,
    inputs,
    inputsStamp: inputs === null ? '' : stampPaths(repo, inputs),
    problem
  });
  return problem;
}
