// Rive and dotLottie on the standalone canvas (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T4): their
// WebAssembly comes from the repo's own node_modules through the studio's server, never a CDN,
// as the backend's sandbox does for web sketches. The packages here are tiny fakes with the same
// names, files and runtime calls as the real ones.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http, { type IncomingHttpHeaders } from 'node:http';
import path from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { STANDALONE_PREVIEW, readEnvironmentSync } from '../environment/read.js';
import { TOKEN_PARAM, startStandaloneServer } from '../standalone/server.js';
import { RUNTIME_PATH, RUNTIME_FILES, runtimeFile } from '../standalone/runtimes.js';
import { tempDir } from './helpers.js';

const LINK = {
  version: 1 as const,
  orgId: 'org-1',
  project: 'site',
  roughCommitted: true,
  appDir: null
};

const ENVIRONMENT = `---
contract: 1
recipe: none
stack:
  - static
family: react-like
mode: standalone
entry: index.tsx
sources:
  - .tsx
public: none
gate: build
build: none
buildOutput:
  - dist
---

A React site shown by the studio's own server.
`;

/** Just enough of React for esbuild to bundle against and a vm to run. */
const REACT: Record<string, string> = {
  'node_modules/react/package.json': JSON.stringify({
    name: 'react',
    exports: { '.': './index.js', './jsx-runtime': './jsx-runtime.js' }
  }),
  'node_modules/react/index.js':
    'export function createElement(type, props) { return { type, props }; }\nexport class Component {}\nexport function useEffect() {}\n',
  'node_modules/react/jsx-runtime.js':
    'export function jsx(type, props) { return { type, props }; }\nexport const jsxs = jsx;\nexport const Fragment = "fragment";\n',
  'node_modules/react-dom/package.json': JSON.stringify({
    name: 'react-dom',
    exports: { './client': './client.js' }
  }),
  'node_modules/react-dom/client.js': 'export function createRoot() { return { render() {} }; }\n'
};

/** Rive's canvas runtime, CommonJS as the real one is, and its React package nested beside it. */
const RIVE: Record<string, string> = {
  'node_modules/@rive-app/canvas/package.json': JSON.stringify({
    name: '@rive-app/canvas',
    main: 'rive.js'
  }),
  'node_modules/@rive-app/canvas/rive.js':
    'const RuntimeLoader = { setWasmUrl(url) { globalThis.wasmUrls.push(["rive", url]); }, wasmFallbackURL: null, wasmThreadsURL: "threads" };\nexports.RuntimeLoader = RuntimeLoader;\nexports.Rive = function Rive() {};\n',
  'node_modules/@rive-app/canvas/rive.wasm': 'rive-bytes-41c',
  'node_modules/@rive-app/canvas/rive_fallback.wasm': 'rive-fallback-bytes-9d0',
  'node_modules/@rive-app/react-canvas/package.json': JSON.stringify({
    name: '@rive-app/react-canvas',
    main: 'dist/index.js'
  }),
  'node_modules/@rive-app/react-canvas/dist/index.js':
    'const { RuntimeLoader } = require("@rive-app/canvas");\nexports.useRive = function useRive() { return { loader: RuntimeLoader }; };\nexports.default = function Rive() {};\n'
};

/** dotLottie: the web player owns the wasm; the React package re-exports its URL setter. */
const DOTLOTTIE: Record<string, string> = {
  'node_modules/@lottiefiles/dotlottie-web/package.json': JSON.stringify({
    name: '@lottiefiles/dotlottie-web',
    type: 'module',
    exports: {
      '.': './dist/index.js',
      './dotlottie-player.wasm': './dist/dotlottie-player.wasm'
    }
  }),
  'node_modules/@lottiefiles/dotlottie-web/dist/index.js':
    'export class DotLottie { static setWasmUrl(url) { globalThis.wasmUrls.push(["dotlottie-web", url]); } }\n',
  'node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm': 'dotlottie-bytes-7e2',
  'node_modules/@lottiefiles/dotlottie-react/package.json': JSON.stringify({
    name: '@lottiefiles/dotlottie-react',
    type: 'module',
    exports: { '.': './dist/index.js' }
  }),
  'node_modules/@lottiefiles/dotlottie-react/dist/index.js':
    'import { DotLottie } from "@lottiefiles/dotlottie-web";\nexport function setWasmUrl(url) { globalThis.wasmUrls.push(["dotlottie-react", url]); }\nexport function DotLottieReact() { return DotLottie; }\n'
};

const ITERATIONS: Record<string, string> = {
  'rough/environment.md': ENVIRONMENT,
  'rough/home/hero/iteration-01/index.tsx':
    'import Rive, { useRive } from "@rive-app/react-canvas";\n\nexport default function Hero() {\n  useRive();\n  return <section><Rive /><h1>Rive hero 2f1</h1></section>;\n}\n',
  'rough/home/hero/iteration-02/index.tsx':
    'import { DotLottieReact } from "@lottiefiles/dotlottie-react";\n\nexport default function Hero() {\n  return <section><DotLottieReact /><h1>Lottie hero 6b3</h1></section>;\n}\n',
  'rough/home/hero/iteration-03/index.tsx':
    'export default function Hero() {\n  return <section><h1>Plain hero 0c8</h1></section>;\n}\n',
  'rough/home/hero/iteration-04/index.tsx':
    'import { Rive } from "@rive-app/canvas";\n\nexport default function Hero() {\n  return <section>{String(Rive)}</section>;\n}\n'
};

async function repoWith(files: Record<string, string>): Promise<string> {
  const repo = await tempDir('roughbook-wasm-');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), content);
  }
  return repo;
}

type Answer = { status: number; headers: IncomingHttpHeaders; body: string };

function get(url: string, headers: Record<string, string> = {}, raw = false): Promise<Answer> {
  const target = new URL(url);
  const asked = raw ? url.slice(target.origin.length) : `${target.pathname}${target.search}`;
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: target.hostname,
        port: target.port,
        path: asked,
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

const OWN = { 'sec-fetch-site': 'same-origin' };

async function serving(repo: string) {
  return startStandaloneServer(repo, () => readEnvironmentSync(repo, LINK));
}

/** An iteration's bundle, as its page links it. */
async function bundleOf(
  server: Awaited<ReturnType<typeof serving>>,
  key: string
): Promise<Answer & { base: string }> {
  const base = `${server.url}${STANDALONE_PREVIEW.replace('{key}', key)}`;
  const shell = await get(`${base}?${TOKEN_PARAM}=${encodeURIComponent(server.token)}`);
  assert.equal(shell.status, 200, shell.body);
  const script = /<script type="module" src="(\.\/__roughbook\/[^"]+\.js)"><\/script>/.exec(
    shell.body
  )?.[1];
  assert.ok(script, 'the bundle is linked');
  return { ...(await get(new URL(script!, base).toString(), OWN)), base };
}

/** Runs a bundle as the page would, and returns the URLs it gave the runtimes. */
function wasmUrlsOf(bundle: string, base: string): [string, string][] {
  const context = {
    wasmUrls: [] as [string, string][],
    URL,
    document: { baseURI: base, getElementById: () => ({}) },
    window: { roughbookReady() {}, roughbookFail() {} }
  };
  vm.runInNewContext(bundle, context);
  // From the vm's own realm, so compared by value.
  return JSON.parse(JSON.stringify(context.wasmUrls)) as [string, string][];
}

describe('WebAssembly runtimes on the standalone canvas', () => {
  it('serves each runtime from the repo’s node_modules as application/wasm', async () => {
    const repo = await repoWith({ ...REACT, ...RIVE, ...DOTLOTTIE, ...ITERATIONS });
    const server = await serving(repo);
    try {
      const bytes: Record<string, string> = {
        'rive.wasm': 'rive-bytes-41c',
        'rive_fallback.wasm': 'rive-fallback-bytes-9d0',
        'dotlottie-player.wasm': 'dotlottie-bytes-7e2'
      };
      assert.deepEqual(RUNTIME_FILES.sort(), Object.keys(bytes).sort());
      assert.ok(RUNTIME_PATH.startsWith(STANDALONE_PREVIEW.replace('{key}/', '')));
      for (const [name, body] of Object.entries(bytes)) {
        const answer = await get(`${server.url}${RUNTIME_PATH}${name}`, OWN);
        assert.equal(answer.status, 200, name);
        assert.equal(answer.headers['content-type'], 'application/wasm');
        assert.equal(answer.body, body);
      }
      // It needs the token or the page's own origin, as every other answer does.
      assert.equal((await get(`${server.url}${RUNTIME_PATH}rive.wasm`)).status, 401);
    } finally {
      await server.close();
    }
  });

  it('refuses any other name, a traversal, and a file outside the repo’s node_modules', async () => {
    const repo = await repoWith({
      ...REACT,
      ...RIVE,
      ...ITERATIONS,
      'node_modules/@rive-app/canvas/other.wasm': 'other',
      'secret.wasm': 'leaked-bytes-5a5'
    });
    const server = await serving(repo);
    try {
      for (const asked of [
        'other.wasm',
        'secret.wasm',
        '../secret.wasm',
        '..%2Fsecret.wasm',
        '..%2F..%2Fsecret.wasm',
        '%2E%2E/%2E%2E/secret.wasm',
        'rive.wasm/',
        'sub/rive.wasm',
        'RIVE.WASM',
        'package.json',
        '',
        // Its package is not installed here.
        'dotlottie-player.wasm',
        'hasOwnProperty',
        '__proto__'
      ]) {
        // Sent as written: a URL would resolve the dots away before the server saw them.
        const answer = await get(`${server.url}${RUNTIME_PATH}${asked}`, OWN, true);
        assert.equal(answer.status, 404, asked);
        assert.ok(!answer.body.includes('leaked-bytes'), asked);
      }
      assert.equal(runtimeFile(repo, '../../secret.wasm'), null);
    } finally {
      await server.close();
    }
  });

  it('serves nothing that resolves outside the repo’s node_modules', async () => {
    const outside = await repoWith({
      'canvas/rive.wasm': 'outside-bytes',
      'canvas/package.json': '{}'
    });
    const repo = await repoWith({ ...REACT, ...ITERATIONS });
    fs.mkdirSync(path.join(repo, 'node_modules', '@rive-app'), { recursive: true });
    try {
      fs.symlinkSync(
        path.join(outside, 'canvas'),
        path.join(repo, 'node_modules', '@rive-app', 'canvas'),
        'junction'
      );
    } catch {
      return; // No links on this machine: nothing to prove.
    }
    assert.equal(runtimeFile(repo, 'rive.wasm'), null);
  });

  it('finds the runtime nested under the package that uses it', async () => {
    const nested = Object.fromEntries(
      Object.entries(RIVE).map(([name, content]) => [
        name.replace(
          'node_modules/@rive-app/canvas/',
          'node_modules/@rive-app/react-canvas/node_modules/@rive-app/canvas/'
        ),
        content
      ])
    );
    const repo = await repoWith({ ...REACT, ...nested, ...ITERATIONS });
    const file = runtimeFile(repo, 'rive.wasm');
    assert.ok(file);
    assert.equal(fs.readFileSync(file, 'utf8'), 'rive-bytes-41c');
  });

  it('points a Rive and a dotLottie bundle at the local runtimes, before the iteration runs', async () => {
    const repo = await repoWith({ ...REACT, ...RIVE, ...DOTLOTTIE, ...ITERATIONS });
    const server = await serving(repo);
    try {
      const rive = await bundleOf(server, 'home/hero/iteration-01');
      assert.equal(rive.status, 200, rive.body);
      assert.ok(rive.body.includes('Rive hero 2f1'));
      assert.ok(!/unpkg|jsdelivr/.test(rive.body));
      const local = `${server.url}${RUNTIME_PATH}`;
      assert.deepEqual(wasmUrlsOf(rive.body, rive.base), [['rive', `${local}rive.wasm`]]);
      // The fallback is local too, and the threaded build is off.
      assert.ok(rive.body.includes('wasmFallbackURL = here("rive_fallback.wasm")'));
      assert.ok(rive.body.includes('wasmThreadsURL = null'));

      const lottie = await bundleOf(server, 'home/hero/iteration-02');
      assert.equal(lottie.status, 200, lottie.body);
      assert.ok(lottie.body.includes('Lottie hero 6b3'));
      assert.ok(!/unpkg|jsdelivr/.test(lottie.body));
      assert.deepEqual(wasmUrlsOf(lottie.body, lottie.base), [
        ['dotlottie-react', `${local}dotlottie-player.wasm`]
      ]);

      // Rive's runtime imported on its own goes through the same wrapper.
      const canvas = await bundleOf(server, 'home/hero/iteration-04');
      assert.equal(canvas.status, 200, canvas.body);
      assert.deepEqual(wasmUrlsOf(canvas.body, canvas.base), [['rive', `${local}rive.wasm`]]);
    } finally {
      await server.close();
    }
  });

  it('bundles an iteration without them as before, and leaves a missing package to esbuild', async () => {
    const repo = await repoWith({ ...REACT, ...ITERATIONS });
    const server = await serving(repo);
    try {
      const plain = await bundleOf(server, 'home/hero/iteration-03');
      assert.equal(plain.status, 200);
      assert.ok(plain.body.includes('Plain hero 0c8'));
      assert.ok(!plain.body.includes(RUNTIME_PATH));
      assert.ok(!plain.body.includes('setWasmUrl'));
      assert.deepEqual(wasmUrlsOf(plain.body, plain.base), []);

      // Rive is not installed here: the build fails with esbuild's own words, as it did before.
      const missing = await get(
        `${server.url}${STANDALONE_PREVIEW.replace('{key}', 'home/hero/iteration-01')}?${TOKEN_PARAM}=${server.token}`
      );
      assert.equal(missing.status, 500);
      assert.match(missing.body, /Could not resolve (?:&quot;|")@rive-app\/react-canvas/);
    } finally {
      await server.close();
    }
  });
});
