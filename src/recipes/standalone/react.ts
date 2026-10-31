// A React iteration, bundled with esbuild on every request: its entry's default export, mounted
// with the repo's own react and react-dom, inside the environment's wrapper component when it
// names one, with the fixture as its props. The page says ready once it rendered, and posts the
// error when it throws; a bundle that does not build answers 500 with esbuild's words.
//
// A composition is one bundle and one mount, as one app is: every section under the same React,
// each in its marker with its fixture as its props and a boundary of its own, the wrapper once
// around them all, and the page's ready once all of them rendered.
import path from 'node:path';
import type { BuildFailure, Loader, Message } from 'esbuild';
import { contentType } from '../../standalone/files.js';
import { FILES_DIR } from '../../standalone/page.js';
import type { ComposeSection, PageFile, StandaloneRenderer } from '../../standalone/types.js';
import { MARKER_ELEMENT, SECTION_ATTRIBUTE } from '../context.js';

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

/** What a bundle's entry always holds: the contract's messages, around what it renders. */
const MESSAGES = `class Boundary extends React.Component {
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
}`;

/** The bundle's entry: the iteration, its wrapper and the contract's messages, in plain JavaScript. */
export function mountScript(entry: string, wrapper: string | null): string {
  return `import * as React from 'react';
import { createRoot } from 'react-dom/client';
import Iteration from ${JSON.stringify(`./${entry}`)};
${wrapper ? `import Wrapper from ${JSON.stringify(wrapper)};` : 'const Wrapper = null;'}

${MESSAGES}

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

/** The same for a composition: every section's iteration, each in its marker. */
export function composeScript(
  page: string,
  sections: ComposeSection[],
  entry: string,
  wrapper: string | null
): string {
  const file = (section: ComposeSection) => path.join(section.dir, entry).split(path.sep).join('/');
  return `import * as React from 'react';
import { createRoot } from 'react-dom/client';
${sections.map((section, index) => `import Section${index} from ${JSON.stringify(file(section))};`).join('\n')}
${wrapper ? `import Wrapper from ${JSON.stringify(wrapper)};` : 'const Wrapper = null;'}

${MESSAGES}

const marked = (Section, marker, fixture) =>
  React.createElement(
    ${JSON.stringify(MARKER_ELEMENT)},
    { key: marker, ${JSON.stringify(SECTION_ATTRIBUTE)}: marker, style: { display: 'contents' } },
    React.createElement(Boundary, null, React.createElement(Section, fixture))
  );

const shown = [
${sections
  .map(
    (section, index) =>
      `  marked(Section${index}, ${JSON.stringify(`${page}/${section.component}`)}, ${JSON.stringify(section.fixture ?? {})})`
  )
  .join(',\n')}
];
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

/** The wrapper's file for an import, or null. */
function wrapperFile(repoRoot: string, wrapper: string | null): string | null {
  return wrapper
    ? path
        .join(repoRoot, ...wrapper.split('/'))
        .split(path.sep)
        .join('/')
    : null;
}

async function bundled(input: {
  repoRoot: string;
  contents: string;
  dir: string;
  filesPath: string;
  filesLink: string;
}): Promise<
  { ok: true; head: string[]; files: Record<string, PageFile> } | { ok: false; message: string }
> {
  const { repoRoot, contents, dir, filesPath, filesLink } = input;
  const { build } = await import('esbuild');
  const outdir = path.join(dir, FILES_DIR);
  try {
    const result = await build({
      stdin: {
        contents,
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
        .map(name => `<link rel="stylesheet" href="${filesLink}${name}">`),
      ...names
        .filter(name => name.endsWith('.js'))
        .map(name => `<script type="module" src="${filesLink}${name}"></script>`)
    ];
    return { ok: true, head, files };
  } catch (error) {
    return { ok: false, message: describeFailure(error, repoRoot) };
  }
}

export const react: StandaloneRenderer = {
  id: 'react',
  async render({ repoRoot, environment, dir, filesPath }) {
    const done = await bundled({
      repoRoot,
      contents: mountScript(environment.entry, wrapperFile(repoRoot, environment.wrapper)),
      dir,
      filesPath,
      filesLink: `./${FILES_DIR}/`
    });
    if (!done.ok) return done;
    return {
      ok: true,
      markup: '<div id="roughbook-root"></div>',
      head: done.head,
      readyOn: 'script',
      files: done.files
    };
  },
  async composePage({ repoRoot, environment, page, sections, filesPath, filesLink }) {
    const done = await bundled({
      repoRoot,
      contents: composeScript(
        page,
        sections,
        environment.entry,
        wrapperFile(repoRoot, environment.wrapper)
      ),
      dir: repoRoot,
      filesPath,
      filesLink
    });
    if (!done.ok) return done;
    return {
      ok: true,
      markup: '<div id="roughbook-root"></div>',
      head: done.head,
      bodyAttributes: '',
      readyOn: 'script',
      files: done.files
    };
  }
};
