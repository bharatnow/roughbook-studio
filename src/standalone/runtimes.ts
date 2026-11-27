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

/** The served files: the package each is part of, and where in it the file may be. */
const FILES: Record<string, { module: string; places: string[] }> = {
  'rive.wasm': { module: '@rive-app/canvas', places: ['rive.wasm'] },
  'rive_fallback.wasm': { module: '@rive-app/canvas', places: ['rive_fallback.wasm'] },
  'dotlottie-player.wasm': {
    module: '@lottiefiles/dotlottie-web',
    places: ['dist/dotlottie-player.wasm', 'dotlottie-player.wasm']
  }
};

/** The names the server answers for, and nothing else. */
export const RUNTIME_FILES = Object.keys(FILES);

/** A URL on this server, as the browser resolves it at run time. */
const HERE = `const here = file => new URL(${JSON.stringify(RUNTIME_PATH)} + file, document.baseURI).href;`;

const RIVE = (
  from: string,
  owner: string
) => `import { RuntimeLoader } from ${JSON.stringify(from)};
${HERE}
RuntimeLoader.setWasmUrl(here('rive.wasm'));
RuntimeLoader.wasmFallbackURL = here('rive_fallback.wasm');
if ('wasmThreadsURL' in RuntimeLoader) RuntimeLoader.wasmThreadsURL = null;
export * from ${JSON.stringify(owner)};
export { default } from ${JSON.stringify(owner)};
`;

/**
 * The packages whose imports go through a wrapper: the wrapper's source, which sets the runtime's
 * URLs and re-exports the package. Rive's `RuntimeLoader` defaults to unpkg with a jsdelivr
 * fallback, and its threaded build needs cross-origin isolation, so it is turned off; dotLottie's
 * player defaults to jsdelivr.
 */
export const WASM_WRAPPERS: Record<string, string> = {
  '@rive-app/react-canvas': RIVE('@rive-app/canvas', '@rive-app/react-canvas'),
  '@rive-app/canvas': RIVE('@rive-app/canvas', '@rive-app/canvas'),
  '@lottiefiles/dotlottie-react': `import { setWasmUrl } from '@lottiefiles/dotlottie-react';
${HERE}
setWasmUrl(here('dotlottie-player.wasm'));
export * from '@lottiefiles/dotlottie-react';
`,
  '@lottiefiles/dotlottie-web': `import { DotLottie } from '@lottiefiles/dotlottie-web';
${HERE}
DotLottie.setWasmUrl(here('dotlottie-player.wasm'));
export * from '@lottiefiles/dotlottie-web';
`
};

/** The packages a served file may be found through: its own, and those that wrap it. */
function ownersOf(module: string): string[] {
  return Object.keys(WASM_WRAPPERS).filter(
    name => name.split('/')[0] === module.split('/')[0] && name !== module
  );
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
        if (inside(file) && path.basename(file) === name && fs.statSync(file).isFile()) return file;
      } catch {
        // Not at this place; the next one.
      }
    }
  }
  return null;
}

/** The folder of the package that a resolved file is part of. */
function packageDir(file: string, name: string): string {
  const last = name.split('/').pop()!;
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
