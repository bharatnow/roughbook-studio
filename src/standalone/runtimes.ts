// The WebAssembly runtimes Rive and dotLottie load, served by the standalone server from the
// repo's own installed packages instead of the CDN the packages default to, as the backend's
// sandbox does for web sketches (roughbook-backend src/utils/sketch/runtimes.ts;
// ROUGHBOOK-STUDIO-PARITY-PLAN.md, T4). A React iteration's bundle imports such a package through
// a small wrapper that points its runtime at this server before the iteration's code runs.
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'esbuild';

/**
 * Where the runtimes are served: under the preview prefix (STANDALONE_PREVIEW, not imported here,
 * since the environment's reader imports the recipes), at a name no page slug can take.
 */
export const RUNTIME_PATH = '/rough-preview/__roughbook-runtime/';

/**
 * Rive's renderers: each package ships its own build of `rive.wasm` and `rive_fallback.wasm`,
 * named alike, so each is served under its renderer's name ('' for the canvas one, as before).
 * The `-advanced` packages are low-level, with no RuntimeLoader, and are left to their defaults.
 */
const RIVE_RENDERERS: { module: string; name: string; react: string }[] = [
  { module: '@rive-app/canvas', name: 'rive', react: '@rive-app/react-canvas' },
  {
    module: '@rive-app/canvas-lite',
    name: 'rive-canvas-lite',
    react: '@rive-app/react-canvas-lite'
  },
  { module: '@rive-app/webgl', name: 'rive-webgl', react: '@rive-app/react-webgl' },
  { module: '@rive-app/webgl2', name: 'rive-webgl2', react: '@rive-app/react-webgl2' }
];

/** dotLottie's renderers: the default one, and its WebGL and WebGPU builds, each with its runtime. */
const LOTTIE_RENDERERS: { sub: string; name: string; places: string[] }[] = [
  {
    sub: '',
    name: 'dotlottie-player.wasm',
    places: ['dist/dotlottie-player.wasm', 'dotlottie-player.wasm']
  },
  {
    sub: '/webgl',
    name: 'dotlottie-player-webgl.wasm',
    places: ['dist/webgl/dotlottie-player.wasm']
  },
  {
    sub: '/webgpu',
    name: 'dotlottie-player-webgpu.wasm',
    places: ['dist/webgpu/dotlottie-player.wasm']
  }
];

/** The served files: the package each is part of, and where in it the file may be. */
const FILES: Record<string, { module: string; places: string[] }> = Object.fromEntries([
  ...RIVE_RENDERERS.flatMap(rive => [
    [`${rive.name}.wasm`, { module: rive.module, places: ['rive.wasm'] }],
    [`${rive.name}_fallback.wasm`, { module: rive.module, places: ['rive_fallback.wasm'] }]
  ]),
  ...LOTTIE_RENDERERS.map(lottie => [
    lottie.name,
    { module: '@lottiefiles/dotlottie-web', places: lottie.places }
  ])
]);

/** The names the server answers for, and nothing else. */
export const RUNTIME_FILES = Object.keys(FILES);

/** A URL on this server, as the browser resolves it at run time. */
const HERE = `const here = file => new URL(${JSON.stringify(RUNTIME_PATH)} + file, document.baseURI).href;`;

const RIVE = (
  from: string,
  owner: string,
  name = 'rive'
) => `import { RuntimeLoader } from ${JSON.stringify(from)};
${HERE}
RuntimeLoader.setWasmUrl(here(${JSON.stringify(`${name}.wasm`)}));
RuntimeLoader.wasmFallbackURL = here(${JSON.stringify(`${name}_fallback.wasm`)});
if ('wasmThreadsURL' in RuntimeLoader) RuntimeLoader.wasmThreadsURL = null;
export * from ${JSON.stringify(owner)};
export { default } from ${JSON.stringify(owner)};
`;

/** dotLottie's web package: the player, and its worker (an inline one, with its own runtime URL). */
const LOTTIE_WEB = (
  from: string,
  file: string,
  worker: boolean
) => `import { ${worker ? 'DotLottie, DotLottieWorker' : 'DotLottie'} } from ${JSON.stringify(from)};
${HERE}
DotLottie.setWasmUrl(here(${JSON.stringify(file)}));
${worker ? `DotLottieWorker.setWasmUrl(here(${JSON.stringify(file)}));\n` : ''}export * from ${JSON.stringify(from)};
`;

/** dotLottie's React package: its own setWasmUrl, which also reaches the worker it has. */
const LOTTIE_REACT = (
  from: string,
  file: string
) => `import { setWasmUrl } from ${JSON.stringify(from)};
${HERE}
setWasmUrl(here(${JSON.stringify(file)}));
export * from ${JSON.stringify(from)};
`;

/**
 * The packages whose imports go through a wrapper: the wrapper's source, which sets the runtime's
 * URLs and re-exports the package. Rive's `RuntimeLoader` defaults to unpkg with a jsdelivr
 * fallback, and its threaded build needs cross-origin isolation, so it is turned off; dotLottie's
 * player defaults to jsdelivr.
 */
export const WASM_WRAPPERS: Record<string, string> = Object.fromEntries([
  ...RIVE_RENDERERS.flatMap(rive => [
    [rive.react, RIVE(rive.module, rive.react, rive.name)],
    [rive.module, RIVE(rive.module, rive.module, rive.name)]
  ]),
  ...LOTTIE_RENDERERS.flatMap(lottie => [
    [
      `@lottiefiles/dotlottie-react${lottie.sub}`,
      LOTTIE_REACT(`@lottiefiles/dotlottie-react${lottie.sub}`, lottie.name)
    ],
    // Only the default build has a worker.
    [
      `@lottiefiles/dotlottie-web${lottie.sub}`,
      LOTTIE_WEB(`@lottiefiles/dotlottie-web${lottie.sub}`, lottie.name, lottie.sub === '')
    ]
  ])
]);

/** The packages a served file may be found through: its own, and those that wrap it. */
function ownersOf(module: string): string[] {
  const owners = Object.keys(WASM_WRAPPERS)
    .map(packageName)
    .filter(name => name.split('/')[0] === module.split('/')[0] && name !== module);
  return [...new Set(owners)];
}

/** The package an import names: `@scope/name` of `@scope/name/sub`. */
function packageName(specifier: string): string {
  return specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
}

function realDir(dir: string): string | null {
  try {
    return fs.statSync(dir).isDirectory() ? fs.realpathSync(dir) : null;
  } catch {
    return null;
  }
}

/** A package's folder, found as Node finds it from `from`: each folder's node_modules, upward. */
function findPackage(from: string, name: string): string | null {
  let dir = from;
  for (;;) {
    const found = realDir(path.join(dir, 'node_modules', ...name.split('/')));
    if (found) return found;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * The file a served runtime name is, from the repo's own node_modules: null for any other name, a
 * package the repo does not have, or a file that is not inside the repo's node_modules.
 */
export function runtimeFile(repoRoot: string, name: string): string | null {
  if (!Object.hasOwn(FILES, name)) return null;
  const spec = FILES[name]!;
  const modules = realDir(path.join(repoRoot, 'node_modules'));
  if (!modules) return null;
  const inside = (file: string) => file.startsWith(modules + path.sep);
  // Its own package beside the repo's, or the one a wrapping package uses (nested, or pnpm's).
  const starts = [
    repoRoot,
    ...ownersOf(spec.module)
      .map(owner => realDir(path.join(repoRoot, 'node_modules', ...owner.split('/'))))
      .filter((dir): dir is string => dir !== null && inside(dir))
  ];
  for (const start of starts) {
    const dir = findPackage(start, spec.module);
    if (!dir || !inside(dir)) continue;
    for (const place of spec.places) {
      try {
        const file = fs.realpathSync(path.join(dir, ...place.split('/')));
        // The file the place names, under whatever name it is served as.
        const own = path.posix.basename(place);
        if (inside(file) && path.basename(file) === own && fs.statSync(file).isFile()) return file;
      } catch {
        // Not at this place; the next one.
      }
    }
  }
  return null;
}

/** The folder of the package that a resolved file is part of. */
function packageDir(file: string, name: string): string {
  const last = packageName(name).split('/').pop()!;
  let dir = path.dirname(file);
  while (path.basename(dir) !== last && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return path.basename(dir) === last ? dir : path.dirname(file);
}

const NAMESPACE = 'roughbook-wasm';

/**
 * Imports of a wrapped package from the repo's own code come through its wrapper. A package the
 * repo does not have is left to esbuild, so the bundle fails or builds as it did without this;
 * imports inside node_modules, and the wrapper's own, reach the package itself.
 */
export function wasmRuntimes(): Plugin {
  const names = Object.keys(WASM_WRAPPERS);
  const filter = new RegExp(
    `^(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')).join('|')})$`
  );
  return {
    name: 'roughbook-wasm-runtimes',
    setup(build) {
      build.onResolve({ filter }, async args => {
        if (args.namespace === NAMESPACE || (args.pluginData as { own?: boolean })?.own) return;
        if (args.importer.split(/[\\/]/).includes('node_modules')) return;
        const found = await build.resolve(args.path, {
          kind: args.kind,
          resolveDir: args.resolveDir,
          importer: args.importer,
          pluginData: { own: true }
        });
        if (found.errors.length || !found.path) return;
        return {
          path: args.path,
          namespace: NAMESPACE,
          pluginData: { dir: packageDir(found.path, args.path) }
        };
      });
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, args => ({
        contents: WASM_WRAPPERS[args.path]!,
        loader: 'js',
        // Its imports resolve from inside the package, to the very runtime the package uses.
        resolveDir: (args.pluginData as { dir: string }).dir
      }));
    }
  };
}
