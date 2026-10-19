/**
 * The hosted backend, where the studio signs in when told nothing. `ROUGHBOOK_SERVER` or
 * `roughbook login --server` chooses another, such as `http://localhost:4000` for one on this
 * machine.
 */
export const DEFAULT_SERVER = 'https://rough-api.nuverasoft.com';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocal(url: URL): boolean {
  return LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost');
}

/**
 * A server's origin, checked: https, or plain http only to this machine, since every request
 * carries the install token.
 */
export function normalizeServer(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Not a server address: ${input}`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url))) {
    throw new Error(`Use https for ${url.host}; plain http is only for this machine.`);
  }
  return url.origin;
}

/**
 * The address the backend gives as its own (its `API_URL`, in `/me`) when it is another server
 * than the one reached, and a checked one. Never this machine unless the server reached was too,
 * so a production `API_URL` left at `http://localhost:4000` cannot strand every studio.
 */
export function announcedServer(reached: string, announced: string | undefined): string | null {
  if (!announced) return null;
  let server: string;
  try {
    server = normalizeServer(announced);
  } catch {
    return null;
  }
  if (server === reached) return null;
  if (isLocal(new URL(server)) && !isLocal(new URL(reached))) return null;
  return server;
}

/** The first of the flag, the environment and the saved sign-in, else the default. */
export function resolveServer(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  saved: string | undefined
): string {
  return normalizeServer(flag || env.ROUGHBOOK_SERVER || saved || DEFAULT_SERVER);
}
