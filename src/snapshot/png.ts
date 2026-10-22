// The little the studio reads of a PNG a snapshot command wrote: that it is one, and its size, so
// doctor can tell an image at the viewport's proportions from a blank or a wrong one.

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
