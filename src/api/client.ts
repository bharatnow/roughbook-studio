import { ApiError, OfflineError } from './errors.js';
import type { StartRunRequest, StartedRun } from '../runs/types.js';
import type { DeviceLogin, IssuedInstall, LinkResult, Me, OrgProjects } from './types.js';

/** Where the backend serves the studio's routes. */
export const STUDIO_BASE = '/v1/api/studio';

/**
 * What a request may carry: ids, enums, numbers and short text. Ground rule 2 of the split plan:
 * no studio request carries code or file paths, and the outbound-request test checks it.
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined };
export type RequestBody = { [key: string]: JsonValue | undefined };

export type ApiConfig = {
  /** The backend's origin, already checked by normalizeServer. */
  server: string;
  /** The install token; null before sign-in. */
  token: string | null;
  userAgent: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type RequestOptions = {
  /** Lets the backend recognize a request sent again from the outbox. */
  idempotencyKey?: string;
};

type Envelope = { success: boolean; data?: unknown; error?: unknown; message?: unknown };

/** The typed client for `/studio`. Every route the studio calls goes through `request`. */
export class StudioApi {
  constructor(private readonly config: ApiConfig) {}

  get server(): string {
    return this.config.server;
  }

  get signedIn(): boolean {
    return this.config.token !== null;
  }

  /** The same server, without the token: for signing in. */
  signedOut(): StudioApi {
    return new StudioApi({ ...this.config, token: null });
  }

  /** The same server with a newly issued token. */
  withToken(token: string): StudioApi {
    return new StudioApi({ ...this.config, token });
  }

  startDeviceLogin(body: { studioVersion: string; os: string }): Promise<DeviceLogin> {
    return this.request('POST', '/auth/device', body);
  }

  pollDeviceLogin(deviceCode: string): Promise<IssuedInstall> {
    return this.request('POST', '/auth/token', { deviceCode });
  }

  me(): Promise<Me> {
    return this.request('GET', '/me');
  }

  logout(): Promise<unknown> {
    return this.request('POST', '/auth/logout', {});
  }

  projects(): Promise<OrgProjects[]> {
    return this.request('GET', '/projects');
  }

  createProject(orgId: string, name: string): Promise<{ slug: string }> {
    return this.request('POST', `/orgs/${encodeURIComponent(orgId)}/projects`, { name });
  }

  /** Allocates the iterations and compiles their prompts for this repo. */
  startRuns(orgId: string, project: string, request: StartRunRequest): Promise<StartedRun[]> {
    return this.request(
      'POST',
      `/orgs/${encodeURIComponent(orgId)}/projects/${encodeURIComponent(project)}/runs`,
      request
    );
  }

  link(
    orgId: string,
    body: { project: string; framework: string | null; roughCommitted: boolean }
  ): Promise<LinkResult> {
    return this.request('POST', `/orgs/${encodeURIComponent(orgId)}/links`, body);
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: RequestBody,
    options: RequestOptions = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': this.config.userAgent
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(`${this.config.server}${STUDIO_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000)
      });
    } catch (error) {
      throw new OfflineError(this.config.server, error);
    }

    const envelope = (await response.json().catch(() => null)) as Envelope | null;
    if (!envelope || typeof envelope !== 'object' || typeof envelope.success !== 'boolean') {
      throw new ApiError(
        response.ok ? 'BAD_RESPONSE' : `HTTP_${response.status}`,
        response.status,
        `The server answered ${response.status} with something the studio cannot read.`
      );
    }
    if (envelope.success && response.ok) return envelope.data as T;
    throw toApiError(response.status, envelope);
  }
}

function toApiError(status: number, envelope: Envelope): ApiError {
  const message = typeof envelope.message === 'string' ? envelope.message : undefined;
  if (Array.isArray(envelope.error)) {
    return new ApiError('INVALID_REQUEST', status, message, envelope.error);
  }
  const code = typeof envelope.error === 'string' ? envelope.error : `HTTP_${status}`;
  return new ApiError(code, status, message);
}
