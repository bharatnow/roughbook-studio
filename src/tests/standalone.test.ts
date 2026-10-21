// The standalone mode (ROUGHBOOK-FRAMEWORKS-PLAN.md, F5): the environment's stylesheet and
// public-folder fields, the studio's own server and its answers (200, 404, 500 and the contract's
// messages), the token on every request that is not the preview page's own, and the parts that
// reach it as they reach a live dev server: screenshots and doctor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http, { type IncomingHttpHeaders } from 'node:http';
import path from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { runDoctor } from '../doctor/run.js';
import type { DoctorTools, Probe } from '../doctor/types.js';
import {
  STANDALONE_PREVIEW,
  environmentFromHeader,
  parseEnvironmentHeader,
  readEnvironmentSync
} from '../environment/read.js';
import type { RepoEnvironment } from '../environment/types.js';
import { bareEnvironment } from '../environment/bare.js';
import { next } from '../recipes/next/index.js';
import { approveCommands, environmentCommands } from '../repo/approvals.js';
import { messagesScript } from '../standalone/page.js';
import {
  TOKEN_PARAM,
  startStandaloneServer,
  withPreviews,
  type StandaloneServer
} from '../standalone/server.js';
import { tempDir } from './helpers.js';

const LINK = {
  version: 1 as const,
  orgId: 'org-1',
  project: 'site',
  roughCommitted: true,
  appDir: null
};

/** A static site's environment: no recipe, previews by the studio's own server. */
const STATIC_SITE = `---
contract: 1
recipe: none
stack:
  - static
family: markup-css
mode: standalone
entry: index.html
sources:
  - .html
  - .css
public: public
stylesheets:
  - /css/site.css
  - https://fonts.example.test/inter.css
gate: build
build: none
buildOutput:
  - public
---

A plain site: pages in public/, its stylesheet in public/css/site.css.
`;

function header(text: string): RepoEnvironment {
  return environmentFromHeader(parseEnvironmentHeader(text)!, LINK, 'linux');
}

/** The static site's header with lines changed: `key: value` replaced, or added before the end. */
function siteWith(changes: Record<string, string | null>): string {
  let text = STATIC_SITE;
  for (const [key, value] of Object.entries(changes)) {
    const line = new RegExp(`^${key}:.*(?:\\n  - .*)*$`, 'm');
    if (line.test(text)) text = text.replace(line, value === null ? '' : `${key}: ${value}`);
    else if (value !== null)
      text = text.replace(/\n---\n\nA plain/, `\n${key}: ${value}\n---\n\nA plain`);
  }
  return text.replace(/\n\n+---/, '\n---');
}

describe("the environment's standalone fields", () => {
  it('reads the stylesheets and the public folder, with the studio as the preview', () => {
    const environment = header(STATIC_SITE);
    assert.equal(environment.mode, 'standalone');
    assert.deepEqual(environment.stylesheets, [
      '/css/site.css',
      'https://fonts.example.test/inter.css'
    ]);
    assert.equal(environment.public, 'public');
    // The studio's server shows every iteration, and reloads the frame when its files change.
    assert.equal(environment.preview, STANDALONE_PREVIEW);
    assert.equal(environment.reload, 'studio');
    // No start command is needed: nothing of the app runs for a preview.
    assert.equal(environment.start.command, null);
  });

  it('defaults to no stylesheets and no public folder', () => {
    for (const environment of [next.environment(LINK), bareEnvironment(LINK)]) {
      assert.deepEqual(environment.stylesheets, []);
      assert.equal(environment.public, null);
    }
    const live = header(
      siteWith({ mode: 'live', preview: '/rough-preview/{key}', start: 'http://127.0.0.1:8000' })
        .replace(/^public:.*\n/m, '')
        .replace(/^stylesheets:\n(?: {2}- .*\n)+/m, '')
    );
    assert.deepEqual(live.stylesheets, []);
    assert.equal(live.public, null);
    assert.equal(live.preview, '/rough-preview/{key}');
  });

  it('takes the repo root, a folder written with ./ or a trailing slash, and none', () => {
    assert.equal(header(siteWith({ public: '.' })).public, '.');
    assert.equal(header(siteWith({ public: './site/' })).public, 'site');
    assert.equal(
      header(siteWith({ public: 'none' }).replace(/^ {2}- \/css\/site\.css\n/m, '')).public,
      null
    );
  });

  it('refuses a public folder outside the repo or inside rough/, naming the field', () => {
    for (const bad of ['../site', 'C:/site', '/var/www', 'rough', 'rough/site']) {
      assert.throws(() => header(siteWith({ public: bad })), /public/, bad);
    }
  });

  it('refuses a stylesheet that is neither a path on the site nor an address', () => {
    for (const bad of [
      'css/site.css',
      '/css/../secret.css',
      'ftp://example.test/a.css',
      '/a b.css'
    ]) {
      const text = STATIC_SITE.replace('/css/site.css', bad);
      assert.throws(() => header(text), /stylesheets/, bad);
    }
    // A path on the site needs a folder to serve it from.
    assert.throws(() => header(siteWith({ public: 'none' })), /stylesheets[\s\S]*public/);
  });

  it('keeps the preview and the reload the studio’s own in standalone mode', () => {
    assert.throws(() => header(siteWith({ preview: '/previews/{key}' })), /preview/);
    assert.throws(() => header(siteWith({ reload: 'app' })), /reload/);
    assert.equal(header(siteWith({ reload: 'studio' })).reload, 'studio');
  });

  it('refuses an entry the standalone server cannot show', () => {
    assert.throws(() => header(siteWith({ entry: 'index.blade.php' })), /entry[\s\S]*standalone/);
    assert.equal(header(siteWith({ entry: 'index.tsx', family: 'react-like' })).entry, 'index.tsx');
  });
});

type Answer = { status: number; headers: IncomingHttpHeaders; body: string };

/** A GET with the headers a test chooses (fetch would not let it choose Host or Sec-Fetch-Site). */
function get(url: string, headers: Record<string, string> = {}): Promise<Answer> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: { host: target.host, ...headers }
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk as Buffer));
        response.on('end', () =>
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8')
          })
        );
      }
    );
    request.on('error', reject);
  });
}

/** Just enough of React for esbuild to bundle against: the studio never runs it here. */
const REACT_STUB: Record<string, string> = {
  'node_modules/react/package.json': JSON.stringify({
    name: 'react',
    version: '19.0.0',
    exports: { '.': './index.js', './jsx-runtime': './jsx-runtime.js' }
  }),
  'node_modules/react/index.js':
    'export function createElement(type, props) { return { type, props }; }\nexport class Component {}\nexport function useEffect() {}\n',
  'node_modules/react/jsx-runtime.js':
    'export function jsx(type, props) { return { type, props }; }\nexport const jsxs = jsx;\nexport const Fragment = "fragment";\n',
  'node_modules/react-dom/package.json': JSON.stringify({
    name: 'react-dom',
    version: '19.0.0',
    exports: { './client': './client.js' }
  }),
  'node_modules/react-dom/client.js': 'export function createRoot() { return { render() {} }; }\n'
};

async function siteRepo(environment = STATIC_SITE, extra: Record<string, string> = {}) {
  const repo = await tempDir('roughbook-standalone-');
  const files: Record<string, string> = {
    'rough/environment.md': environment,
    'public/index.html': '<!doctype html><title>Home</title><h1>The site</h1>\n',
    'public/css/site.css': ':root { --ink: #102030; }\nbody { color: var(--ink); }\n',
    'public/images/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'public/.env': 'SECRET=kept-out-of-previews',
    'public/admin.php': '<?php echo "server code";',
    'rough/home/hero/iteration-01/index.html':
      '<section class="hero">\n  <h1>Quiet hero 7c2</h1>\n  <img src="./photo.svg" alt="A photo">\n  <p data-note></p>\n  <script>document.querySelector("[data-note]").textContent = window.roughbookFixture.note;</script>\n</section>\n',
    'rough/home/hero/iteration-01/preview.json': '{ "note": "fixture-note-3d1" }\n',
    'rough/home/hero/iteration-01/photo.svg':
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    'rough/home/hero/iteration-02/index.html': '<section>Fine markup</section>\n',
    'rough/home/hero/iteration-02/preview.json': '{ "note": \n',
    ...extra
  };
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  return repo;
}

async function serving(repo: string): Promise<StandaloneServer> {
  return startStandaloneServer(repo, () => readEnvironmentSync(repo, LINK));
}

/** An iteration's preview address on the server, with its token unless told otherwise. */
function page(server: StandaloneServer, key: string, query = '', token = true): string {
  const params = new URLSearchParams(query);
  if (token) params.set(TOKEN_PARAM, server.token);
  const search = params.toString();
  return `${server.url}${STANDALONE_PREVIEW.replace('{key}', key)}${search ? `?${search}` : ''}`;
}

describe('the standalone server', () => {
  it('answers 200 for a rendered HTML iteration, inside a page with the site’s stylesheets', async () => {
    const repo = await siteRepo();
    const server = await serving(repo);
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      const answer = await get(page(server, 'home/hero/iteration-01'));
      assert.equal(answer.status, 200);
      assert.match(String(answer.headers['content-type']), /^text\/html/);
      assert.equal(answer.headers['cache-control'], 'no-store');
      assert.equal(answer.headers['referrer-policy'], 'no-referrer');
      assert.match(answer.body, /<link rel="stylesheet" href="\/css\/site\.css">/);
      assert.match(
        answer.body,
        /<link rel="stylesheet" href="https:\/\/fonts\.example\.test\/inter\.css">/
      );
      // Served as it is, inside the page.
      assert.ok(answer.body.includes('<h1>Quiet hero 7c2</h1>'));
      assert.ok(answer.body.includes('src="./photo.svg"'));
      // The page posts the contract's messages for this key.
      assert.ok(answer.body.includes('"home/hero/iteration-01"'));
      // The fixture reaches the iteration from a script of its own, not in the page's text.
      assert.ok(!answer.body.includes('fixture-note-3d1'));
      assert.match(answer.body, /<script src="\.\/__roughbook\/fixture\.js"><\/script>/);
      const fixture = await get(
        `${server.url}/rough-preview/home/hero/iteration-01/__roughbook/fixture.js`,
        { 'sec-fetch-site': 'same-origin' }
      );
      assert.equal(fixture.status, 200);
      assert.match(String(fixture.headers['content-type']), /javascript/);
      assert.match(fixture.body, /window\.roughbookFixture = \{"note":"fixture-note-3d1"\};/);
      // The iteration's own files, beside its entry.
      const photo = await get(`${server.url}/rough-preview/home/hero/iteration-01/photo.svg`, {
        'sec-fetch-site': 'same-origin'
      });
      assert.equal(photo.status, 200);
      assert.equal(photo.headers['content-type'], 'image/svg+xml');
    } finally {
      await server.close();
    }
  });

  it("puts the variant on the page's root, as the contract's query parameters ask", async () => {
    const repo = await siteRepo();
    const server = await serving(repo);
    try {
      const dark = await get(
        page(
          server,
          'home/hero/iteration-01',
          'roughbook-scheme=dark&roughbook-dir=rtl&roughbook-lang=ar'
        )
      );
      assert.equal(dark.status, 200);
      const root = /<html[^>]*>/.exec(dark.body)?.[0] ?? '';
      assert.match(root, /lang="ar"/);
      assert.match(root, /dir="rtl"/);
      assert.match(root, /class="dark"/);
      assert.match(root, /color-scheme: dark/);
      const plain = /<html[^>]*>/.exec(
        (await get(page(server, 'home/hero/iteration-01'))).body
      )?.[0];
      assert.doesNotMatch(plain ?? '', /dark|rtl/);
    } finally {
      await server.close();
    }
  });

  it('answers 404 for a key with no iteration, and posts the error message', async () => {
    const repo = await siteRepo();
    const server = await serving(repo);
    try {
      const missing = await get(page(server, 'home/hero/iteration-99'));
      assert.equal(missing.status, 404);
      assert.match(missing.body, /no iteration home\/hero\/iteration-99/i);
      assert.ok(missing.body.includes('"home/hero/iteration-99"'));
      assert.match(missing.body, /"error"/);
      // Not a key at all.
      for (const bad of ['Home/hero/iteration-01', 'home/hero/draft', 'home/hero']) {
        assert.equal((await get(page(server, bad))).status, 404, bad);
      }
    } finally {
      await server.close();
    }
  });

  it('answers 500 for an iteration it cannot render, with the reason in the error message', async () => {
    const repo = await siteRepo();
    const server = await serving(repo);
    try {
      const failed = await get(page(server, 'home/hero/iteration-02'));
      assert.equal(failed.status, 500);
      assert.match(failed.body, /preview\.json/);
      assert.ok(failed.body.includes('"home/hero/iteration-02"'));
      assert.match(failed.body, /"error"/);
    } finally {
      await server.close();
    }
  });

  it('bundles a React iteration with esbuild, from the repo’s own packages, and 500s on a broken one', async () => {
    const repo = await siteRepo(siteWith({ entry: 'index.tsx', family: 'react-like' }), {
      ...REACT_STUB,
      'rough/home/hero/iteration-03/index.tsx':
        'import "./hero.css";\n\nexport default function Hero({ note }: { note?: string }) {\n  return (\n    <section className="hero">\n      <h1>React hero 5e9</h1>\n      <p>{note}</p>\n    </section>\n  );\n}\n',
      'rough/home/hero/iteration-03/hero.css': '.hero { padding: 4rem; }\n',
      'rough/home/hero/iteration-03/preview.json': '{ "note": "react-note-8a2" }\n',
      'rough/home/hero/iteration-04/index.tsx':
        'export default function Broken() {\n  return <section>{ </section>;\n}\n'
    });
    const server = await serving(repo);
    try {
      const shell = await get(page(server, 'home/hero/iteration-03'));
      assert.equal(shell.status, 200);
      // The page is a shell: the iteration renders in the browser, from the bundle.
      assert.ok(!shell.body.includes('React hero 5e9'));
      const script = /<script type="module" src="(\.\/__roughbook\/[^"]+\.js)"><\/script>/.exec(
        shell.body
      )?.[1];
      const style = /<link rel="stylesheet" href="(\.\/__roughbook\/[^"]+\.css)">/.exec(
        shell.body
      )?.[1];
      assert.ok(script, 'the bundle is linked');
      assert.ok(style, "the iteration's own CSS is linked");
      const base = `${server.url}/rough-preview/home/hero/iteration-03/`;
      const bundle = await get(new URL(script!, base).toString(), {
        'sec-fetch-site': 'same-origin'
      });
      assert.equal(bundle.status, 200);
      assert.match(String(bundle.headers['content-type']), /javascript/);
      assert.ok(bundle.body.includes('React hero 5e9'));
      // The repo's own react-dom mounts it; the page says ready once it rendered, or the error.
      assert.ok(bundle.body.includes('createRoot'));
      assert.ok(bundle.body.includes('roughbookReady'));
      assert.ok(bundle.body.includes('roughbookFail'));
      // The fixture reaches it as its props.
      assert.ok(bundle.body.includes('roughbookFixture'));
      const css = await get(new URL(style!, base).toString(), { 'sec-fetch-site': 'same-origin' });
      assert.ok(css.body.includes('padding: 4rem'));

      const broken = await get(page(server, 'home/hero/iteration-04'));
      assert.equal(broken.status, 500);
      assert.match(broken.body, /rough\/home\/hero\/iteration-04\/index\.tsx:2:/);
      assert.ok(broken.body.includes('"home/hero/iteration-04"'));
    } finally {
      await server.close();
    }
  });

  it("serves the site's public folder at its root, never its dotfiles, server code or rough/", async () => {
    const repo = await siteRepo();
    const server = await serving(repo);
    const own = { 'sec-fetch-site': 'same-origin' };
    try {
      const css = await get(`${server.url}/css/site.css`, own);
      assert.equal(css.status, 200);
      assert.match(String(css.headers['content-type']), /^text\/css/);
      assert.ok(css.body.includes('--ink'));
      assert.equal((await get(`${server.url}/images/logo.svg`, own)).status, 200);
      assert.equal((await get(`${server.url}/`, own)).status, 200);
      for (const hidden of [
        '/.env',
        '/admin.php',
        '/css/missing.css',
        '/../rough/environment.md'
      ]) {
        assert.equal((await get(`${server.url}${hidden}`, own)).status, 404, hidden);
      }
    } finally {
      await server.close();
    }
    // With the repo root as the public folder, rough/ is still reached only at a preview address.
    const rooted = await siteRepo(siteWith({ public: '.' }), {
      'css/site.css': 'body { margin: 0; }\n'
    });
    const root = await serving(rooted);
    try {
      assert.equal((await get(`${root.url}/css/site.css`, own)).status, 200);
      assert.equal((await get(`${root.url}/public/index.html`, own)).status, 200);
      for (const hidden of [
        '/rough/home/hero/iteration-01/index.html',
        '/rough/environment.md',
        '/.git/config'
      ]) {
        assert.equal((await get(`${root.url}${hidden}`, own)).status, 404, hidden);
      }
    } finally {
      await root.close();
    }
  });

  it("asks for the token on every request that is not the preview page's own", async () => {
    const repo = await siteRepo();
    const server = await serving(repo);
    const key = 'home/hero/iteration-01';
    try {
      // Doctor, the screenshots, a browser tab, another site: none is the page's own.
      assert.equal((await get(page(server, key, '', false))).status, 401);
      assert.equal(
        (await get(page(server, key, '', false), { 'sec-fetch-site': 'cross-site' })).status,
        401
      );
      assert.equal(
        (await get(page(server, key, `${TOKEN_PARAM}=not-the-token`, false))).status,
        401
      );
      assert.equal(
        (await get(`${server.url}/css/site.css`, { 'sec-fetch-site': 'same-site' })).status,
        401
      );
      assert.equal((await get(`${server.url}/css/site.css`)).status, 401);
      // With the token in the address, or as a bearer token.
      assert.equal((await get(page(server, key))).status, 200);
      assert.equal(
        (await get(page(server, key, '', false), { authorization: `Bearer ${server.token}` }))
          .status,
        200
      );
      // The page's own requests, which the browser marks same-origin, need none.
      assert.equal(
        (await get(page(server, key, '', false), { 'sec-fetch-site': 'same-origin' })).status,
        200
      );
      // Only this machine's names for it.
      assert.equal(
        (await get(page(server, key), { host: `evil.example:${new URL(server.url).port}` })).status,
        403
      );
    } finally {
      await server.close();
    }
  });

  it('shows a change to an iteration on the next request, and sends a folder to its slash', async () => {
    const repo = await siteRepo();
    const server = await serving(repo);
    try {
      const file = path.join(repo, 'rough', 'home', 'hero', 'iteration-01', 'index.html');
      fs.writeFileSync(
        file,
        fs.readFileSync(file, 'utf8').replace('Quiet hero 7c2', 'Bold hero 9f4')
      );
      const answer = await get(page(server, 'home/hero/iteration-01'));
      assert.ok(answer.body.includes('Bold hero 9f4'));
      const bare = await get(
        `${server.url}/rough-preview/home/hero/iteration-01?${TOKEN_PARAM}=${server.token}`
      );
      assert.equal(bare.status, 308);
      assert.equal(
        bare.headers.location,
        `/rough-preview/home/hero/iteration-01/?${TOKEN_PARAM}=${server.token}`
      );
    } finally {
      await server.close();
    }
  });

  it('wraps an HTML iteration in the wrapper the environment names', async () => {
    const repo = await siteRepo(siteWith({ wrapper: 'rough/preview.html' }), {
      'rough/preview.html':
        '<header class="site-header">Site header 2b7</header>\n<main>{{roughbook:iteration}}</main>\n<footer>Site footer</footer>\n'
    });
    const server = await serving(repo);
    try {
      const answer = await get(page(server, 'home/hero/iteration-01'));
      assert.equal(answer.status, 200);
      assert.match(answer.body, /Site header 2b7<\/header>\n<main><section class="hero">/);
      fs.writeFileSync(path.join(repo, 'rough', 'preview.html'), '<main>no stand-in</main>\n');
      const unwrapped = await get(page(server, 'home/hero/iteration-01'));
      assert.equal(unwrapped.status, 500);
      assert.match(unwrapped.body, /\{\{roughbook:iteration\}\}/);
    } finally {
      await server.close();
    }
  });
});

/** The page's script, run against a window that records what it posts and listens for. */
function runMessages(key: string, readyOn: 'load' | 'script') {
  const posted: unknown[] = [];
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const window = {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    // Read back as plain data: the script's objects are of another realm.
    postMessage: (message: unknown) => void posted.push(JSON.parse(JSON.stringify(message)))
  } as Record<string, unknown>;
  window.parent = window;
  vm.runInNewContext(messagesScript(key, readyOn), { window });
  const fire = (type: string, event: unknown = {}) =>
    (listeners.get(type) ?? []).forEach(listener => listener(event));
  return { posted, fire };
}

describe("the standalone page's messages", () => {
  it('posts ready once the page loaded, to its parent', () => {
    const { posted, fire } = runMessages('home/hero/iteration-01', 'load');
    assert.deepEqual(posted, []);
    fire('load');
    assert.deepEqual(posted, [{ roughbook: 'ready', id: 'home/hero/iteration-01' }]);
  });

  it('posts the error instead when the iteration throws, and ready never after', () => {
    const { posted, fire } = runMessages('home/hero/iteration-01', 'load');
    fire('error', { message: 'Uncaught TypeError: x is undefined' });
    fire('load');
    assert.deepEqual(posted, [
      {
        roughbook: 'error',
        id: 'home/hero/iteration-01',
        message: 'Uncaught TypeError: x is undefined'
      }
    ]);
    const rejected = runMessages('home/hero/iteration-01', 'load');
    rejected.fire('unhandledrejection', { reason: new Error('No data') });
    assert.deepEqual(rejected.posted, [
      { roughbook: 'error', id: 'home/hero/iteration-01', message: 'No data' }
    ]);
  });

  it('leaves ready to the bundle when it mounts the iteration itself', () => {
    const { posted, fire } = runMessages('home/hero/iteration-03', 'script');
    fire('load');
    assert.deepEqual(posted, []);
  });
});

describe('previews wherever they are taken', () => {
  it('passes a live dev server through, and starts the studio’s server for standalone', async () => {
    const live = next.environment(LINK);
    const seen = await withPreviews('/repo', live, 'http://localhost:3000', async (url, env) => ({
      url,
      preview: env.preview
    }));
    assert.deepEqual(seen, { url: 'http://localhost:3000', preview: '/rough-preview/{key}' });

    const repo = await siteRepo();
    const environment = readEnvironmentSync(repo, LINK);
    let address = '';
    const status = await withPreviews(
      repo,
      environment,
      'http://localhost:3000',
      async (url, env) => {
        assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
        assert.match(
          env.preview,
          new RegExp(`^/rough-preview/\\{key\\}/\\?${TOKEN_PARAM}=[\\w-]+$`)
        );
        address = `${url}${env.preview.replace('{key}', 'home/hero/iteration-01')}`;
        return (await get(address)).status;
      }
    );
    assert.equal(status, 200);
    // Stopped once the screenshots are taken.
    await assert.rejects(get(address));
  });
});

/**
 * A probe that stands in for the browser: it reads the page the server sent, hears ready where
 * the page rendered and the error where it did not, and shows the fixture where the iteration's
 * script would write it (the end-to-end runs in a real browser).
 */
function readingProbe(): DoctorTools['probe'] {
  return async ({ url, expect }): Promise<Probe> => {
    const answer = await get(url);
    let text = answer.body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
    if (answer.status === 200 && answer.body.includes('roughbookFixture.note')) {
      const fixture = await get(new URL('./__roughbook/fixture.js', url).toString(), {
        'sec-fetch-site': 'same-origin'
      });
      text += ` ${/"note":"([^"]*)"/.exec(fixture.body)?.[1] ?? ''}`;
    }
    const error =
      answer.status >= 400 ? (/"message":"([^"]*)"/.exec(answer.body)?.[1] ?? 'error') : null;
    return {
      shows: expect ? text.includes(expect) : true,
      ready: answer.status === 200,
      error,
      visibleOverlays: 0,
      exceptions: [],
      text
    };
  };
}

const SAMPLES = {
  'rough/setup/sample/good/index.html':
    '<section><h1>{{roughbook:marker}}</h1><p data-note></p><script>document.querySelector("[data-note]").textContent = window.roughbookFixture.note;</script></section>\n',
  'rough/setup/sample/good/preview.json': '{ "note": "{{roughbook:fixture}}" }\n',
  'rough/setup/sample/broken/index.html': '<section>{{roughbook:marker}}</section>\n',
  'rough/setup/sample/broken/preview.json': '{ "note": \n'
};

/**
 * The site in production mode, for the runtime gate: `hides` answers 404 for rough/; `falls-back`
 * answers a missing file with the site's own home page, as PHP's built-in server does; `serves`
 * hands out the repo's files as they are, rough/ among them.
 */
type Production = 'none' | 'hides' | 'falls-back' | 'serves';

function doctorTools(production: Production = 'none', repo = ''): Partial<DoctorTools> {
  return {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.port === '8091') {
        if (production === 'none') throw new Error('ECONNREFUSED');
        if (production === 'falls-back') return new Response('<h1>The site</h1>');
        const file = path.join(repo, ...url.pathname.split('/').filter(Boolean));
        return production === 'serves' && fs.existsSync(file)
          ? new Response(fs.readFileSync(file, 'utf8'))
          : new Response('Not Found', { status: 404 });
      }
      // The network address answers nothing: the server listens on 127.0.0.1 alone.
      if (url.hostname === '192.0.2.10') throw new Error('ECONNREFUSED');
      return fetch(input, init);
    }) as typeof fetch,
    probe: readingProbe(),
    screenshot: async ({ url, file }) => {
      if ((await get(url)).status !== 200) return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'PNG');
      return true;
    },
    exec: async () => ({ code: 0 }),
    serve: async () => (production === 'none' ? null : { stop: async () => {} }),
    which: program => `/fake/bin/${program}`,
    addresses: () => ['192.0.2.10'],
    sleep: async () => {},
    browser: '/fake/chrome'
  };
}

async function approved(repo: string): Promise<void> {
  await approveCommands(repo, environmentCommands(readEnvironmentSync(repo, LINK)));
}

describe('doctor in standalone mode', () => {
  it("passes on a static site through the studio's own server", async () => {
    const repo = await siteRepo(STATIC_SITE, SAMPLES);
    await approved(repo);
    const report = await runDoctor(repo, {
      devUrl: 'http://localhost:3000',
      speed: true,
      startApp: true,
      tools: doctorTools()
    });
    const failed = report.checks.filter(check => check.status === 'fail');
    assert.deepEqual(failed, [], JSON.stringify(failed, null, 2));
    assert.equal(report.outcome, 'pass');
    assert.ok(report.checks.every(check => check.status === 'pass'));
    assert.equal(report.environment.mode, 'standalone');
    const by = Object.fromEntries(report.checks.map(check => [check.id, check]));
    assert.match(by.app!.detail, /standalone server/);
    assert.match(by.app!.detail, /\/css\/site\.css/);
    for (const id of [
      'renders',
      'fixture',
      'reports-broken',
      'reports-missing',
      'screenshots',
      'fresh',
      'gate',
      'loopback'
    ]) {
      assert.equal(by[id]!.status, 'pass', id);
    }
    assert.match(by['reports-broken']!.detail, /500/);
    assert.match(by['reports-missing']!.detail, /404/);
    assert.match(by.gate!.detail, /public/);
    // Nothing of the app starts, so there is no cold start; the rest is measured as in live mode.
    assert.match(by.speed!.detail, /nothing of the app starts for a standalone preview/);
    assert.match(by.speed!.detail, /^Preview visible in \d/);
    // Doctor's own pages are gone again.
    assert.ok(
      !fs.readdirSync(path.join(repo, 'rough')).some(name => name.startsWith('doctor-check'))
    );
  });

  it('fails the app check when a stylesheet the environment names is not in the public folder', async () => {
    const repo = await siteRepo(STATIC_SITE.replace('/css/site.css', '/css/missing.css'), SAMPLES);
    await approved(repo);
    const report = await runDoctor(repo, { devUrl: 'http://localhost:3000', tools: doctorTools() });
    const app = report.checks.find(check => check.id === 'app')!;
    assert.equal(app.status, 'fail');
    assert.match(app.detail, /\/css\/missing\.css/);
    assert.match(app.fix ?? '', /stylesheets/);
  });

  it('finds rough/ in a site published as it is, from its root', async () => {
    const repo = await siteRepo(
      siteWith({ buildOutput: null }).replace('gate: build', 'gate: build\nbuildOutput:\n  - .'),
      SAMPLES
    );
    await approved(repo);
    const report = await runDoctor(repo, { devUrl: 'http://localhost:3000', tools: doctorTools() });
    const gate = report.checks.find(check => check.id === 'gate')!;
    assert.equal(gate.status, 'fail');
    assert.match(gate.detail, /rough\/doctor-check-[0-9a-f]+\/sample\/iteration-01\/index\.html/);
    assert.match(gate.fix ?? '', /rough\//);
  });

  it('asks a served site in production mode for the iteration’s own files under rough/', async () => {
    const served = siteWith({
      gate: 'runtime',
      build: null,
      buildOutput: null,
      production: 'php -S 127.0.0.1:8091 -t public @ http://127.0.0.1:8091'
    });
    for (const [production, status] of [
      ['hides', 'pass'],
      // A page of the site's own is not the iteration: what counts is whether rough/ is served.
      ['falls-back', 'pass'],
      ['serves', 'fail']
    ] as const) {
      const repo = await siteRepo(served, SAMPLES);
      await approved(repo);
      const report = await runDoctor(repo, {
        devUrl: 'http://localhost:3000',
        tools: doctorTools(production, repo)
      });
      const gate = report.checks.find(check => check.id === 'gate')!;
      assert.equal(gate.status, status, `${production}: ${gate.detail}`);
      if (status === 'fail') {
        assert.match(gate.detail, /served the sample iteration's own file/);
        assert.match(
          gate.detail,
          /rough\/doctor-check-[0-9a-f]+\/sample\/iteration-01\/index\.html/
        );
      }
    }
  });
});
