// The standalone binary (decision 35 of the frameworks plan): the studio as one executable per
// system, for teams with no Node.js, built with Node.js's single executable applications. Each
// binary is the official Node.js for its system, the same version as the one running this script,
// with packaging/entry.cjs and the image (the npm package's dist/, package.json and its production
// node_modules for that system) injected. Nothing is published: the archives, SHA256SUMS, the
// install scripts and the package managers' manifests are written to release/ for the owner.
//
//   npm run build                       first: the binary carries dist/
//   npm run binary                      this system's binary
//   npm run binary -- --target all      every target this system can build (macOS ones on a Mac)
//   npm run binary -- --target linux-x64,windows-x64
//   npm run binary -- --manifests [--partial]
//                                       SHA256SUMS over release/ and the manifests from it;
//                                       --partial leaves the digests of archives not built
//
// Node.js's downloads are checked against nodejs.org's SHASUMS256.txt, and npm packages against
// package-lock.json's integrity. A macOS binary has to be signed after the injection, which only
// a Mac can do (codesign), so other systems do not build the macOS targets. The Windows binary is
// built on Windows with signtool (the Windows SDK's) at hand: Node.js's own signature, which the
// injection would break, comes off first, and the owner's certificate signs it after when the
// environment names one (ROUGHBOOK_SIGN_PFX, ROUGHBOOK_SIGN_SHA1 or ROUGHBOOK_SIGN_DLIB; see
// packaging/README.md), and the signature is verified before the archive is made.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  TARGETS,
  archiveName,
  checksumsText,
  fillTemplate,
  hostTarget,
  imageId,
  manifestValues,
  matchesIntegrity,
  packImage,
  productionPackages,
  readChecksums,
  readTar,
  sha256,
  shownArgs,
  signArgs,
  writeTarGz,
  writeZip
} from './binary/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const out = path.resolve(root, option('--out') ?? 'release');
const cache = path.join(root, 'node_modules', '.cache', 'roughbook-binary');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const REPO = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository.url)[1];
// postject, from the Node.js project, puts the blob into the executable; pinned.
const POSTJECT = 'postject@1.0.0-alpha.6';
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    fail(
      `${[command, ...commandArgs].join(' ')} failed (${result.error?.message ?? `exit ${result.status}`}).`
    );
  }
  return result;
}

/** npx through this Node.js and npm's own script, so no shell is needed on any system. */
function npx(npxArgs, options) {
  const dir = path.dirname(process.execPath);
  const script = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')
  ].find(file => fs.existsSync(file));
  if (!script) fail('npx was not found beside this Node.js.');
  return run(process.execPath, [script, ...npxArgs], options);
}

/**
 * signtool: ROUGHBOOK_SIGNTOOL, or the newest Windows SDK's for this machine, or one on the PATH;
 * null off Windows or when the SDK is not installed.
 */
function findSigntool() {
  if (process.platform !== 'win32') return null;
  if (process.env.ROUGHBOOK_SIGNTOOL) return process.env.ROUGHBOOK_SIGNTOOL;
  const kits = path.join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Windows Kits',
    '10',
    'bin'
  );
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const versions = fs.existsSync(kits)
    ? fs
        .readdirSync(kits)
        .filter(name => /^\d+(\.\d+)+$/.test(name))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    : [];
  for (const version of versions) {
    const file = path.join(kits, version, arch, 'signtool.exe');
    if (fs.existsSync(file)) return file;
  }
  const found = spawnSync('where.exe', ['signtool.exe'], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.split(/\r?\n/)[0].trim() || null : null;
}

/**
 * Signs the Windows binary when the environment names a certificate, and checks the signature
 * with Windows' own policy: what the binary's archive says about it. A test certificate
 * (ROUGHBOOK_SIGN_TEST=1) is accepted with a root Windows does not trust, and said to be one.
 */
function signWindows(signtool, exe) {
  const signing = signArgs(process.env, exe, { url: `https://github.com/${REPO}` });
  if (!signing) return 'unsigned: no certificate named (ROUGHBOOK_SIGN_PFX, _SHA1 or _DLIB)';
  if (!signtool)
    fail('Signing the Windows binary needs signtool, from the Windows SDK, on Windows.');
  console.log(`$ signtool ${shownArgs(signing).join(' ')}`);
  const signed = spawnSync(signtool, signing, { encoding: 'utf8' });
  if (signed.status !== 0) fail(`signtool could not sign it:\n${signed.stdout}${signed.stderr}`);
  const verified = spawnSync(signtool, ['verify', '/pa', '/v', exe], { encoding: 'utf8' });
  const said = `${verified.stdout}${verified.stderr}`;
  // The signing chain is listed root first, so the signer is its last "Issued to".
  const chain =
    said
      .split('Signing Certificate Chain:')[1]
      ?.split(/The signature is timestamped|Timestamp/)[0] ?? '';
  const signer =
    [...chain.matchAll(/Issued to: (.+)/g)].map(match => match[1].trim()).at(-1) ??
    'the certificate named';
  if (verified.status === 0) return `signed by ${signer}, and the signature verifies`;
  if (process.env.ROUGHBOOK_SIGN_TEST === '1' && /not trusted|untrusted root/i.test(said)) {
    return `signed by ${signer}, a test certificate Windows does not trust`;
  }
  fail(`The signature does not verify:\n${said}`);
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) fail(`${url} answered ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

/** A file kept in the cache under `name`, fetched once and checked by `check` each time. */
async function cached(name, url, check) {
  const file = path.join(cache, name);
  if (fs.existsSync(file)) {
    const data = fs.readFileSync(file);
    if (check(data)) return data;
  }
  const data = await download(url);
  if (!check(data)) fail(`${url} did not match its checksum.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return data;
}

const nodeVersion = process.version;
let shasums = null;

/** The official Node.js executable for a target, at this Node.js's version. */
async function nodeFor(target) {
  const spec = TARGETS[target];
  if (target === hostTarget()) return fs.readFileSync(process.execPath);
  shasums ??= readChecksums(
    (await download(`https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`)).toString('utf8')
  );
  if (spec.os === 'win32') {
    const name = `${spec.node}/node.exe`;
    const sum = shasums[name];
    if (!sum) fail(`nodejs.org lists no ${name} for ${nodeVersion}.`);
    return cached(
      `node-${nodeVersion}-${spec.node}.exe`,
      `https://nodejs.org/dist/${nodeVersion}/${name}`,
      data => sha256(data) === sum
    );
  }
  const name = `node-${nodeVersion}-${spec.node}.tar.gz`;
  const sum = shasums[name];
  if (!sum) fail(`nodejs.org lists no ${name}.`);
  const archive = await cached(
    name,
    `https://nodejs.org/dist/${nodeVersion}/${name}`,
    data => sha256(data) === sum
  );
  const binary = readTar(zlib.gunzipSync(archive)).find(file => file.path.endsWith('/bin/node'));
  if (!binary) fail(`${name} holds no bin/node.`);
  return binary.data;
}

/** Every file under `dir`, repo-relative with forward slashes, as { path, mode, data }. */
function filesUnder(dir, base = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full, base);
    if (entry.name.endsWith('.map')) return [];
    return [
      {
        path: path.relative(base, full).split(path.sep).join('/'),
        mode: 0o644,
        data: fs.readFileSync(full)
      }
    ];
  });
}

/** The npm package as the binary unpacks it: what `npm install -g roughbook` would put down. */
async function imageFiles(target) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const files = [
    { path: 'package.json', mode: 0o644, data: fs.readFileSync(path.join(root, 'package.json')) },
    { path: 'LICENSE', mode: 0o644, data: fs.readFileSync(path.join(root, 'LICENSE')) },
    ...filesUnder(path.join(root, 'dist'))
  ];
  for (const item of productionPackages(lock, target)) {
    const name = `npm/${item.path.replace(/^node_modules\//, '').replace('/', '+')}-${item.version}.tgz`;
    const tarball = await cached(name, item.resolved, data =>
      matchesIntegrity(data, item.integrity)
    );
    for (const file of readTar(zlib.gunzipSync(tarball))) {
      const inside = file.path.replace(/^[^/]+\//, '');
      files.push({ path: `${item.path}/${inside}`, mode: file.mode || 0o644, data: file.data });
    }
  }
  return files;
}

async function build(target) {
  const spec = TARGETS[target];
  if (spec.os === 'darwin' && process.platform !== 'darwin') {
    return {
      target,
      built: false,
      why: 'a macOS binary is signed after the injection, which needs a Mac'
    };
  }
  const work = path.join(out, '.work', target);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  const image = packImage(await imageFiles(target));
  const id = imageId(pkg.version, image);
  fs.writeFileSync(path.join(work, 'image'), image);
  fs.writeFileSync(path.join(work, 'image.id'), id);
  fs.copyFileSync(path.join(root, 'packaging', 'entry.cjs'), path.join(work, 'entry.cjs'));
  fs.writeFileSync(
    path.join(work, 'sea-config.json'),
    JSON.stringify(
      {
        main: 'entry.cjs',
        output: 'sea.blob',
        disableExperimentalSEAWarning: true,
        // Off, so a blob made on one system works in another system's Node.js.
        useCodeCache: false,
        useSnapshot: false,
        assets: { image: 'image', 'image.id': 'image.id' }
      },
      null,
      2
    )
  );
  run(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { cwd: work });

  const exe = path.join(work, spec.exe);
  fs.writeFileSync(exe, await nodeFor(target));
  if (spec.os !== 'win32') fs.chmodSync(exe, 0o755);
  if (spec.os === 'darwin') run('codesign', ['--remove-signature', exe]);
  // Node.js's signature would not survive the injection: off it comes, where signtool is here.
  const signtool = spec.os === 'win32' ? findSigntool() : null;
  if (signtool) run(signtool, ['remove', '/s', exe], { stdio: 'ignore' });
  npx(
    [
      '--yes',
      POSTJECT,
      exe,
      'NODE_SEA_BLOB',
      path.join(work, 'sea.blob'),
      '--sentinel-fuse',
      FUSE,
      ...(spec.os === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])
    ],
    { cwd: work }
  );
  if (spec.os === 'darwin') run('codesign', ['--sign', '-', exe]);
  const signature = spec.os === 'win32' ? signWindows(signtool, exe) : null;

  const entries = [
    { path: spec.exe, mode: 0o755, data: fs.readFileSync(exe) },
    { path: 'LICENSE', mode: 0o644, data: fs.readFileSync(path.join(root, 'LICENSE')) }
  ];
  const archive = path.join(out, archiveName(target));
  fs.writeFileSync(archive, spec.archive === 'zip' ? writeZip(entries) : writeTarGz(entries));

  // This system's binary is tried at once: it unpacks into a cache of its own and says its version.
  let ran = null;
  if (target === hostTarget()) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'roughbook-binary-'));
    const result = spawnSync(exe, ['--version'], {
      encoding: 'utf8',
      env: { ...process.env, ROUGHBOOK_CACHE_DIR: temp }
    });
    fs.rmSync(temp, { recursive: true, force: true });
    ran = (result.stdout ?? '').trim();
    if (result.status !== 0 || !ran.includes(pkg.version)) {
      fail(`The ${target} binary did not say its version: ${ran || result.stderr || result.error}`);
    }
  }
  return {
    target,
    built: true,
    archive: path.basename(archive),
    size: fs.statSync(archive).size,
    ran,
    signature
  };
}

/** SHA256SUMS over the archives and install scripts in release/, and the manifests from it. */
function manifests(partial) {
  const names = fs
    .readdirSync(out)
    .filter(
      name => /^roughbook-.+\.(?:zip|tar\.gz)$/.test(name) || /^install\.(?:sh|ps1)$/.test(name)
    )
    .sort();
  const entries = names.map(name => ({
    name,
    sha256: sha256(fs.readFileSync(path.join(out, name)))
  }));
  fs.writeFileSync(path.join(out, 'SHA256SUMS'), checksumsText(entries));
  const sums = Object.fromEntries(entries.map(entry => [entry.name, entry.sha256]));
  const values = manifestValues({ version: pkg.version, repo: REPO, sums });
  const templates = [
    ['homebrew/roughbook.rb', 'homebrew/roughbook.rb'],
    ['scoop/roughbook.json', 'scoop/roughbook.json'],
    [
      'winget/NuveraSoft.Roughbook.yaml',
      `winget/NuveraSoft.Roughbook/${pkg.version}/NuveraSoft.Roughbook.yaml`
    ],
    [
      'winget/NuveraSoft.Roughbook.installer.yaml',
      `winget/NuveraSoft.Roughbook/${pkg.version}/NuveraSoft.Roughbook.installer.yaml`
    ],
    [
      'winget/NuveraSoft.Roughbook.locale.en-US.yaml',
      `winget/NuveraSoft.Roughbook/${pkg.version}/NuveraSoft.Roughbook.locale.en-US.yaml`
    ]
  ];
  const missing = new Set();
  for (const [from, to] of templates) {
    const template = fs.readFileSync(path.join(root, 'packaging', from), 'utf8');
    const filled = fillTemplate(template, values, { partial });
    filled.missing.forEach(name => missing.add(name));
    const file = path.join(out, 'manifests', to);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, filled.text);
  }
  console.log(`SHA256SUMS: ${names.join(', ')}.`);
  console.log(
    `Manifests in ${path.relative(root, path.join(out, 'manifests'))}/ for ${pkg.version}.`
  );
  if (missing.size)
    console.log(`Left unfilled (archives not built here): ${[...missing].join(', ')}.`);
}

if (args.includes('--manifests')) {
  if (!fs.existsSync(out)) fail(`Nothing in ${out}: build the binaries first.`);
  manifests(args.includes('--partial'));
  process.exit(0);
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 2))
  fail('Building the binary needs Node.js 22.2 or later.');
if (
  !fs.existsSync(path.join(root, 'dist', 'cli.js')) ||
  !fs.existsSync(path.join(root, 'dist', 'ui', 'index.html'))
) {
  fail('The studio is not built: run npm run build first, so dist/ and its local UI are there.');
}
const asked = option('--target') ?? hostTarget();
if (!asked) fail(`${process.platform}-${process.arch} is not a target; name one with --target.`);
const targets = asked === 'all' ? Object.keys(TARGETS) : asked.split(',');
for (const target of targets)
  if (!TARGETS[target])
    fail(`No target ${target}. The targets are ${Object.keys(TARGETS).join(', ')}.`);

fs.mkdirSync(out, { recursive: true });
for (const script of ['install.sh', 'install.ps1']) {
  fs.copyFileSync(path.join(root, 'packaging', script), path.join(out, script));
}
const results = [];
for (const target of targets) {
  console.log(`Building ${target} with Node.js ${nodeVersion}…`);
  results.push(await build(target));
}
fs.rmSync(path.join(out, '.work'), { recursive: true, force: true });
for (const result of results) {
  console.log(
    result.built
      ? `  ${result.target}: ${result.archive}, ${(result.size / 1048576).toFixed(1)} MB${result.ran ? `; ran here: ${result.ran}` : ''}${result.signature ? `; ${result.signature}` : ''}`
      : `  ${result.target}: not built, since ${result.why}.`
  );
}
manifests(true);
