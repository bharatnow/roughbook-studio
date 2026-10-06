import { ApiError, OfflineError } from './errors.js';
import type { StartRunRequest, StartedRun } from '../runs/types.js';
import type {
  AssetScope,
  DeviceLogin,
  Heartbeat,
  IssuedInstall,
  LinkResult,
  Me,
  OrgProjects,
  ProjectTree,
  Promotion,
  PullableSketch,
  PulledSketch
} from './types.js';

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
    return this.request('POST', `${projectPath(orgId, project)}/runs`, request);
  }

  /** The project with its brief and the server's records of its iterations. */
  project(orgId: string, project: string): Promise<ProjectTree> {
    return this.request('GET', projectPath(orgId, project));
  }

  /** Renders the promote prompt; the assets are the server file names the iteration uses. */
  promote(
    orgId: string,
    project: string,
    body: {
      page: string;
      component: string;
      iteration: string;
      assets: { scope: AssetScope; file: string }[];
    }
  ): Promise<Promotion> {
    return this.request('POST', `${projectPath(orgId, project)}/promotions`, body);
  }

  /** A local iteration's reviews, oldest first. */
  reviews(
    orgId: string,
    project: string,
    page: string,
    component: string,
    iteration: string
  ): Promise<unknown[]> {
    return this.request(
      'GET',
      `${iterationPath(orgId, project, page, component, iteration)}/reviews`
    );
  }

  /** The component's web sketches that can be pulled, newest first. */
  sketches(
    orgId: string,
    project: string,
    page: string,
    component: string
  ): Promise<PullableSketch[]> {
    return this.request('GET', `${componentPath(orgId, project, page, component)}/sketches`);
  }

  /** Allocates the next local iteration as a fork of the sketch, with the sketch's files. */
  pullSketch(
    orgId: string,
    project: string,
    page: string,
    component: string,
    sketch: string
  ): Promise<PulledSketch> {
    return this.request(
      'POST',
      `${componentPath(orgId, project, page, component)}/sketches/${encodeURIComponent(sketch)}/pull`,
      {}
    );
  }

  heartbeat(body: Heartbeat): Promise<{ seenAt: string }> {
    return this.request('POST', '/heartbeat', body);
  }

  /** An asset file's bytes, to copy into the repo when promoting. */
  async file(orgId: string, project: string, scope: AssetScope, file: string): Promise<Buffer> {
    const response = await this.send(
      'GET',
      `${projectPath(orgId, project)}/files/${scope}/${encodeURIComponent(file)}`,
      undefined,
      {},
      '*/*'
    );
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    throw await readError(response);
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
    const response = await this.send(method, path, body, options);
    const envelope = await readEnvelope(response);
    if (envelope.success && response.ok) return envelope.data as T;
    throw toApiError(response.status, envelope);
  }

  private async send(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: RequestBody | undefined,
    options: RequestOptions,
    accept = 'application/json'
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept,
      'user-agent': this.config.userAgent
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    try {
      return await (this.config.fetch ?? fetch)(`${this.config.server}${STUDIO_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000)
      });
    } catch (error) {
      throw new OfflineError(this.config.server, error);
    }
  }
}

function projectPath(orgId: string, project: string): string {
  return `/orgs/${encodeURIComponent(orgId)}/projects/${encodeURIComponent(project)}`;
}

function componentPath(orgId: string, project: string, page: string, component: string): string {
  return `${projectPath(orgId, project)}/pages/${encodeURIComponent(page)}/components/${encodeURIComponent(component)}`;
}

/** The path of one iteration's review routes. */
export function iterationPath(
  orgId: string,
  project: string,
  page: string,
  component: string,
  iteration: string
): string {
  return `${componentPath(orgId, project, page, component)}/iterations/${encodeURIComponent(iteration)}`;
}

async function readEnvelope(response: Response): Promise<Envelope> {
  const envelope = (await response.json().catch(() => null)) as Envelope | null;
  if (!envelope || typeof envelope !== 'object' || typeof envelope.success !== 'boolean') {
    throw new ApiError(
      response.ok ? 'BAD_RESPONSE' : `HTTP_${response.status}`,
      response.status,
      `The server answered ${response.status} with something the studio cannot read.`
    );
  }
  return envelope;
}

async function readError(response: Response): Promise<ApiError> {
  return toApiError(response.status, await readEnvelope(response));
}

function toApiError(status: number, envelope: Envelope): ApiError {
  const message = typeof envelope.message === 'string' ? envelope.message : undefined;
  if (Array.isArray(envelope.error)) {
    return new ApiError('INVALID_REQUEST', status, message, envelope.error);
  }
  const code = typeof envelope.error === 'string' ? envelope.error : `HTTP_${status}`;
  return new ApiError(code, status, message);
}
