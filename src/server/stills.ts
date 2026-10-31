// The canvas's full-height stills (P3 of the composite plan). A web sketch's picture is on the
// backend's storage, behind a signed link the page's CSP will not load, so this server carries the
// bytes: the page asks by iteration and kind, and the links stay here. They come only from the
// backend's answer, never from a request, so this is a proxy for those pictures and nothing else.
// A local iteration's stills are its own files, measured here from their headers.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { Transform } from 'node:stream';
import { ApiError, OfflineError } from '../api/errors.js';
import type { StillEntry, StillsRead } from '../api/types.js';
import { ITERATION, SLUG } from '../repo/iterations.js';

export type StillsView = Pick<StillsRead, 'pending' | 'items'>;

/** One of a web sketch's pictures: the half-width one is what a small canvas loads first. */
export type StillKind = 'desktop' | 'desktop-half' | 'phone';

/** A picture larger than this is not a still. */
export const MAX_STILL_BYTES = 16 * 1024 * 1024;

/** What a still may be served as. No SVG: it can carry script. */
const STILL_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/avif']);

/** A link this close to its end is read again rather than used. */
const LINK_MARGIN_MS = 30_000;
/** How long a read stands while pictures are still being made, and once none are. */
const PENDING_READ_MS = 10_000;
const SETTLED_READ_MS = 60_000;
/** However short the backend's links, a page's polling does not reach it more often than this. */
const SHORTEST_READ_MS = 5000;

/** The signed link when it is an absolute web address; anything else is dropped. */
function usable(link: unknown): string | null {
  if (typeof link !== 'string') return null;
  try {
    const { protocol } = new URL(link);
    return protocol === 'https:' || protocol === 'http:' ? link : null;
  } catch {
    return null;
  }
}

function measured(width: unknown, height: unknown): { width: number; height: number } | null {
  return typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0
    ? { width, height }
    : null;
}

/** A short mark of what the link points at, so the page asks again when the picture is rebuilt. */
function version(link: string): string {
  return createHash('sha256').update(new URL(link).pathname).digest('hex').slice(0, 12);
}

function isIterationKey(key: string): boolean {
  const [page, component, iteration, ...rest] = key.split('/');
  return (
    !rest.length &&
    SLUG.test(page ?? '') &&
    SLUG.test(component ?? '') &&
    ITERATION.test(iteration ?? '')
  );
}

/** When the links end, in ms; a date that cannot be read is taken as a short one. */
function endOf(expiresAt: unknown, now: number): number {
  const at = typeof expiresAt === 'number' ? expiresAt : Date.parse(String(expiresAt));
  return Number.isFinite(at) ? at : now + SETTLED_READ_MS;
}

/** The web sketches' stills: the backend's read, with its links held here and local paths shown. */
export class RemoteStills {
  private links = new Map<string, string>();
  private view: StillsView = { pending: 0, items: {} };
  /** When the links end, and when the read is next asked for again. */
  private expires = 0;
  private nextRead = 0;
  private reading: Promise<void> | null = null;

  constructor(
    private readonly read: () => Promise<StillsRead>,
    private readonly openLink: (url: string) => Promise<Response>,
    private readonly now: () => number = Date.now
  ) {}

  /** The read as the page gets it: paths on this server, never a link. */
  async current(fresh = false): Promise<StillsView> {
    if (fresh || this.now() >= this.nextRead) await this.refresh();
    return this.view;
  }

  /**
   * A picture's type and bytes, or null when it is not one this server was given a link for, or
   * storage did not answer with an image of a fitting size. A link storage refuses has run out
   * early, so it is read again once.
   */
  async open(
    key: string,
    kind: StillKind
  ): Promise<{ type: string; body: ReadableStream<Uint8Array> } | null> {
    if (this.now() >= this.expires - LINK_MARGIN_MS) await this.refresh();
    let answer = await this.fetchLink(`${key}/${kind}`);
    if (answer?.status === 401 || answer?.status === 403) {
      await answer.body?.cancel();
      await this.refresh();
      answer = await this.fetchLink(`${key}/${kind}`);
    }
    if (!answer) return null;
    const type = answer.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    const size = Number(answer.headers.get('content-length') ?? 0);
    if (!answer.ok || !answer.body || !STILL_TYPES.has(type) || size > MAX_STILL_BYTES) {
      await answer.body?.cancel();
      return null;
    }
    return { type, body: answer.body };
  }

  private fetchLink(name: string): Promise<Response> | null {
    const link = this.links.get(name);
    return link ? this.openLink(link) : null;
  }

  private refresh(): Promise<void> {
    this.reading ??= this.load().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private async load(): Promise<void> {
    const now = this.now();
    let answer: StillsRead;
    try {
      answer = await this.read();
    } catch (error) {
      // An older backend has no such read (a 404), and an unreachable one is asked again later:
      // the canvas draws without these, with what is still good.
      if (!(error instanceof ApiError) && !(error instanceof OfflineError)) throw error;
      if (now >= this.expires) {
        this.links = new Map();
        this.view = { pending: 0, items: {} };
      }
      this.nextRead = now + SETTLED_READ_MS;
      return;
    }
    const links = new Map<string, string>();
    const items: StillsView['items'] = {};
    const hold = (key: string, kind: StillKind, link: string) => {
      links.set(`${key}/${kind}`, link);
      return `/api/stills/remote/${key}/${kind}?v=${version(link)}`;
    };
    for (const [key, entry] of Object.entries(answer.items ?? {})) {
      if (!isIterationKey(key)) continue;
      const item: StillEntry = { desktop: null, phone: null };
      const desktop = entry?.desktop;
      const desktopLink = usable(desktop?.url);
      const desktopSize = measured(desktop?.width, desktop?.height);
      if (desktopLink && desktopSize) {
        const half = usable(desktop?.half);
        item.desktop = {
          url: hold(key, 'desktop', desktopLink),
          half: half ? hold(key, 'desktop-half', half) : null,
          ...desktopSize
        };
      }
      const phoneLink = usable(entry?.phone?.url);
      const phoneSize = measured(entry?.phone?.width, entry?.phone?.height);
      if (phoneLink && phoneSize) {
        item.phone = { url: hold(key, 'phone', phoneLink), ...phoneSize };
      }
      if (item.desktop || item.phone) items[key] = item;
    }
    const pending = Number(answer.pending) || 0;
    this.links = links;
    this.view = { pending, items };
    this.expires = endOf(answer.expiresAt, now);
    const stands = pending ? PENDING_READ_MS : SETTLED_READ_MS;
    this.nextRead =
      now + Math.max(SHORTEST_READ_MS, Math.min(stands, this.expires - LINK_MARGIN_MS - now));
  }
}

/** Passes bytes through and fails once more than `limit` have gone, whatever the headers said. */
export function capped(limit: number): Transform {
  let sent = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      sent += chunk.length;
      if (sent > limit) done(new Error('The picture is too large.'));
      else done(null, chunk);
    }
  });
}

/** A PNG's or WebP's width and height from the start of the file, or null for anything else. */
export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.toString('latin1', 1, 4) === 'PNG') {
    if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
    return measured(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (
    bytes.length < 30 ||
    bytes.toString('latin1', 0, 4) !== 'RIFF' ||
    bytes.toString('latin1', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8X') {
    return measured(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1);
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return measured((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return measured(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  }
  return null;
}

/** A file's image size, reading only its start. */
export function imageFileSize(file: string): { width: number; height: number } | null {
  let handle: number | null = null;
  try {
    handle = fs.openSync(file, 'r');
    const start = Buffer.alloc(32);
    const read = fs.readSync(handle, start, 0, start.length, 0);
    return imageSize(start.subarray(0, read));
  } catch {
    return null;
  } finally {
    if (handle !== null) fs.closeSync(handle);
  }
}
