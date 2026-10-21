// The local server: the built UI, its JSON API, the asset files iterations load through the
// repo's dev server, and the built-in terminal's socket. 127.0.0.1 only; see security.ts for who
// may ask what. In standalone mode the same port under the name localhost is the standalone
// previews' site (standalone/server.ts), an origin apart from the UI's.
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { ApiError, OfflineError, describeError } from '../api/errors.js';
import type { AssetScope } from '../api/types.js';
import {
  bearerToken,
  hostAllowed,
  imageKey,
  localOrigins,
  offeredToken,
  originAllowed,
  sameToken
} from './security.js';
import { BadRequest, assetType, parseDecision, type LocalStudio, type RunBody } from './studio.js';

export type LocalServerOptions = {
  studio: LocalStudio;
  port: number;
  token: string;
  /** The built UI (dist/ui), or null when it has not been built. */
  uiDir: string | null;
  /** The repo's dev server, which the UI frames. */
  devUrl: string;
  /** The linked project's slug, the only one whose files are served. */
  project: string;
};

const BODY_LIMIT = 256 * 1024;

const STATIC_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

type Params = Record<string, string>;
type Handler = (request: IncomingMessage, params: Params) => Promise<unknown>;
type Route = { method: 'GET' | 'POST'; pattern: RegExp; keys: string[]; handler: Handler };

function route(method: Route['method'], template: string, handler: Handler): Route {
  const keys: string[] = [];
  const source = template.replace(/:(\w+)/g, (_match, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${source}$`), keys, handler };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) throw new BadRequest('That request is too large.');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Answered below.
  }
  throw new BadRequest('The request was not a JSON object.');
}

function failure(error: unknown): { status: number; body: { error: string; message: string } } {
  if (error instanceof BadRequest) {
    return { status: 400, body: { error: 'BAD_REQUEST', message: error.message } };
  }
  if (error instanceof OfflineError) {
    return { status: 503, body: { error: 'OFFLINE', message: describeError(error) } };
  }
  if (error instanceof ApiError) {
    return {
      status: error.status >= 400 && error.status < 500 ? error.status : 502,
      body: { error: error.code, message: describeError(error) }
    };
  }
  // The studio's own refusals (an iteration that exists, no agent found) are sentences to show.
  if (error instanceof Error)
    return { status: 400, body: { error: 'REFUSED', message: error.message } };
  return { status: 500, body: { error: 'FAILED', message: String(error) } };
}

function target(params: Params) {
  return { page: params.page!, component: params.component!, iteration: params.iteration! };
}

function contentSecurityPolicy(port: number, devUrl: string): string {
  const sockets = localOrigins(port).map(origin => origin.replace('http:', 'ws:'));
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${sockets.join(' ')}`,
    `frame-src ${new URL(devUrl).origin}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ');
}

export function createLocalServer(options: LocalServerOptions): http.Server {
  const { studio, port, token } = options;
  /** Where iterations render, as it is now: the app's dev server, or this port's site. */
  const devOrigin = () => new URL(studio.devUrl).origin;
  /** The UI's own origins; in standalone mode never the site's, whose pages run iterations. */
  const uiOrigins = () =>
    studio.standaloneMode ? [`http://127.0.0.1:${port}`] : localOrigins(port);
  const shotKey = imageKey(token);

  const routes: Route[] = [
    route('GET', '/api/state', async () => ({ ...(await studio.state()), shotKey })),
    route('POST', '/api/agents/default', async request => {
      await studio.setDefaultAgent((await readBody(request)).agent ?? null);
      return studio.state();
    }),
    route('POST', '/api/agents/refresh', async () => {
      await studio.agents(true);
      return studio.state();
    }),
    // ?fresh when the designer came back to the page, so it shows what changed meanwhile.
    route('GET', '/api/project', request =>
      studio.project(new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.has('fresh'))
    ),
    route('GET', '/api/runs', () => studio.runs()),
    route('POST', '/api/runs', async request =>
      studio.startRuns((await readBody(request)) as unknown as RunBody)
    ),
    route('GET', '/api/runs/:runId/prompt', (_request, params) => studio.prompt(params.runId!)),
    route('POST', '/api/runs/:runId/done', async (request, params) => {
      const body = await readBody(request);
      return studio.done(params.runId!, body.outcome, body.mine);
    }),
    route('GET', '/api/runs/:runId/checks', (_request, params) => studio.checks(params.runId!)),
    route('POST', '/api/runs/:runId/stop', async (_request, params) => ({
      stopped: studio.stopRun(params.runId!)
    })),
    route('POST', '/api/runs/:runId/revert', async (request, params) =>
      studio.revert(params.runId!, (await readBody(request)).file)
    ),
    route('GET', '/api/iterations/:page/:component/:iteration/reviews', (_request, params) =>
      studio.reviews(target(params))
    ),
    route(
      'POST',
      '/api/iterations/:page/:component/:iteration/decisions',
      async (request, params) =>
        studio.decide(target(params), parseDecision(await readBody(request)))
    ),
    route(
      'POST',
      '/api/iterations/:page/:component/:iteration/screenshots',
      async (request, params) =>
        studio.screenshots(target(params), { force: (await readBody(request)).force !== false })
    ),
    // What changed in rough/ since the page last asked; `wait` holds the answer until something does.
    route('GET', '/api/changes', request => {
      const query = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;
      const since = Math.max(0, Number(query.get('since')) || 0);
      const wait = Math.min(25_000, Math.max(0, Number(query.get('wait')) || 0));
      return studio.changes.wait(since, wait);
    }),
    route('GET', '/api/app', () => studio.checkApp()),
    route('POST', '/api/app/start', () => studio.startApp()),
    route('GET', '/api/ratings/:page/:component', (_request, params) =>
      studio.ratings(params.page!, params.component!)
    ),
    route('GET', '/api/sketches/:page/:component', (_request, params) =>
      studio.sketches(params.page!, params.component!)
    ),
    route('POST', '/api/sketches/:page/:component/:iteration/pull', (_request, params) =>
      studio.pull(target(params))
    ),
    route('POST', '/api/promote', async request => {
      const body = await readBody(request);
      return studio.promote({
        page: String(body.page ?? ''),
        component: String(body.component ?? ''),
        iteration: String(body.iteration ?? ''),
        targetFile: typeof body.targetFile === 'string' ? body.targetFile : undefined,
        agent: typeof body.agent === 'string' ? body.agent : undefined,
        terminal: body.terminal === 'external' ? 'external' : 'builtin',
        cols: Number(body.cols) || undefined,
        rows: Number(body.rows) || undefined
      });
    }),
    route('GET', '/api/terminals', async () => studio.terminals?.list() ?? []),
    route('POST', '/api/terminals/:id/stop', async (_request, params) => ({
      stopped: studio.terminals?.stop(params.id!) ?? false
    })),
    route('POST', '/api/terminals/:id/remove', async (_request, params) => ({
      removed: studio.terminals?.remove(params.id!) ?? false
    }))
  ];

  async function api(request: IncomingMessage, response: ServerResponse, pathname: string) {
    if (!sameToken(bearerToken(request), token)) {
      return sendJson(response, 401, {
        error: 'UNAUTHORIZED',
        message: 'Open the link roughbook start printed.'
      });
    }
    if (!originAllowed(request, port, uiOrigins())) {
      return sendJson(response, 403, { error: 'FORBIDDEN', message: 'Not this page.' });
    }
    for (const item of routes) {
      const match = item.pattern.exec(pathname);
      if (!match || item.method !== request.method) continue;
      const params: Params = {};
      item.keys.forEach((key, index) => (params[key] = decodeURIComponent(match[index + 1]!)));
      try {
        return sendJson(response, 200, { ok: true, data: await item.handler(request, params) });
      } catch (error) {
        const { status, body } = failure(error);
        // A request the page made wrong is not a failure worth counting.
        if (!(error instanceof BadRequest)) await studio.reportError(error);
        return sendJson(response, status, { ok: false, ...body });
      } finally {
        // Whatever the page did may have changed the project, so the next read reaches the backend.
        if (request.method !== 'GET') studio.projectChanged();
      }
    }
    return sendJson(response, 404, { ok: false, error: 'NOT_FOUND', message: 'No such route.' });
  }

  /** The project's and library's files, for <img> and CSS in iterations served by the dev server. */
  async function assetFile(request: IncomingMessage, response: ServerResponse, pathname: string) {
    const match =
      /^\/api\/files\/(project)\/([^/]+)\/([^/]+)$/.exec(pathname) ??
      /^\/api\/files\/(library)\/([^/]+)$/.exec(pathname);
    const scope = match?.[1] as AssetScope | undefined;
    const slug = scope === 'project' ? decodeURIComponent(match![2]!) : options.project;
    const file = decodeURIComponent((scope === 'project' ? match?.[3] : match?.[2]) ?? '');
    if (!scope || slug !== options.project) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await studio.asset(scope, file);
      const type = assetType(file);
      const headers: Record<string, string> = {
        'content-type': type,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
        'cross-origin-resource-policy': 'cross-origin'
      };
      // An SVG opened on its own runs no script.
      if (type === 'image/svg+xml') {
        headers['content-security-policy'] =
          "default-src 'none'; style-src 'unsafe-inline'; sandbox";
      }
      // 3D models are fetched by script, which needs the dev server named.
      if (request.headers.origin === devOrigin()) {
        headers['access-control-allow-origin'] = devOrigin();
      }
      response.writeHead(200, headers).end(bytes);
    } catch (error) {
      const { status } = failure(error);
      response.writeHead(status === 400 ? 404 : status).end();
    }
  }

  /**
   * A screenshot, for the page's own fetch with the token or for a card's <img> with the image
   * key. A card asks again each time it is drawn, and is answered 304 while the file is the same.
   */
  function screenshot(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
    const match =
      /^\/api\/iterations\/([^/]+)\/([^/]+)\/([^/]+)\/screenshots\/([a-z][a-z0-9-]*)$/.exec(
        url.pathname
      );
    if (!match || request.method !== 'GET') return false;
    const key = url.searchParams.get('key') ?? undefined;
    if (!sameToken(bearerToken(request), token) && !sameToken(key, shotKey)) {
      sendJson(response, 401, { error: 'UNAUTHORIZED' });
      return true;
    }
    let file: string | null = null;
    try {
      file = studio.screenshotFile(
        { page: match[1]!, component: match[2]!, iteration: match[3]! },
        match[4]!
      );
    } catch {
      file = null;
    }
    if (!file) {
      response.writeHead(404).end();
      return true;
    }
    const stat = fs.statSync(file);
    const etag = `"${Math.round(stat.mtimeMs).toString(36)}-${stat.size.toString(36)}"`;
    const headers = { 'cache-control': 'private, no-cache', etag };
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, headers).end();
      return true;
    }
    response.writeHead(200, { 'content-type': 'image/png', ...headers });
    fs.createReadStream(file).pipe(response);
    return true;
  }

  function page(request: IncomingMessage, response: ServerResponse, pathname: string) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    const security = {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY'
    };
    if (!options.uiDir) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', ...security });
      response.end('The local UI is not built. Run npm run build in roughbook-studio.');
      return;
    }
    const root = path.resolve(options.uiDir);
    const wanted = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    const inside = wanted.startsWith(root + path.sep);
    const isFile = inside && fs.existsSync(wanted) && fs.statSync(wanted).isFile();
    const file = isFile ? wanted : path.join(root, 'index.html');
    const extension = path.extname(file);
    const headers: Record<string, string> = {
      'content-type': STATIC_TYPES[extension] ?? 'application/octet-stream',
      ...security
    };
    if (extension === '.html') {
      headers['cache-control'] = 'no-store';
      headers['content-security-policy'] = contentSecurityPolicy(port, studio.devUrl);
    } else if (pathname.startsWith('/assets/')) {
      // The UI's bundler names these by their content.
      headers['cache-control'] = 'public, max-age=31536000, immutable';
    }
    response.writeHead(200, headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(file).pipe(response);
  }

  const server = http.createServer((request, response) => {
    // The standalone previews, when the environment's mode says so: this port under localhost.
    if (studio.standaloneMode && request.headers.host === studio.siteHost) {
      studio.standalone(request, response);
      return;
    }
    // A page whose own domain resolves to 127.0.0.1 still names that domain as the Host.
    if (!hostAllowed(request, port)) {
      response.writeHead(403, { 'content-type': 'text/plain' }).end('Not this host.');
      return;
    }
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const pathname = url.pathname;
    if (pathname.startsWith('/api/files/') && request.method === 'GET') {
      void assetFile(request, response, pathname);
      return;
    }
    if (screenshot(request, response, url)) return;
    if (pathname.startsWith('/api/')) {
      void api(request, response, pathname);
      return;
    }
    page(request, response, pathname);
  });

  // The built-in terminal: only this page, only with the token, offered as the subprotocol.
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    handleProtocols: protocols => [...protocols][0] ?? false
  });
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname;
    const id = /^\/api\/terminals\/([0-9a-f-]{36})$/.exec(pathname)?.[1];
    const allowed =
      hostAllowed(request, port) &&
      !(studio.standaloneMode && request.headers.host === studio.siteHost) &&
      request.headers.origin !== undefined &&
      originAllowed(request, port, uiOrigins()) &&
      sameToken(offeredToken(request), token) &&
      id !== undefined &&
      studio.terminals?.get(id) !== null &&
      studio.terminals !== null;
    if (!allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, ws => {
      const detach = studio.terminals!.attach(id!, {
        send: text => {
          if (ws.readyState === ws.OPEN) ws.send(text);
        }
      });
      ws.on('message', raw => studio.terminals!.receive(id!, String(raw)));
      ws.on('close', () => detach?.());
    });
  });

  return server;
}
