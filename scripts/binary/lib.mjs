// The standalone binary's build, in parts that need no network (decision 35 of the frameworks
// plan): the targets, the npm package's production dependencies for one of them from the
// lockfile, the image the binary unpacks (packaging/entry.cjs reads it), the archives it ships in,
// the checksums, and the package managers' manifests filled in from the templates in packaging/.
// scripts/binary.mjs does the rest: downloads, Node.js's single-executable build, signing.
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

/** What the binary is built for: Node.js's own download for each, and the npm platform names. */
export const TARGETS = {
  'windows-x64': { node: 'win-x64', os: 'win32', cpu: 'x64', exe: 'roughbook.exe', archive: 'zip' },
  'linux-x64': { node: 'linux-x64', os: 'linux', cpu: 'x64', exe: 'roughbook', archive: 'tar.gz' },
  'linux-arm64': {
    node: 'linux-arm64',
    os: 'linux',
    cpu: 'arm64',
    exe: 'roughbook',
    archive: 'tar.gz'
  },
  'darwin-x64': {
    node: 'darwin-x64',
    os: 'darwin',
    cpu: 'x64',
    exe: 'roughbook',
    archive: 'tar.gz'
  },
  'darwin-arm64': {
    node: 'darwin-arm64',
    os: 'darwin',
    cpu: 'arm64',
    exe: 'roughbook',
    archive: 'tar.gz'
  }
};

/** The target this machine is, or null for one the binary is not built for. */
export function hostTarget(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'windows' : platform;
  const name = `${os}-${arch}`;
  return name in TARGETS ? name : null;
}

/** The archive a target ships in, as the release names it, without a version. */
export function archiveName(target) {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`No target ${target}.`);
  return `roughbook-${target}.${spec.archive}`;
}

/**
 * The npm package's production dependencies for a target, from package-lock.json: every package
 * that is not a development one, leaving out the platform packages (esbuild's binary,
 * node-pty's) built for another system. Each with where npm fetches it and its integrity.
 */
export function productionPackages(lock, target) {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`No target ${target}.`);
  const fits = (list, value) => !list || list.includes(value);
  return Object.entries(lock.packages ?? {})
    .filter(([key, entry]) => key.startsWith('node_modules/') && !entry.dev && !entry.devOptional)
    .filter(([, entry]) => fits(entry.os, spec.os) && fits(entry.cpu, spec.cpu))
    .filter(([, entry]) => !entry.libc || entry.libc.includes('glibc'))
    .map(([key, entry]) => {
      if (!entry.resolved || !entry.integrity) {
        throw new Error(`${key} has no resolved address or integrity in package-lock.json.`);
      }
      return {
        path: key,
        version: entry.version,
        resolved: entry.resolved,
        integrity: entry.integrity
      };
    });
}

/** Whether `data` matches an npm integrity string (`sha512-<base64>`, or several). */
export function matchesIntegrity(data, integrity) {
  return integrity.split(/\s+/).some(item => {
    const match = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(item);
    return Boolean(match) && createHash(match[1]).update(data).digest('base64') === match[2];
  });
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function field(header, start, length) {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
}

function octal(header, start, length) {
  const text = field(header, start, length).trim();
  return text ? parseInt(text, 8) : 0;
}

/**
 * The files in a tar archive (already gunzipped): regular files with their paths and modes, and
 * the long names of pax and GNU headers, as npm's tarballs and Node.js's downloads use them.
 */
export function readTar(buffer) {
  const files = [];
  let offset = 0;
  let longName = null;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const body = buffer.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const record = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (record) longName = record[1];
      continue;
    }
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'g') continue;
    const prefix = field(header, 345, 155);
    const name =
      longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longName = null;
    if (type === '0' || type === '\0' || type === '7') {
      files.push({ path: name, mode: octal(header, 100, 8) & 0o777, data: Buffer.from(body) });
    }
  }
  return files;
}

function tarHeader(name, size, mode) {
  const header = Buffer.alloc(512);
  let path = name;
  let prefix = '';
  if (Buffer.byteLength(path) > 100) {
    const cut = path.lastIndexOf('/', path.length - 1);
    prefix = path.slice(0, cut);
    path = path.slice(cut + 1);
    if (Buffer.byteLength(path) > 100 || Buffer.byteLength(prefix) > 155) {
      throw new Error(`${name} is too long for a tar header.`);
    }
  }
  header.write(path, 0, 100, 'utf8');
  header.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write(`${Math.floor(Date.UTC(2026, 0, 1) / 1000).toString(8)}\0`, 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

/** A gzipped tar of `files` ({ path, mode, data }), with a fixed date so builds repeat. */
export function writeTarGz(files) {
  const parts = [];
  for (const file of files) {
    parts.push(tarHeader(file.path, file.data.length, file.mode));
    parts.push(file.data);
    const pad = (512 - (file.data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

/** A zip of `files` ({ path, mode, data }), deflated, for Windows' archive, WinGet and Scoop. */
export function writeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  // 2026-01-01 00:00 in DOS time, so builds repeat.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8');
    const deflated = zlib.deflateRawSync(file.data, { level: 9 });
    const crc = zlib.crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((0o100000 | file.mode) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + deflated.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** The first line of the image, as packaging/entry.cjs checks it. */
export const IMAGE_MAGIC = 'roughbook-image-1\n';

/**
 * The image the binary unpacks into its cache: the files ({ path, mode, data }) as one gzipped
 * buffer, a line naming the format, the length of a JSON index, the index, then the contents.
 */
export function packImage(files) {
  const index = files.map(file => ({ path: file.path, mode: file.mode, size: file.data.length }));
  const json = Buffer.from(JSON.stringify(index), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length, 0);
  return zlib.gzipSync(
    Buffer.concat([
      Buffer.from(IMAGE_MAGIC, 'utf8'),
      length,
      json,
      ...files.map(file => file.data)
    ]),
    { level: 9 }
  );
}

/** The image's name in the cache: the version and the start of its digest. */
export function imageId(version, image) {
  return `${version}-${sha256(image).slice(0, 16)}`;
}

/** `sha256sum`'s format: one line per file, the digest, two spaces and the name. */
export function checksumsText(entries) {
  return entries.map(entry => `${entry.sha256}  ${entry.name}\n`).join('');
}

/** The digests a checksums file holds, by file name. */
export function readChecksums(text) {
  const sums = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (match) sums[match[2]] = match[1];
  }
  return sums;
}

/** The values a manifest template takes: the version, and each archive's digest and address. */
export function manifestValues({ version, repo, sums }) {
  const values = { VERSION: version, REPO: repo };
  for (const target of Object.keys(TARGETS)) {
    const key = target.toUpperCase().replace(/-/g, '_');
    const name = archiveName(target);
    values[`URL_${key}`] = `https://github.com/${repo}/releases/download/v${version}/${name}`;
    if (sums[name]) values[`SHA256_${key}`] = sums[name];
  }
  return values;
}

/**
 * A template with its `__NAME__` stand-ins filled. A stand-in with no value is refused, unless
 * `partial`, which leaves it for a build that has not every archive (no Mac here, say).
 */
export function fillTemplate(text, values, { partial = false } = {}) {
  const missing = new Set();
  const filled = text.replace(/__([A-Z0-9_]+)__/g, (whole, name) => {
    if (Object.hasOwn(values, name)) return values[name];
    missing.add(name);
    return whole;
  });
  if (missing.size && !partial) {
    throw new Error(`No value for ${[...missing].join(', ')}.`);
  }
  return { text: filled, missing: [...missing] };
}

/** The RFC 3161 timestamp server a signature is countersigned by, unless the owner names another. */
export const DEFAULT_TIMESTAMP = 'http://timestamp.digicert.com';

/**
 * signtool's arguments for signing the Windows binary `file` with the owner's certificate, as the
 * environment names it, or null when it names none (the binary then ships unsigned):
 * ROUGHBOOK_SIGN_PFX, a .pfx file, with ROUGHBOOK_SIGN_PASSWORD; ROUGHBOOK_SIGN_SHA1, the
 * thumbprint of a certificate in the Windows store or on a hardware token; or ROUGHBOOK_SIGN_DLIB
 * and ROUGHBOOK_SIGN_DLIB_METADATA, a signing service's signtool plug-in and its settings (Azure
 * Trusted Signing). ROUGHBOOK_SIGN_TIMESTAMP names the timestamp server, or none for no timestamp.
 */
export function signArgs(env, file, { url } = {}) {
  let certificate;
  if (env.ROUGHBOOK_SIGN_PFX) {
    certificate = [
      '/f',
      env.ROUGHBOOK_SIGN_PFX,
      ...(env.ROUGHBOOK_SIGN_PASSWORD ? ['/p', env.ROUGHBOOK_SIGN_PASSWORD] : [])
    ];
  } else if (env.ROUGHBOOK_SIGN_SHA1) {
    if (!/^[0-9a-fA-F]{40}$/.test(env.ROUGHBOOK_SIGN_SHA1)) {
      throw new Error('ROUGHBOOK_SIGN_SHA1 is a certificate thumbprint: 40 hexadecimal digits.');
    }
    certificate = ['/sha1', env.ROUGHBOOK_SIGN_SHA1];
  } else if (env.ROUGHBOOK_SIGN_DLIB) {
    if (!env.ROUGHBOOK_SIGN_DLIB_METADATA) {
      throw new Error('ROUGHBOOK_SIGN_DLIB needs ROUGHBOOK_SIGN_DLIB_METADATA, its settings file.');
    }
    certificate = ['/dlib', env.ROUGHBOOK_SIGN_DLIB, '/dmdf', env.ROUGHBOOK_SIGN_DLIB_METADATA];
  } else {
    return null;
  }
  const timestamp = env.ROUGHBOOK_SIGN_TIMESTAMP ?? DEFAULT_TIMESTAMP;
  return [
    'sign',
    '/fd',
    'SHA256',
    ...(timestamp === 'none' ? [] : ['/tr', timestamp, '/td', 'SHA256']),
    '/d',
    'Roughbook',
    ...(url ? ['/du', url] : []),
    ...certificate,
    file
  ];
}

/** The arguments as they may be shown: a password never is. */
export function shownArgs(args) {
  return args.map((arg, index) => (args[index - 1] === '/p' ? '****' : arg));
}
