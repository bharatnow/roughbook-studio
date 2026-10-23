// Decision 35 of the frameworks plan: the standalone binary. Its build (scripts/binary/lib.mjs)
// picks the npm package's production dependencies for each system from the lockfile, packs the
// image the binary unpacks, and writes the archives, checksums and manifests; its entry
// (packaging/entry.cjs) unpacks the image once per version and runs a script as node would; and
// the studio, running as the binary, starts npm, npx and agents' scripts with the PATH's Node.js
// and registers itself, not a cache path, as the MCP server. Building a real binary needs
// Node.js's downloads and postject, so `npm run binary` does that, not this test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostPlatform } from '../launch/platform.js';
import { npmScript } from '../launch/processes.js';
import { scriptNode, stableBinaryPath, standaloneBinary } from '../launch/runtime.js';
import { serverCommand } from '../mcp/install.js';
import { tempDir } from './helpers.js';

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type FileEntry = { path: string; mode: number; data: Buffer };
type Lib = {
  TARGETS: Record<string, { os: string; cpu: string; exe: string; archive: string }>;
  hostTarget(platform: string, arch: string): string | null;
  archiveName(target: string): string;
  productionPackages(
    lock: unknown,
    target: string
  ): { path: string; version: string; resolved: string; integrity: string }[];
  matchesIntegrity(data: Buffer, integrity: string): boolean;
  sha256(data: Buffer): string;
  readTar(buffer: Buffer): FileEntry[];
  writeTarGz(files: FileEntry[]): Buffer;
  writeZip(files: FileEntry[]): Buffer;
  packImage(files: FileEntry[]): Buffer;
  imageId(version: string, image: Buffer): string;
  checksumsText(entries: { name: string; sha256: string }[]): string;
  readChecksums(text: string): Record<string, string>;
  manifestValues(options: {
    version: string;
    repo: string;
    sums: Record<string, string>;
  }): Record<string, string>;
  fillTemplate(
    text: string,
    values: Record<string, string>,
    options?: { partial?: boolean }
  ): { text: string; missing: string[] };
  DEFAULT_TIMESTAMP: string;
  signArgs(env: Record<string, string>, file: string, options?: { url?: string }): string[] | null;
  shownArgs(args: string[]): string[];
};
type Entry = {
  IMAGE_MAGIC: string;
  unpack(image: Buffer): FileEntry[];
  cacheRoot(env: Record<string, string>, platform: string, home: string): string;
  ensureImage(root: string, id: string, readImage: () => Buffer): string;
};

const lib = (await import(
  pathToFileURL(path.join(studioRoot, 'scripts', 'binary', 'lib.mjs')).href
)) as Lib;
const entry = createRequire(import.meta.url)(
  path.join(studioRoot, 'packaging', 'entry.cjs')
) as Entry;
const lock = JSON.parse(fs.readFileSync(path.join(studioRoot, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { dev?: boolean }>;
};

const files = (): FileEntry[] => [
  { path: 'package.json', mode: 0o644, data: Buffer.from('{"type":"module"}') },
  { path: 'dist/cli.js', mode: 0o644, data: Buffer.from('console.log(1)\n') },
  { path: 'node_modules/@esbuild/linux-x64/bin/esbuild', mode: 0o755, data: Buffer.alloc(3000, 7) }
];

describe('the standalone binary', () => {
  it('builds for Windows, macOS and Linux, each from its own Node.js and archive', () => {
    assert.deepEqual(Object.keys(lib.TARGETS), [
      'windows-x64',
      'linux-x64',
      'linux-arm64',
      'darwin-x64',
      'darwin-arm64'
    ]);
    assert.equal(lib.archiveName('windows-x64'), 'roughbook-windows-x64.zip');
    assert.equal(lib.archiveName('darwin-arm64'), 'roughbook-darwin-arm64.tar.gz');
    assert.equal(lib.hostTarget('win32', 'x64'), 'windows-x64');
    assert.equal(lib.hostTarget('linux', 'arm64'), 'linux-arm64');
    assert.equal(lib.hostTarget('freebsd', 'x64'), null);
    assert.equal(lib.TARGETS['windows-x64']!.exe, 'roughbook.exe');
  });

  it("carries the package's production dependencies for its own system only", () => {
    const names = (target: string) =>
      lib.productionPackages(lock, target).map(item => item.path.replace('node_modules/', ''));
    assert.deepEqual(names('linux-x64').sort(), [
      '@esbuild/linux-x64',
      '@lydell/node-pty',
      '@lydell/node-pty-linux-x64',
      'esbuild',
      'ws'
    ]);
    assert.deepEqual(names('windows-x64').sort(), [
      '@esbuild/win32-x64',
      '@lydell/node-pty',
      '@lydell/node-pty-win32-x64',
      'esbuild',
      'ws'
    ]);
    assert.ok(names('darwin-arm64').includes('@esbuild/darwin-arm64'));
    // No development package (the UI's build tools, the ui package itself) goes in.
    for (const target of Object.keys(lib.TARGETS)) {
      for (const item of lib.productionPackages(lock, target)) {
        assert.ok(!lock.packages[item.path]!.dev, item.path);
        assert.match(item.integrity, /^sha512-/);
        assert.match(item.resolved, /^https:\/\/registry\.npmjs\.org\//);
      }
    }
  });

  it('checks a download against its integrity, and refuses one that differs', () => {
    const data = Buffer.from('tarball');
    // The digest npm writes into package-lock.json.
    const integrity = `sha512-${createHash('sha512').update(data).digest('base64')}`;
    assert.ok(lib.matchesIntegrity(data, integrity));
    assert.ok(!lib.matchesIntegrity(Buffer.from('other'), integrity));
    assert.ok(!lib.matchesIntegrity(data, 'md5-nonsense'));
  });

  it('packs an image the entry unpacks file for file, modes kept, into a cache folder per version', async () => {
    const image = lib.packImage(files());
    const unpacked = entry.unpack(image);
    assert.deepEqual(
      unpacked.map(file => [file.path, file.mode, file.data.length]),
      files().map(file => [file.path, file.mode, file.data.length])
    );
    assert.ok(unpacked[2]!.data.equals(files()[2]!.data));
    assert.equal(entry.IMAGE_MAGIC, 'roughbook-image-1\n');

    const root = await tempDir('roughbook-cache-');
    const id = lib.imageId('0.3.15', image);
    assert.match(id, /^0\.3\.15-[0-9a-f]{16}$/);
    let reads = 0;
    const read = () => {
      reads++;
      return image;
    };
    fs.mkdirSync(path.join(root, '0.3.14-0000000000000000'), { recursive: true });
    const dir = entry.ensureImage(root, id, read);
    assert.equal(dir, path.join(root, id));
    assert.equal(fs.readFileSync(path.join(dir, 'dist', 'cli.js'), 'utf8'), 'console.log(1)\n');
    assert.ok(fs.existsSync(path.join(dir, '.complete')));
    // An older version's image is removed when a new one is unpacked (the folder's own .git, not
    // an image, stays), and the image is read once.
    assert.deepEqual(fs.readdirSync(root).sort(), ['.git', id]);
    entry.ensureImage(root, id, read);
    assert.equal(reads, 1);
    if (hostPlatform() !== 'win32') {
      const mode = fs.statSync(path.join(dir, 'node_modules/@esbuild/linux-x64/bin/esbuild')).mode;
      assert.equal(mode & 0o777, 0o755);
    }
  });

  it('removes only its own images that nothing runs from, and replaces one left half done', async () => {
    const image = lib.packImage(files());
    const id = lib.imageId('0.3.16', image);
    const root = await tempDir('roughbook-cache-');
    const make = (relative: string, text = 'x') => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), text);
    };
    // ROUGHBOOK_CACHE_DIR may name a folder that holds other things: they stay.
    make('notes.txt');
    make('pip/wheel.whl');
    make('other.123.tmp/file');
    const ended = spawnSync(process.execPath, ['-e', '']).pid;
    // An older version still running (its process: this test's parent), and one that has ended.
    make(`0.3.15-${'a'.repeat(16)}/.complete`);
    make(`0.3.15-${'a'.repeat(16)}/.running/${process.ppid}`, '');
    make(`0.3.14-${'b'.repeat(16)}/.complete`);
    make(`0.3.14-${'b'.repeat(16)}/.running/${ended}`, '');
    // Half-unpacked folders: one of a process that ended, one of a process still running.
    make(`0.3.15-${'a'.repeat(16)}.${ended}.tmp/dist/cli.js`);
    make(`0.3.15-${'a'.repeat(16)}.${process.ppid}.tmp/dist/cli.js`);
    // This image's folder, left without its mark by a first run stopped half way.
    make(`${id}/dist/half.js`);

    const dir = entry.ensureImage(root, id, () => image);
    assert.equal(fs.readFileSync(path.join(dir, 'dist', 'cli.js'), 'utf8'), 'console.log(1)\n');
    assert.ok(fs.existsSync(path.join(dir, '.complete')));
    assert.equal(fs.existsSync(path.join(dir, 'dist', 'half.js')), false);
    assert.ok(fs.existsSync(path.join(dir, '.running', String(process.pid))));
    assert.deepEqual(fs.readdirSync(root).sort(), [
      '.git',
      `0.3.15-${'a'.repeat(16)}`,
      `0.3.15-${'a'.repeat(16)}.${process.ppid}.tmp`,
      id,
      'notes.txt',
      'other.123.tmp',
      'pip'
    ]);
  });

  it('refuses an image that is not one, or that would write outside its folder', () => {
    assert.throws(() => entry.unpack(zlib.gzipSync(Buffer.from('nope'))), /not a roughbook image/);
    const evil = lib.packImage([{ path: '../outside.txt', mode: 0o644, data: Buffer.from('x') }]);
    assert.throws(() => entry.unpack(evil), /unsafe path/);
  });

  it("unpacks into the system's cache folder, or ROUGHBOOK_CACHE_DIR", () => {
    assert.equal(entry.cacheRoot({ ROUGHBOOK_CACHE_DIR: '/x' }, 'linux', '/home/a'), '/x');
    assert.equal(entry.cacheRoot({}, 'linux', '/home/a'), '/home/a/.cache/roughbook');
    assert.equal(entry.cacheRoot({ XDG_CACHE_HOME: '/c' }, 'linux', '/home/a'), '/c/roughbook');
    assert.equal(entry.cacheRoot({}, 'darwin', '/Users/a'), '/Users/a/Library/Caches/roughbook');
    assert.equal(
      entry.cacheRoot({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a'),
      'C:\\Users\\a\\AppData\\Local\\roughbook\\cache'
    );
  });

  it('runs a script as node would, so the studio can start Node scripts with its own runtime', async () => {
    const dir = await tempDir('roughbook-node-mode-');
    const script = path.join(dir, 'hello.mjs');
    fs.writeFileSync(script, 'console.log("mjs", process.argv.slice(2).join(","));\n');
    // The entry's node mode, outside a binary: run through a stand-in that calls it.
    const runner = path.join(dir, 'run.cjs');
    fs.writeFileSync(
      runner,
      `require(${JSON.stringify(path.join(studioRoot, 'packaging', 'entry.cjs'))}).runAsNode(process.argv.slice(2)) || process.exit(9);\n`
    );
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', cwd: dir });
    assert.equal(run(script, 'a', 'b').stdout.trim(), 'mjs a,b');
    assert.equal(
      run('-e', 'console.log(typeof require("node:path").join, process.argv.length)').stdout.trim(),
      'function 1'
    );
    assert.equal(run('-e', '').status, 0);
    // Anything else is the studio's: a command, an option.
    assert.equal(run('--version').status, 9);
    assert.equal(run('nothing-here.js').status, 9);
  });

  it('writes archives a tar or unzip reads back, with the binary executable', async () => {
    const entries: FileEntry[] = [
      { path: 'roughbook', mode: 0o755, data: Buffer.from('#!/bin/sh\necho hi\n') },
      { path: 'LICENSE', mode: 0o644, data: Buffer.from('Apache-2.0\n') }
    ];
    const tar = lib.readTar(zlib.gunzipSync(lib.writeTarGz(entries)));
    assert.deepEqual(
      tar.map(file => [file.path, file.mode, file.data.toString()]),
      entries.map(file => [file.path, file.mode, file.data.toString()])
    );
    const dir = await tempDir('roughbook-archive-');
    const zip = path.join(dir, 'roughbook.zip');
    fs.writeFileSync(zip, lib.writeZip(entries));
    // The system's own tar reads zips too (bsdtar on Windows and macOS); GNU tar does not.
    const listed = spawnSync('tar', ['-tf', zip], { encoding: 'utf8' });
    if (listed.status === 0)
      assert.deepEqual(listed.stdout.trim().split(/\r?\n/), ['roughbook', 'LICENSE']);
    const bytes = fs.readFileSync(zip);
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  });

  it('fills the manifests from the checksums, and refuses a gap unless asked for a partial set', () => {
    const sums = { 'roughbook-windows-x64.zip': 'a'.repeat(64) };
    const text = lib.checksumsText([{ name: 'roughbook-windows-x64.zip', sha256: 'a'.repeat(64) }]);
    assert.equal(text, `${'a'.repeat(64)}  roughbook-windows-x64.zip\n`);
    assert.deepEqual(lib.readChecksums(text), sums);
    const values = lib.manifestValues({ version: '0.3.16', repo: 'owner/repo', sums });
    assert.equal(
      values.URL_WINDOWS_X64,
      'https://github.com/owner/repo/releases/download/v0.3.16/roughbook-windows-x64.zip'
    );
    const installer = fs.readFileSync(
      path.join(studioRoot, 'packaging', 'winget', 'NuveraSoft.Roughbook.installer.yaml'),
      'utf8'
    );
    const filled = lib.fillTemplate(installer, values);
    assert.match(filled.text, /PackageVersion: 0\.3\.16\n/);
    assert.match(filled.text, new RegExp(`InstallerSha256: ${'a'.repeat(64)}\n`));
    assert.doesNotMatch(filled.text, /__[A-Z0-9_]+__/);

    const formula = fs.readFileSync(
      path.join(studioRoot, 'packaging', 'homebrew', 'roughbook.rb'),
      'utf8'
    );
    assert.throws(() => lib.fillTemplate(formula, values), /No value for SHA256_DARWIN_ARM64/);
    const partial = lib.fillTemplate(formula, values, { partial: true });
    assert.deepEqual(partial.missing.sort(), [
      'SHA256_DARWIN_ARM64',
      'SHA256_DARWIN_X64',
      'SHA256_LINUX_ARM64',
      'SHA256_LINUX_X64'
    ]);
  });

  it("signs the Windows binary with the owner's certificate, however the environment names it", () => {
    const exe = 'C:\\build\\roughbook.exe';
    const url = 'https://github.com/owner/repo';
    // No certificate named: the binary ships unsigned.
    assert.equal(lib.signArgs({}, exe, { url }), null);
    // A .pfx file and its password, timestamped by the default server, SHA-256 throughout.
    const pfx = lib.signArgs(
      { ROUGHBOOK_SIGN_PFX: 'C:\\keys\\sign.pfx', ROUGHBOOK_SIGN_PASSWORD: 'secret' },
      exe,
      { url }
    )!;
    assert.deepEqual(pfx, [
      'sign',
      '/fd',
      'SHA256',
      '/tr',
      lib.DEFAULT_TIMESTAMP,
      '/td',
      'SHA256',
      '/d',
      'Roughbook',
      '/du',
      url,
      '/f',
      'C:\\keys\\sign.pfx',
      '/p',
      'secret',
      exe
    ]);
    // The password is never shown.
    assert.ok(!lib.shownArgs(pfx).includes('secret'));
    assert.equal(lib.shownArgs(pfx)[lib.shownArgs(pfx).indexOf('/p') + 1], '****');
    // A certificate in the store or on a token, by its thumbprint; no timestamp when asked.
    const thumbprint = 'a'.repeat(40);
    const token = lib.signArgs(
      { ROUGHBOOK_SIGN_SHA1: thumbprint, ROUGHBOOK_SIGN_TIMESTAMP: 'none' },
      exe
    )!;
    assert.deepEqual(token.slice(-3), ['/sha1', thumbprint, exe]);
    assert.ok(!token.includes('/tr'));
    assert.throws(() => lib.signArgs({ ROUGHBOOK_SIGN_SHA1: 'abc' }, exe), /40 hexadecimal/);
    // A signing service's plug-in (Azure Trusted Signing) needs its settings file.
    const service = lib.signArgs(
      {
        ROUGHBOOK_SIGN_DLIB: 'C:\\tools\\Azure.CodeSigning.Dlib.dll',
        ROUGHBOOK_SIGN_DLIB_METADATA: 'C:\\tools\\metadata.json'
      },
      exe
    )!;
    assert.deepEqual(service.slice(-5), [
      '/dlib',
      'C:\\tools\\Azure.CodeSigning.Dlib.dll',
      '/dmdf',
      'C:\\tools\\metadata.json',
      exe
    ]);
    assert.throws(
      () => lib.signArgs({ ROUGHBOOK_SIGN_DLIB: 'x.dll' }, exe),
      /ROUGHBOOK_SIGN_DLIB_METADATA/
    );
  });

  it('keeps every template, install script and manifest naming the same release', () => {
    const read = (file: string) =>
      fs.readFileSync(path.join(studioRoot, 'packaging', file), 'utf8');
    const repo = /github\.com\/([^/]+\/[^/.]+)/.exec(
      (
        JSON.parse(fs.readFileSync(path.join(studioRoot, 'package.json'), 'utf8')) as {
          repository: { url: string };
        }
      ).repository.url
    )![1]!;
    assert.match(read('install.sh'), new RegExp(`REPO="${repo}"`));
    assert.match(read('install.ps1'), new RegExp(`\\$Repo = '${repo}'`));
    for (const target of Object.keys(lib.TARGETS)) {
      const archive = lib.archiveName(target);
      if (target.startsWith('windows')) assert.ok(read('install.ps1').includes(archive), archive);
    }
    assert.match(read('install.sh'), /roughbook-\$os-\$arch\.tar\.gz/);
    const scoop = JSON.parse(read('scoop/roughbook.json')) as { bin: string; version: string };
    assert.equal(scoop.bin, 'roughbook.exe');
    assert.equal(scoop.version, '__VERSION__');
    for (const file of [
      'winget/NuveraSoft.Roughbook.yaml',
      'winget/NuveraSoft.Roughbook.installer.yaml',
      'winget/NuveraSoft.Roughbook.locale.en-US.yaml'
    ]) {
      assert.match(read(file), /^PackageIdentifier: NuveraSoft\.Roughbook$/m, file);
      assert.match(read(file), /^PackageVersion: __VERSION__$/m, file);
      assert.match(read(file), /^ManifestVersion: 1\.9\.0$/m, file);
    }
    assert.match(read('homebrew/roughbook.rb'), /class Roughbook < Formula/);
    assert.match(read('homebrew/roughbook.rb'), /bin\.install "roughbook"/);
  });
});

describe('the studio as the binary', () => {
  it('knows it is not the binary under node, and runs scripts with this Node.js', () => {
    assert.equal(standaloneBinary(), false);
    assert.equal(scriptNode(process.env, false), process.execPath);
  });

  it("runs npm, npx and agents' scripts with the PATH's Node.js, or none", async () => {
    const dir = await tempDir('roughbook-path-node-');
    const exe = hostPlatform() === 'win32' ? 'node.exe' : 'node';
    fs.writeFileSync(path.join(dir, exe), '');
    fs.chmodSync(path.join(dir, exe), 0o755);
    const pathKey = hostPlatform() === 'win32' ? 'Path' : 'PATH';
    assert.equal(scriptNode({ [pathKey]: dir, PATHEXT: '.EXE' }, true), path.join(dir, exe));
    const empty = await tempDir('roughbook-no-node-');
    assert.equal(scriptNode({ [pathKey]: empty, PATHEXT: '.EXE' }, true), null);
    // npm's own script is looked for beside the Node.js found, not beside the binary.
    const npm = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    assert.equal(
      npmScript('npm', path.join(dir, 'node.exe'), 'win32', file => file === npm),
      npm
    );
  });

  it('registers the binary itself as the MCP server, since its script moves with each version', () => {
    assert.deepEqual(
      serverCommand({
        platform: 'win32',
        node: 'C:\\Users\\a\\AppData\\Local\\Programs\\roughbook\\roughbook.exe',
        cli: 'C:\\Users\\a\\AppData\\Local\\roughbook\\cache\\0.3.16-abc\\dist\\cli.js',
        tsx: null,
        binary: true,
        devUrl: 'http://localhost:8000'
      }),
      {
        command: 'C:\\Users\\a\\AppData\\Local\\Programs\\roughbook\\roughbook.exe',
        args: ['mcp', '--dev-url', 'http://localhost:8000']
      }
    );
  });

  it('registers the binary by the PATH’s link to it, which outlives an upgrade', async t => {
    // Homebrew's layout: the binary in a folder per version, linked from bin/ on the PATH.
    const root = await tempDir('roughbook-stable-');
    const cellar = path.join(root, 'Cellar', 'roughbook', '0.3.16', 'bin');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(cellar, { recursive: true });
    fs.mkdirSync(bin);
    const real = path.join(cellar, 'roughbook');
    fs.writeFileSync(real, '');
    try {
      fs.symlinkSync(real, path.join(bin, 'roughbook'), 'file');
    } catch {
      t.skip('this machine cannot make a symbolic link');
      return;
    }
    const pathKey = hostPlatform() === 'win32' ? 'Path' : 'PATH';
    const platform = hostPlatform();
    // Node.js names the binary by its real path; the PATH's link is what gets registered.
    assert.equal(
      stableBinaryPath({ [pathKey]: bin }, fs.realpathSync(real), platform),
      path.join(bin, 'roughbook')
    );
    // Another roughbook first on the PATH, or none: the binary's own path.
    const other = path.join(root, 'other');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'roughbook'), '');
    assert.equal(
      stableBinaryPath({ [pathKey]: other }, fs.realpathSync(real), platform),
      fs.realpathSync(real)
    );
    assert.equal(
      stableBinaryPath({ [pathKey]: cellar }, fs.realpathSync(real), platform),
      fs.realpathSync(real)
    );
  });
});
