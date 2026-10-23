'use strict';
// The standalone binary's entry (decision 35 of the frameworks plan). Node.js's single executable
// application runs this file. The binary carries the npm package as one asset, the image: dist/,
// package.json and the production node_modules for its own system (scripts/binary/lib.mjs makes
// it). The first run unpacks it into a folder of the cache named by its version and digest, and
// every run imports dist/cli.js from there, so the binary runs the same code as
// `npm install -g roughbook`, with no Node.js on the machine. Given a script instead (`-e <code>`,
// or a .js, .mjs or .cjs file), it runs it as node would: the studio starts Node scripts with its
// own runtime, as its terminal's check does.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const IMAGE_MAGIC = 'roughbook-image-1\n';

/** The files in an image: { path, mode, data } each. */
function unpack(image) {
  const raw = zlib.gunzipSync(image);
  const magic = Buffer.from(IMAGE_MAGIC, 'utf8');
  if (!raw.subarray(0, magic.length).equals(magic)) throw new Error('not a roughbook image');
  const length = raw.readUInt32BE(magic.length);
  const start = magic.length + 4;
  const index = JSON.parse(raw.subarray(start, start + length).toString('utf8'));
  let offset = start + length;
  return index.map(entry => {
    if (
      entry.path.split('/').some(part => part === '..' || part === '') ||
      /^[\\/]|:/.test(entry.path)
    ) {
      throw new Error(`unsafe path in the image: ${entry.path}`);
    }
    const data = raw.subarray(offset, offset + entry.size);
    offset += entry.size;
    return { path: entry.path, mode: entry.mode, data };
  });
}

/** Where images are unpacked: ROUGHBOOK_CACHE_DIR, or the system's own cache folder. */
function cacheRoot(env, platform, home) {
  if (env.ROUGHBOOK_CACHE_DIR) return env.ROUGHBOOK_CACHE_DIR;
  if (platform === 'win32') {
    return path.win32.join(
      env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'),
      'roughbook',
      'cache'
    );
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Caches', 'roughbook');
  return path.posix.join(env.XDG_CACHE_HOME || path.posix.join(home, '.cache'), 'roughbook');
}

/**
 * The folder the image `id` is unpacked in, unpacking it first when it is not there: into a
 * folder of its own, renamed into place when complete, so two first runs at once cannot leave
 * half an image. Other images, from versions before, are removed when a new one is unpacked.
 */
function ensureImage(root, id, readImage) {
  const dir = path.join(root, id);
  const done = path.join(dir, '.complete');
  if (fs.existsSync(done)) return dir;
  fs.mkdirSync(root, { recursive: true });
  const temp = `${dir}.${process.pid}.tmp`;
  fs.rmSync(temp, { recursive: true, force: true });
  for (const file of unpack(readImage())) {
    const target = path.join(temp, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.data, { mode: file.mode || 0o644 });
  }
  fs.writeFileSync(path.join(temp, '.complete'), `${id}\n`);
  try {
    fs.renameSync(temp, dir);
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    if (!fs.existsSync(done)) throw error;
  }
  for (const name of fs.readdirSync(root)) {
    if (name === id || name.endsWith('.tmp')) continue;
    try {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    } catch {
      // In use by an older version still running, or not ours to remove: left for next time.
    }
  }
  return dir;
}

/** Runs `args` as node would when they start with a script; false when they are the studio's. */
function runAsNode(args) {
  const [first, ...rest] = args;
  if (first === '-e' || first === '--eval') {
    const code = rest[0] ?? '';
    process.argv = [process.execPath, ...rest.slice(1)];
    const filename = path.join(process.cwd(), '[eval]');
    const evalModule = { exports: {} };
    const run = vm.runInThisContext(
      `(function (exports, require, module, __filename, __dirname) {${code}\n})`,
      { filename }
    );
    run.call(
      evalModule.exports,
      evalModule.exports,
      createRequire(filename),
      evalModule,
      filename,
      process.cwd()
    );
    return true;
  }
  if (first && /\.[cm]?js$/i.test(first) && fs.existsSync(first)) {
    const file = path.resolve(first);
    process.argv = [process.execPath, file, ...rest];
    import(pathToFileURL(file).href).catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
    return true;
  }
  return false;
}

function main() {
  const sea = require('node:sea');
  if (runAsNode(process.argv.slice(2))) return;
  const id = Buffer.from(sea.getRawAsset('image.id')).toString('utf8').trim();
  const root = cacheRoot(process.env, process.platform, os.homedir());
  let dir;
  try {
    dir = ensureImage(root, id, () => Buffer.from(sea.getRawAsset('image')));
  } catch (error) {
    console.error(
      `roughbook could not unpack itself into ${root}: ${error.message}. Set ROUGHBOOK_CACHE_DIR to a folder it can write.`
    );
    process.exitCode = 1;
    return;
  }
  import(pathToFileURL(path.join(dir, 'dist', 'cli.js')).href).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

let seaMain = false;
try {
  seaMain = require('node:sea').isSea();
} catch {
  seaMain = false;
}
if (seaMain) main();

module.exports = { IMAGE_MAGIC, unpack, cacheRoot, ensureImage, runAsNode };
