// Calls to the local server. The token arrives once in the link's fragment (never sent to any
// server by the browser), is kept for this tab, and goes out as a bearer header.
const KEY = 'roughbook.token';

let token: string | null = null;

function remember(value: string): void {
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    // Private windows may refuse; the token still lives for this page.
  }
}

function recall(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Takes the token from `#token=…`, then puts the address back to the overview. */
export function readToken(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const given = params.get('token');
  if (given) {
    remember(given);
    window.history.replaceState(null, '', `${window.location.pathname}#/`);
    token = given;
  }
  token ??= recall();
  return token;
}

export function currentToken(): string | null {
  return token;
}

export class Failure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${token ?? ''}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const envelope = (await response.json().catch(() => null)) as {
    ok?: boolean;
    data?: T;
    error?: string;
    message?: string;
  } | null;
  if (response.ok && envelope?.ok) return envelope.data as T;
  throw new Failure(
    envelope?.error ?? `HTTP_${response.status}`,
    envelope?.message ?? `The studio answered ${response.status}.`,
    response.status
  );
}

export const get = <T>(path: string) => call<T>('GET', path);
export const post = <T>(path: string, body: unknown = {}) => call<T>('POST', path, body);

export function iterationPath(page: string, component: string, iteration: string): string {
  return `/api/iterations/${encodeURIComponent(page)}/${encodeURIComponent(component)}/${encodeURIComponent(iteration)}`;
}

/** An iteration's promote on this machine (B4): its plan, Finish, Revert and commit. */
export function promotePath(page: string, component: string, iteration: string): string {
  return `/api/promote/${encodeURIComponent(page)}/${encodeURIComponent(component)}/${encodeURIComponent(iteration)}`;
}

/** A screenshot as an object URL, since an image cannot send the token itself. */
export async function screenshotUrl(
  page: string,
  component: string,
  iteration: string,
  size: string
): Promise<string | null> {
  const response = await fetch(`${iterationPath(page, component, iteration)}/screenshots/${size}`, {
    headers: { authorization: `Bearer ${token ?? ''}` }
  });
  if (!response.ok) return null;
  return URL.createObjectURL(await response.blob());
}

/** The terminal's socket, with the token offered as its subprotocol. */
export function terminalSocket(id: string): WebSocket {
  const url = new URL(`/api/terminals/${id}`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(url, [`roughbook.${token ?? ''}`]);
}
