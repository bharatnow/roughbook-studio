// The little the studio reads of a PNG a snapshot command wrote: that it is one, and its size, so
// doctor can tell an image at the viewport's proportions from a blank or a wrong one; and its
// pixels, so doctor can tell two pictures of a page apart (B5's markers).
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The width and height in a PNG's header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(SIGNATURE)) return null;
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Whether an image has a viewport's proportions, within `tolerance` (a share of the ratio): a
 * renderer draws at its own density, so the pixels are a multiple of the viewport's points, not
 * equal to them.
 */
export function sameProportions(
  image: { width: number; height: number },
  viewport: { width: number; height: number },
  tolerance = 0.03
): boolean {
  const want = viewport.width / viewport.height;
  const got = image.width / image.height;
  return Math.abs(got - want) <= want * tolerance;
}

/** A PNG's pixels as RGBA, 8 bits a channel; null for one this cannot read (16-bit, palette, interlaced). */
export function pngPixels(bytes: Buffer): { width: number; height: number; data: Buffer } | null {
  const size = pngSize(bytes);
  if (!size) return null;
  const depth = bytes[24];
  const colour = bytes[25];
  const interlaced = bytes[28];
  const channels = colour === 6 ? 4 : colour === 2 ? 3 : colour === 0 ? 1 : colour === 4 ? 2 : 0;
  if (depth !== 8 || !channels || interlaced !== 0) return null;
  const parts: Buffer[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    if (type === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + length));
    if (type === 'IEND') break;
    at += 12 + length;
  }
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(parts));
  } catch {
    return null;
  }
  const { width, height } = size;
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rows[y * stride + x - channels]! : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x]! : 0;
      const corner = y > 0 && x >= channels ? rows[(y - 1) * stride + x - channels]! : 0;
      let value = line[x]!;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      rows[y * stride + x] = value & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: rows };
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const at = i * channels;
    const grey = channels <= 2;
    data[i * 4] = rows[at]!;
    data[i * 4 + 1] = grey ? rows[at]! : rows[at + 1]!;
    data[i * 4 + 2] = grey ? rows[at]! : rows[at + 2]!;
    data[i * 4 + 3] = channels === 2 ? rows[at + 1]! : 255;
  }
  return { width, height, data };
}

/**
 * The share of pixels two PNGs differ in, 0 for the same picture; 1 when their sizes differ or
 * either cannot be read. Identical bytes are the same picture without decoding.
 */
export function pictureDifference(a: Buffer, b: Buffer): number {
  if (a.equals(b)) return 0;
  const one = pngPixels(a);
  const two = pngPixels(b);
  if (!one || !two || one.width !== two.width || one.height !== two.height) return 1;
  let differ = 0;
  for (let i = 0; i < one.data.length; i += 4) {
    if (
      one.data[i] !== two.data[i] ||
      one.data[i + 1] !== two.data[i + 1] ||
      one.data[i + 2] !== two.data[i + 2] ||
      one.data[i + 3] !== two.data[i + 3]
    ) {
      differ += 1;
    }
  }
  return differ / (one.width * one.height);
}
