import { DEFAULT_SERVER } from '../config/server.js';

/** The backend answered and refused: a code such as `RUN_NOT_FOUND`, and a message when it has one. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** Field errors from the backend's validation, when the request was malformed. */
  readonly issues: unknown[] | null;

  constructor(code: string, status: number, message?: string, issues: unknown[] | null = null) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.issues = issues;
  }

  /** Worth sending again later: the server failed or asked us to slow down. */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429 || this.status === 408;
  }
}

/** The backend could not be reached at all: no network, a timeout, or nothing listening. */
export class OfflineError extends Error {
  readonly server: string;

  constructor(server: string, cause?: unknown) {
    super(`Could not reach ${server}.`, { cause });
    this.name = 'OfflineError';
    this.server = server;
  }
}

/** One line for the terminal or the local UI, never a stack. */
export function describeError(error: unknown): string {
  if (error instanceof OfflineError) {
    const advice = `${error.message} Check your connection, or set ROUGHBOOK_SERVER.`;
    // The default is a backend on this machine; a designer signing in to a hosted site needs
    // its address, which its Install page gives in the command.
    return error.server === DEFAULT_SERVER
      ? `${advice} To use a Roughbook site, sign in with the command on its Install page: roughbook login --server <url>.`
      : advice;
  }
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_REQUEST') return 'The server did not accept that request.';
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
