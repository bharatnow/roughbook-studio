// The local server answers only this machine, and only the page it opened. It listens on
// 127.0.0.1; a request must name this server as its Host (a web page that points its own domain
// at 127.0.0.1 cannot reach it), and every API call carries the token made at each start, which
// reaches the page in the URL's fragment and never leaves the machine.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** The WebSocket subprotocol that carries the token, since a socket cannot send a header. */
export const SUBPROTOCOL_PREFIX = 'roughbook.';

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The origins this server is reached at. */
export function localOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

export function hostAllowed(request: IncomingMessage, port: number): boolean {
  const host = request.headers.host;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** An Origin header, when sent, must be this server's own page. */
export function originAllowed(request: IncomingMessage, port: number): boolean {
  const origin = request.headers.origin;
  return origin === undefined || localOrigins(port).includes(origin);
}

export function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

/** The token a WebSocket offered as its first subprotocol. */
export function offeredToken(request: IncomingMessage): string | undefined {
  const offered = String(request.headers['sec-websocket-protocol'] ?? '')
    .split(',')[0]
    ?.trim();
  return offered?.startsWith(SUBPROTOCOL_PREFIX)
    ? offered.slice(SUBPROTOCOL_PREFIX.length)
    : undefined;
}
