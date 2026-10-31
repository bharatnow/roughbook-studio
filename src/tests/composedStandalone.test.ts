// The composed preview in standalone mode: at a page's key with ?roughbook-compose=..., the studio's
// own server answers one document holding each section in order, each in its marker, and runs the
// script the canvas talks to. Through the real server, for both kinds of iteration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { describe, it } from 'node:test';
import { readEnvironmentSync } from '../environment/read.js';
import { COMPOSE_PARAM } from '../recipes/context.js';
import { LIVE_SCRIPT } from '../recipes/live.js';
import { composeScript } from '../recipes/standalone/react.js';
import { documentHead, sectionHtml, splitDocument } from '../recipes/standalone/sections.js';
import { TOKEN_PARAM, startStandaloneServer } from '../standalone/server.js';
import { tempDir } from './helpers.js';

const LINK = {
  version: 1 as const,
  orgId: 'org-1',
  project: 'site',
  roughCommitted: true,
  appDir: null
};

const environmentWith = (entry: string, extra = '') => `---
contract: 1
recipe: none
family: markup-css
mode: standalone
entry: ${entry}
fixture: preview.json
sources:
  - .html
public: public
stylesheets:
  - /css/site.css
gate: build
build: none
buildOutput:
  - public
${extra}---
`;

async function repoOf(files: Record<string, string>): Promise<string> {
  const repo = await tempDir('roughbook-composed-standalone-');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  return repo;
}

const SITE = {
  'rough/environment.md': environmentWith('index.html'),
  'rough/home/hero/iteration-01/index.html': `<!doctype html>
<html lang="en">
<head>
<title>Hero</title>
<link rel="stylesheet" href="./hero.css">
<link rel="stylesheet" href="/css/site.css">
<script src="/js/shared.js"></script>
<style>.hero { background: url(./photo.png); min-height: 100vh; }</style>
</head>
<body class="on-dark" style="background: url('bg.png')">
<section class="hero"><img src="photo.png" srcset="a.png 1x, /b.png 2x" alt=""><a href="#top">Top</a></section>
<script>const items = [window.roughbookFixture.note]; function shout() {}</script>
</body>
</html>
`,
  'rough/home/hero/iteration-01/preview.json': '{ "note": "hero-fixture" }\n',
  'rough/home/footer/iteration-02/index.html': `<style>.foot { color: red; }</style>
<footer class="foot">Footer</footer>
<script src="/js/shared.js"></script>
<script type="module" src="./foot.js"></script>
<script>const items = [];</script>
`,
  'rough/home/broken/iteration-01/index.html': '<p>Fine</p>\n',
  'rough/home/broken/iteration-01/preview.json': '{ "note": \n',
  'public/css/site.css': 'body { margin: 0; }\n'
};

async function serving(files: Record<string, string>) {
  const repo = await repoOf(files);
  return startStandaloneServer(repo, () => readEnvironmentSync(repo, LINK));
}

type Server = Awaited<ReturnType<typeof serving>>;

function address(server: Server, key: string, compose: string, more = ''): string {
  const search = `${TOKEN_PARAM}=${server.token}&${COMPOSE_PARAM}=${compose}${more}`;
  return `${server.url}/rough-preview/${key}?${search}`;
}

const read = async (url: string, init: RequestInit = {}) => {
  const answer = await fetch(url, { redirect: 'manual', ...init });
  return { status: answer.status, headers: answer.headers, body: await answer.text() };
};

describe('the composed preview in standalone mode', () => {
  it('answers one page: sections in order, in markers, in one root, with the script', async () => {
    const server = await serving(SITE);
    try {
      const page = await read(address(server, 'home/', 'hero:iteration-01,footer:iteration-02'));
      assert.equal(page.status, 200);
      assert.match(String(page.headers.get('content-type')), /^text\/html/);
      assert.equal(page.headers.get('content-security-policy'), "frame-ancestors 'self'");
      const html = page.body;
      assert.equal(html.match(/<html/g)?.length, 1);
      assert.equal(html.match(/<body/g)?.length, 1);
      assert.equal(html.match(/<[a-z]+ data-roughbook-variant/g)?.length, 1);
      const hero = html.indexOf(
        '<roughbook-section data-roughbook-section="home/hero" style="display: contents">'
      );
      const footer = html.indexOf(
        '<roughbook-section data-roughbook-section="home/footer" style="display: contents">'
      );
      assert.ok(html.indexOf('<div data-roughbook-variant>') < hero);
      assert.ok(hero > 0 && hero < footer);
      // The body's attributes go to the element that is measured, the first in its marker.
      assert.match(html.slice(hero), /^<roughbook-section[^>]*>\n<div class="on-dark" style=/);
      assert.ok(html.includes(LIVE_SCRIPT));
      assert.ok(html.includes('var id = "home/composition";'));
      assert.match(html, /<link rel="stylesheet" href="\/css\/site\.css">/);
    } finally {
      await server.close();
    }
  });

  it('keeps each section working beside the others', async () => {
    const server = await serving(SITE);
    try {
      const { body } = await read(
        address(server, 'home/', 'hero:iteration-01,footer:iteration-02')
      );
      const base = '/rough-preview/home/hero/iteration-01';
      // Relative addresses mean its own folder; others are left alone.
      assert.ok(body.includes(`href="${base}/hero.css"`));
      assert.ok(body.includes(`src="${base}/photo.png"`));
      assert.ok(body.includes(`srcset="${base}/a.png 1x, /b.png 2x"`));
      assert.ok(body.includes(`url(${base}/photo.png)`));
      assert.ok(body.includes(`url('${base}/bg.png')`));
      assert.ok(body.includes('href="#top"'));
      assert.ok(body.includes('src="/rough-preview/home/footer/iteration-02/foot.js"'));
      // What two sections share is loaded once, and the site's own stylesheet not again.
      assert.equal(body.match(/\/js\/shared\.js/g)?.length, 1);
      assert.equal(body.match(/href="\/css\/site\.css"/g)?.length, 1);
      // Their const stay their own, in a block each; a function stays global in it.
      assert.equal(body.match(/<script>\{\n(const items = \[[^\n]*)\n\}<\/script>/g)?.length, 2);
      // Each section's own fixture, before its scripts.
      assert.ok(body.includes('window.roughbookFixture = {"note":"hero-fixture"};'));
      assert.ok(body.includes('window.roughbookFixture = null;'));
      assert.ok(
        body.indexOf('window.roughbookFixture = null;') >
          body.indexOf('window.roughbookFixture = {"note":"hero-fixture"};')
      );
    } finally {
      await server.close();
    }
  });

  it('answers as a missing iteration does, and validates before the filesystem', async () => {
    const server = await serving(SITE);
    try {
      const missing = await read(address(server, 'home/', 'hero:iteration-01,logos:iteration-01'));
      assert.equal(missing.status, 404);
      assert.ok(missing.body.includes('There is no iteration home/logos/iteration-01'));
      assert.ok(missing.body.includes('"id":"home/composition"'));
      for (const bad of [
        '',
        'hero',
        'hero:iteration-01:x',
        'HERO:iteration-01',
        '..:iteration-01',
        'hero:..%2F..%2Fsecret',
        Array.from({ length: 31 }, (_, index) => `s${index}:iteration-01`).join(',')
      ]) {
        const refused = await read(address(server, 'home/', bad));
        assert.equal(refused.status, 404, bad);
        assert.ok(refused.body.includes('"roughbook":"error"'), bad);
      }
      const page = await read(address(server, '..%2F..%2Fsecret/', 'hero:iteration-01'));
      assert.equal(page.status, 404);
      // A fixture that does not read is that iteration's failure, in the composition's name.
      const broken = await read(address(server, 'home/', 'broken:iteration-01'));
      assert.equal(broken.status, 500);
      assert.ok(broken.body.includes('home/broken/iteration-01: preview.json'));
      assert.ok(broken.body.includes('"id":"home/composition"'));
    } finally {
      await server.close();
    }
  });

  it('keeps the token and host checks, and leaves the single-iteration route as it was', async () => {
    const server = await serving(SITE);
    try {
      const compose = `${COMPOSE_PARAM}=hero:iteration-01`;
      const bare = await read(`${server.url}/rough-preview/home/?${compose}`);
      assert.equal(bare.status, 401);
      const wrongHost = await new Promise<number>((resolve, reject) => {
        const asked = http.get(
          address(server, 'home/', 'hero:iteration-01'),
          { headers: { host: 'other.test' } },
          answer => {
            answer.resume();
            resolve(answer.statusCode ?? 0);
          }
        );
        asked.on('error', reject);
      });
      assert.equal(wrongHost, 403);
      // Without the trailing slash it goes to the address its links need, token and all.
      const short = await read(address(server, 'home', 'hero:iteration-01'));
      assert.equal(short.status, 308);
      assert.match(String(short.headers.get('location')), /^\/rough-preview\/home\/\?/);
      assert.ok(String(short.headers.get('location')).includes(server.token));
      // The parameter means nothing at an iteration's address, and a page's key nothing without it.
      const single = await read(address(server, 'home/hero/iteration-01/', 'footer:iteration-02'));
      assert.equal(single.status, 200);
      assert.ok(!single.body.includes('roughbook-section'));
      assert.ok(!single.body.includes(LIVE_SCRIPT));
      const key = await read(`${server.url}/rough-preview/home/?${TOKEN_PARAM}=${server.token}`);
      assert.equal(key.status, 404);
    } finally {
      await server.close();
    }
  });

  it('carries the variant on the page and its word on the root, and Pick when asked', async () => {
    const server = await serving(SITE);
    try {
      const { body } = await read(
        address(
          server,
          'home/',
          'hero:iteration-01',
          '&roughbook-scheme=dark&roughbook-dir=rtl&roughbook-variant=calm&roughbook-pick=1'
        )
      );
      assert.match(/<html[^>]*>/.exec(body)?.[0] ?? '', /dir="rtl".*class="dark"/);
      assert.ok(!(/<html[^>]*>/.exec(body)?.[0] ?? '').includes('data-roughbook-variant'));
      assert.ok(body.includes('postMessage({ roughbook: "section", key: key }, "*")'));
    } finally {
      await server.close();
    }
  });

  it('puts a wrapper around the sections once, with its head in the page', async () => {
    const server = await serving({
      ...SITE,
      'rough/environment.md': environmentWith('index.html', 'wrapper: shell.html\n'),
      'shell.html':
        '<!doctype html><html><head><title>Site</title><style>.shell { color: blue; }</style></head><body class="site"><header>Site</header>{{roughbook:iteration}}</body></html>\n'
    });
    try {
      const { status, body } = await read(
        address(server, 'home/', 'hero:iteration-01,footer:iteration-02')
      );
      assert.equal(status, 200);
      assert.equal(body.match(/<header>Site<\/header>/g)?.length, 1);
      assert.match(body, /<body class="site">\n<div data-roughbook-variant>\n<header>/);
      assert.ok(body.indexOf('.shell { color: blue; }') < body.indexOf('</head>'));
      assert.ok(!body.includes('{{roughbook:iteration}}'));
      assert.ok(!body.includes('<title>Site</title>'));
    } finally {
      await server.close();
    }
  });

  it('bundles React sections into one mount, and keeps each composition’s files apart', async () => {
    const component = (name: string) =>
      `export default function ${name}(props) { return <section>${name} {props.note}</section>; }\n`;
    const server = await serving({
      'rough/environment.md': environmentWith('index.jsx'),
      'rough/home/hero/iteration-01/index.jsx': `import './hero.css';\n${component('Hero')}`,
      'rough/home/hero/iteration-01/hero.css': '.hero { min-height: 100vh; }\n',
      'rough/home/hero/iteration-01/preview.json': '{ "note": "react-fixture" }\n',
      'rough/home/footer/iteration-01/index.jsx': component('Footer'),
      'node_modules/react/package.json':
        '{ "name": "react", "version": "19.0.0", "exports": { ".": "./index.js", "./jsx-runtime": "./index.js", "./jsx-dev-runtime": "./index.js" } }',
      'node_modules/react/index.js':
        'export const Component = class {}; export const createElement = () => null; export const useEffect = () => {}; export const jsx = () => null; export const jsxs = () => null;\n',
      'node_modules/react-dom/package.json':
        '{ "name": "react-dom", "version": "19.0.0", "exports": { "./client": "./client.js" } }',
      'node_modules/react-dom/client.js':
        'export function createRoot() { return { render() {} }; }\n'
    });
    const same = { headers: { 'sec-fetch-site': 'same-origin' } };
    try {
      const one = await read(address(server, 'home/', 'hero:iteration-01,footer:iteration-01'));
      assert.equal(one.status, 200);
      assert.match(one.body, /<div data-roughbook-variant>\n<div id="roughbook-root"><\/div>/);
      assert.ok(!one.body.includes('<roughbook-section'));
      const link = /src="\.\/(__roughbook\/[0-9a-f]+\/bundle\.js)"/.exec(one.body)?.[1];
      assert.ok(link, one.body);
      const two = await read(address(server, 'home/', 'footer:iteration-01'));
      assert.equal(two.status, 200);
      const other = /src="\.\/(__roughbook\/[0-9a-f]+\/bundle\.js)"/.exec(two.body)?.[1];
      assert.notEqual(other, link);
      // The first page's bundle is still its own after the second was asked.
      const bundle = await read(`${server.url}/rough-preview/home/${link}`, same);
      assert.equal(bundle.status, 200);
      assert.match(String(bundle.headers.get('content-type')), /javascript/);
      assert.ok(bundle.body.includes('react-fixture'));
      assert.ok(bundle.body.includes('roughbook-section'));
      const styles = await read(
        `${server.url}/rough-preview/home/${link.replace('.js', '.css')}`,
        same
      );
      assert.ok(styles.body.includes('100vh'));
      const none = await read(`${server.url}/rough-preview/home/__roughbook/0/bundle.js`, same);
      assert.equal(none.status, 404);
    } finally {
      await server.close();
    }
  });

  it('answers 500 in esbuild’s words when a section does not build', async () => {
    const server = await serving({
      'rough/environment.md': environmentWith('index.jsx'),
      'rough/home/hero/iteration-01/index.jsx': 'export default function ( {\n'
    });
    try {
      const page = await read(address(server, 'home/', 'hero:iteration-01'));
      assert.equal(page.status, 500);
      assert.ok(page.body.includes('"id":"home/composition"'));
      assert.ok(page.body.includes('rough/home/hero/iteration-01/index.jsx'));
    } finally {
      await server.close();
    }
  });
});

describe('a section’s markup in one document', () => {
  it('splits a document, with or without its body tag, and leaves a fragment whole', () => {
    assert.deepEqual(splitDocument('<section>One</section>'), {
      head: '',
      attributes: '',
      body: '<section>One</section>'
    });
    assert.equal(
      splitDocument('<!doctype html><html><head><title>A</title></head><h1>B</h1></html>').body,
      '<h1>B</h1>'
    );
    assert.deepEqual(splitDocument('<html><body id="a"><p>B</p></body></html>'), {
      head: '',
      attributes: ' id="a"',
      body: '<p>B</p>'
    });
    // A header is not a head.
    assert.equal(splitDocument('<header>A</header>').head, '');
  });

  it('keeps a head’s styles and scripts, but not its comments, title or meta', () => {
    assert.deepEqual(
      documentHead(
        '<title>A</title><meta charset="utf-8"><!-- <script src="old.js"></script> --><link rel="stylesheet" href="a.css"><style>b {}</style><script src="c.js"></script>'
      ),
      [
        '<link rel="stylesheet" href="a.css">',
        '<style>b {}</style>',
        '<script src="c.js"></script>'
      ]
    );
  });

  it('leaves scripts that need no block, and addresses that are not relative', () => {
    const base = '/rough-preview/home/hero/iteration-01/';
    const kept = [
      '<script type="module">const a = 1;</script>',
      '<script type="application/json">{"a": 1}</script>',
      '<a href="https://example.test/a">A</a>',
      '<a href="mailto:a@example.test">A</a>',
      '<img src="data:image/png;base64,AA==" alt="">',
      '<!-- <img src="old.png"> -->'
    ];
    for (const html of kept) assert.equal(sectionHtml(html, base, new Set()), html);
    assert.equal(
      sectionHtml('<script type="text/javascript">let a;</script>', base, new Set()),
      '<script type="text/javascript">{\nlet a;\n}</script>'
    );
    assert.equal(
      sectionHtml('<img title="a > b" src="../x.png">', base, new Set()),
      '<img title="a > b" src="/rough-preview/home/hero/x.png">'
    );
    assert.equal(
      sectionHtml(`<style>@import "a.css"; b { c: url('d.png'); }</style>`, base, new Set()),
      `<style>@import "${base}a.css"; b { c: url('${base}d.png'); }</style>`
    );
  });
});

describe('the composed bundle', () => {
  it('holds every section once, with its fixture as props', () => {
    const script = composeScript(
      'home',
      [
        { component: 'hero', dir: '/repo/hero', sitePath: '/h/', fixture: { note: 'a' } },
        { component: 'footer', dir: '/repo/footer', sitePath: '/f/', fixture: null }
      ],
      'index.tsx',
      null
    );
    assert.equal(script.match(/createRoot\(document/g)?.length, 1);
    assert.match(script, /marked\(Section0, "home\/hero", \{"note":"a"\}\)/);
    assert.match(script, /marked\(Section1, "home\/footer", \{\}\)/);
    assert.match(script, /"data-roughbook-section": marker/);
  });
});
