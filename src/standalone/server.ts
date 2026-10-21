// The standalone server (ROUGHBOOK-FRAMEWORKS-PLAN.md, F5): the studio shows an iteration itself,
// for a repo no live dev server or snapshot command suits. An iteration is at
// /rough-preview/<page>/<component>/<iteration>/, inside a page with the site's stylesheets, and
// the site's public folder is at the root, so its links resolve as on the site. It answers 200,
// 404 and 500 and posts the contract's messages, and is rendered again on every request, so a
// change shows when the frame reloads.
//
// Who may ask: it listens on 127.0.0.1 alone and answers only its own names for it, and every
// request carries its token (in the address, or as a bearer token) unless the browser marks it as
// the preview page's own (Sec-Fetch-Site: same-origin), which no other site can do. In the local
// UI it is the studio's own port under the name localhost, an origin of its own, so an iteration's
// code never reaches the UI's page or its token.
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { STANDALONE_PREVIEW } from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { STANDALONE_ENTRIES, standaloneRenderer } from '../recipes/standalone/index.js';
import { ITERATION, SLUG, iterationDir } from '../repo/iterations.js';
import { ROUGH_DIR } from '../repo/root.js';
import { bearerToken, newToken, sameToken } from '../server/security.js';
import { contentType, siteFile } from './files.js';
import { FILES_DIR, errorPage, fixtureScript, standalonePage, variantOf } from './page.js';
import type { PageFile } from './types.js';

/** The query parameter that carries the token in a preview's address. */
export const TOKEN_PARAM = 'roughbook-token';

const PREFIX = STANDALONE_PREVIEW.slice(0, STANDALONE_PREVIEW.indexOf('{key}'));

/** The preview path, with the token, that the frame, the screenshots and doctor ask. */
export function standaloneTemplate(token: string): string {
  return `${STANDALONE_PREVIEW}?${TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

/** The environment as a caller of this server needs it: its preview path carries the token. */
export function withToken(environment: RepoEnvironment, token: string): RepoEnvironment {
  return environment.mode === 'standalone'
    ? { ...environment, preview: standaloneTemplate(token) }
    : environment;
}

export type StandaloneOptions = {
  repoRoot: string;
  /** The environment as it is now: read on every request, so an edit to it shows too. */
  environment: () => RepoEnvironment;
  token: string;
  /** The Host values this server is reached at. */
  hosts: string[];
  /** The pages that may frame a preview; none but the preview itself when empty. */
  frameAncestors: string[];
};

export type StandaloneHandler = (request: IncomingMessage, response: ServerResponse) => void;

function text(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

/** The iteration's fixture: its parsed contents, none, or why it cannot be read. */
function readFixture(
  dir: string,
  environment: RepoEnvironment
): { ok: true; value: unknown } | { ok: false; message: string } {
  const name = environment.fixture;
  if (!name) return { ok: true, value: null };
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return { ok: true, value: null };
  if (path.extname(name).toLowerCase() !== '.json') {
    return {
      ok: false,
      message: `Standalone previews pass a JSON fixture, and ${name} is not one; name a .json file as the environment's fixture.`
    };
  }
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) as unknown };
  } catch (error) {
    return {
      ok: false,
      message: `${name} does not read as JSON: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function createStandaloneHandler(options: StandaloneOptions): StandaloneHandler {
  /** Each iteration's files from its last render, for the page's own requests that follow it. */
  const built = new Map<string, Record<string, PageFile>>();
  const frameAncestors = options.frameAncestors.length
    ? options.frameAncestors.join(' ')
    : "'self'";

  function allowed(request: IncomingMessage, url: URL): boolean {
    return (
      sameToken(url.searchParams.get(TOKEN_PARAM) ?? undefined, options.token) ||
      sameToken(bearerToken(request), options.token) ||
      request.headers['sec-fetch-site'] === 'same-origin'
    );
  }

  function sendPage(response: ServerResponse, status: number, html: string, head: boolean): void {
    response.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // The address holds the token: it is never sent on to another site.
      'referrer-policy': 'no-referrer',
      'content-security-policy': `frame-ancestors ${frameAncestors}`
    });
    response.end(head ? undefined : html);
  }

  function sendFile(
    response: ServerResponse,
    type: string,
    bytes: Buffer | string,
    head: boolean
  ): void {
    response.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    });
    response.end(head ? undefined : bytes);
  }

  async function render(
    environment: RepoEnvironment,
    key: string,
    dir: string
  ): Promise<
    | { status: 200; markup: string; head: string[]; readyOn: 'load' | 'script'; fixture: boolean }
    | { status: 404 | 500; message: string }
  > {
    if (!fs.existsSync(path.join(dir, environment.entry))) {
      return { status: 404, message: `There is no iteration ${key} in this repo.` };
    }
    const renderer = standaloneRenderer(environment.entry);
    if (!renderer) {
      return {
        status: 500,
        message: `Standalone previews show ${STANDALONE_ENTRIES}; ${environment.entry} is neither.`
      };
    }
    const fixture = readFixture(dir, environment);
    if (!fixture.ok) return { status: 500, message: fixture.message };
    const rendered = await renderer.render({
      repoRoot: options.repoRoot,
      environment,
      key,
      dir,
      filesPath: `${PREFIX}${key}/${FILES_DIR}/`
    });
    if (!rendered.ok) return { status: 500, message: rendered.message };
    built.set(key, rendered.files);
    return {
      status: 200,
      markup: rendered.markup,
      head: rendered.head,
      readyOn: rendered.readyOn,
      fixture: fixture.value !== null
    };
  }

  async function preview(response: ServerResponse, url: URL, head: boolean): Promise<void> {
    const parts = url.pathname.slice(PREFIX.length).split('/');
    let decoded: string[];
    try {
      decoded = parts.map(decodeURIComponent);
    } catch {
      decoded = [];
    }
    const [page = '', component = '', iteration = '', ...rest] = decoded;
    const key = `${page}/${component}/${iteration}`;
    if (!SLUG.test(page) || !SLUG.test(component) || !ITERATION.test(iteration)) {
      sendPage(
        response,
        404,
        errorPage(
          key,
          404,
          `There is no iteration ${key} in this repo: an iteration's address is /rough-preview/<page>/<component>/iteration-NN/.`
        ),
        head
      );
      return;
    }
    // The iteration's own files are linked relative to its folder, so its address ends with one.
    if (!rest.length) {
      response.writeHead(308, {
        location: `${PREFIX}${key}/${url.search}`,
        'cache-control': 'no-store'
      });
      response.end();
      return;
    }
    const environment = options.environment();
    const dir = path.join(options.repoRoot, ...iterationDir(page, component, iteration).split('/'));
    const file = rest.join('/');

    if (file === '' || file === environment.entry) {
      const shown = await render(environment, key, dir);
      if (shown.status !== 200) {
        sendPage(response, shown.status, errorPage(key, shown.status, shown.message), head);
        return;
      }
      sendPage(
        response,
        200,
        standalonePage({
          key,
          markup: shown.markup,
          head: shown.head,
          stylesheets: environment.stylesheets,
          variant: variantOf(url.searchParams),
          readyOn: shown.readyOn,
          fixture: shown.fixture
        }),
        head
      );
      return;
    }

    if (rest[0] === FILES_DIR) {
      const name = rest.slice(1).join('/');
      if (name === 'fixture.js') {
        const fixture = readFixture(dir, environment);
        if (!fixture.ok || fixture.value === null) return text(response, 404, 'No fixture.');
        return sendFile(response, contentType(name)!, fixtureScript(fixture.value), head);
      }
      // A file of the last render; rendered again when the page was not asked first.
      let files = built.get(key);
      if (!files?.[name]) {
        await render(environment, key, dir);
        files = built.get(key);
      }
      const found = files?.[name];
      if (!found) return text(response, 404, 'Not found.');
      return sendFile(response, found.type, found.bytes, head);
    }

    const own = siteFile(dir, file);
    if (!own) return text(response, 404, 'Not found.');
    sendFile(response, own.type, fs.readFileSync(own.file), head);
  }

  function publicFile(response: ServerResponse, url: URL, head: boolean): void {
    const environment = options.environment();
    if (!environment.public) return text(response, 404, 'Not found.');
    const root = path.join(
      options.repoRoot,
      ...(environment.public === '.' ? [] : environment.public.split('/'))
    );
    const prefix = environment.public === '.' ? '' : `${environment.public}/`;
    // rough/ is reached only at a preview's address, even when the site's folder holds it.
    const found = siteFile(root, url.pathname, relative => {
      const inRepo = `${prefix}${relative}`;
      return inRepo === ROUGH_DIR || inRepo.startsWith(`${ROUGH_DIR}/`);
    });
    if (!found) return text(response, 404, 'Not found.');
    sendFile(response, found.type, fs.readFileSync(found.file), head);
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!options.hosts.includes(request.headers.host ?? '')) {
      return text(response, 403, 'Not this host.');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return text(response, 405, 'Previews are read, never written.');
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!allowed(request, url)) {
      return text(
        response,
        401,
        'Open previews from the studio: this address needs the token roughbook start gave it.'
      );
    }
    const head = request.method === 'HEAD';
    if (url.pathname.startsWith(PREFIX)) return preview(response, url, head);
    publicFile(response, url, head);
  }

  return (request, response) => {
    handle(request, response).catch(error => {
      if (!response.headersSent) {
        text(response, 500, error instanceof Error ? error.message : String(error));
      } else response.end();
    });
  };
}

export type StandaloneServer = {
  /** Where it answers: 127.0.0.1 and a port of its own. */
  url: string;
  token: string;
  /** The environment as callers need it, the token in its preview path. */
  environment: RepoEnvironment;
  close(): Promise<void>;
};

/**
 * A standalone server of its own, on 127.0.0.1 and a free port (or the one given), for a command
 * that needs previews while nothing else serves them: doctor, screenshots after a run.
 */
export async function startStandaloneServer(
  repoRoot: string,
  environment: () => RepoEnvironment,
  options: { port?: number; token?: string } = {}
): Promise<StandaloneServer> {
  const token = options.token ?? newToken();
  let handler: StandaloneHandler | null = null;
  const server = http.createServer((request, response) => {
    if (handler) handler(request, response);
    else text(response, 503, 'Starting.');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  handler = createStandaloneHandler({
    repoRoot,
    environment,
    token,
    hosts: [`127.0.0.1:${port}`, `localhost:${port}`],
    frameAncestors: []
  });
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    environment: withToken(environment(), token),
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

/**
 * Runs `run` against wherever this repo's previews are: the live dev server as given, or, in
 * standalone mode, a standalone server started for the time it takes, with the token in the
 * environment's preview path.
 */
export async function withPreviews<T>(
  repoRoot: string,
  environment: RepoEnvironment,
  devUrl: string,
  run: (devUrl: string, environment: RepoEnvironment) => Promise<T>
): Promise<T> {
  if (environment.mode !== 'standalone') return run(devUrl, environment);
  const server = await startStandaloneServer(repoRoot, () => environment);
  try {
    return await run(server.url, server.environment);
  } finally {
    await server.close();
  }
}
