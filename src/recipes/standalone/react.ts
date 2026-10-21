// A React iteration, bundled with esbuild on every request: its entry's default export, mounted
// with the repo's own react and react-dom, inside the environment's wrapper component when it
// names one, with the fixture as its props. The page says ready once it rendered, and posts the
// error when it throws; a bundle that does not build answers 500 with esbuild's words.
import path from 'node:path';
import type { BuildFailure, Loader, Message } from 'esbuild';
import { contentType } from '../../standalone/files.js';
import { FILES_DIR } from '../../standalone/page.js';
import type { PageFile, StandaloneRenderer } from '../../standalone/types.js';

/** Files an iteration imports that the bundle links by address rather than holds. */
const ASSETS: Record<string, Loader> = Object.fromEntries(
  [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.avif',
    '.svg',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.mp4',
    '.webm',
    '.mp3',
    '.glb'
  ].map(extension => [extension, 'file' as Loader])
);

/** The bundle's entry: the iteration, its wrapper and the contract's messages, in plain JavaScript. */
export function mountScript(entry: string, wrapper: string | null): string {
  return `import * as React from 'react';
import { createRoot } from 'react-dom/client';
import Iteration from ${JSON.stringify(`./${entry}`)};
${wrapper ? `import Wrapper from ${JSON.stringify(wrapper)};` : 'const Wrapper = null;'}

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    window.roughbookFail(error && error.message ? error.message : String(error));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Ready(props) {
  React.useEffect(() => {
    window.roughbookReady();
  }, []);
  return props.children;
}

const shown = React.createElement(Iteration, window.roughbookFixture || {});
createRoot(document.getElementById('roughbook-root')).render(
  React.createElement(
    Boundary,
    null,
    React.createElement(Ready, null, Wrapper ? React.createElement(Wrapper, null, shown) : shown)
  )
);
`;
}

/** esbuild's first error, where it is in the repo and what it says. */
function describeFailure(error: unknown, repoRoot: string): string {
  const messages = (error as Partial<BuildFailure>).errors;
  const first: Message | undefined = Array.isArray(messages) ? messages[0] : undefined;
  if (!first) return error instanceof Error ? error.message : String(error);
  const where = first.location;
  const file = where
    ? path.relative(repoRoot, path.resolve(repoRoot, where.file)).split(path.sep).join('/')
    : null;
  const text = file ? `${file}:${where!.line}:${where!.column}: ${first.text}` : first.text;
  const missing = /^Could not resolve "(react|react-dom)/.test(first.text)
    ? ' Standalone previews mount a React iteration with the repo’s own react and react-dom; install them as the app installs its packages.'
    : '';
  const more = messages!.length > 1 ? ` (and ${messages!.length - 1} more)` : '';
  return `${text}${more}${missing}`;
}

export const react: StandaloneRenderer = {
  id: 'react',
  async render({ repoRoot, environment, dir, filesPath }) {
    const { build } = await import('esbuild');
    const outdir = path.join(dir, FILES_DIR);
    const wrapper = environment.wrapper
      ? path
          .join(repoRoot, ...environment.wrapper.split('/'))
          .split(path.sep)
          .join('/')
      : null;
    try {
      const result = await build({
        stdin: {
          contents: mountScript(environment.entry, wrapper),
          resolveDir: dir,
          sourcefile: 'roughbook-mount.js',
          loader: 'js'
        },
        absWorkingDir: repoRoot,
        bundle: true,
        write: false,
        outdir,
        entryNames: 'bundle',
        assetNames: '[name]-[hash]',
        publicPath: filesPath.replace(/\/$/, ''),
        format: 'esm',
        platform: 'browser',
        target: 'es2020',
        jsx: 'automatic',
        loader: ASSETS,
        define: { 'process.env.NODE_ENV': '"development"' },
        logLevel: 'silent',
        charset: 'utf8'
      });
      const files: Record<string, PageFile> = {};
      for (const output of result.outputFiles) {
        const name = path.relative(outdir, output.path).split(path.sep).join('/');
        files[name] = {
          type: contentType(name) ?? 'application/octet-stream',
          bytes: Buffer.from(output.contents)
        };
      }
      const names = Object.keys(files);
      const head = [
        ...names
          .filter(name => name.endsWith('.css'))
          .map(name => `<link rel="stylesheet" href="./${FILES_DIR}/${name}">`),
        ...names
          .filter(name => name.endsWith('.js'))
          .map(name => `<script type="module" src="./${FILES_DIR}/${name}"></script>`)
      ];
      return {
        ok: true,
        markup: '<div id="roughbook-root"></div>',
        head,
        readyOn: 'script',
        files
      };
    } catch (error) {
      return { ok: false, message: describeFailure(error, repoRoot) };
    }
  }
};
