// The Next.js recipe's generated files type-check in the app (B6's integration): `next build`
// type-checks rough/preview-registry.ts through the preview route, so a baseline re-exporting a
// component with required props, or an iteration of one, must not fail the app's build. The
// registries, the route and the in-page view's server wrapper are checked by TypeScript itself.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { renderContext } from '../recipes/next/context.js';
import { contextFiles } from '../recipes/next/context.js';
import {
  PREVIEW_WRAPPER,
  previewRouteFiles,
  renderPreviewRegistry
} from '../recipes/next/preview.js';
import { tempDir } from './helpers.js';

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

/** What the route and the wrapper import from Next.js, as far as their types go. */
const NEXT_STAND_INS: Record<string, string> = {
  'stand-ins/next-headers.d.ts':
    'export declare function headers(): Promise<{ get(name: string): string | null }>;\n',
  'stand-ins/next-navigation.d.ts': 'export declare function notFound(): never;\n',
  'stand-ins/next-store.d.ts':
    'export declare const workUnitAsyncStorage: { getStore(): unknown };\n'
};

function typeErrors(repo: string, files: string[]): string[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
    types: ['node'],
    typeRoots: [path.join(studio, 'node_modules', '@types')],
    baseUrl: repo,
    paths: {
      '@/*': ['./*'],
      react: [path.join(studio, 'node_modules', '@types', 'react')],
      'react/jsx-runtime': [path.join(studio, 'node_modules', '@types', 'react', 'jsx-runtime')],
      'next/headers': ['./stand-ins/next-headers.d.ts'],
      'next/navigation': ['./stand-ins/next-navigation.d.ts'],
      'next/dist/server/app-render/work-unit-async-storage.external': [
        './stand-ins/next-store.d.ts'
      ]
    }
  };
  const program = ts.createProgram(
    files.map(file => path.join(repo, ...file.split('/'))),
    options
  );
  return ts.getPreEmitDiagnostics(program).map(item => {
    const where = item.file
      ? `${path.relative(repo, item.file.fileName)}:${item.file.getLineAndCharacterOfPosition(item.start ?? 0).line + 1}`
      : '';
    return `${where} ${ts.flattenDiagnosticMessageText(item.messageText, '\n')}`;
  });
}

describe("the Next.js recipe's generated files in the app's type check", () => {
  it('take a baseline and an iteration of a component with required props', async () => {
    const repo = await tempDir('roughbook-registry-types-');
    for (const [file, text] of Object.entries(NEXT_STAND_INS)) write(repo, file, text);
    write(
      repo,
      'components/home/hero.tsx',
      'type Props = { title: string; cta: string };\nexport default function Hero({ title, cta }: Props) {\n  return <h1>{title} {cta}</h1>;\n}\n'
    );
    // The baseline, B2's pointer, and an iteration of the same component, with their fixtures.
    write(
      repo,
      'rough/home/hero/iteration-00/index.tsx',
      'export { default } from "@/components/home/hero";\n'
    );
    write(
      repo,
      'rough/home/hero/iteration-00/preview.json',
      '{ "title": "Plan less", "cta": "Go" }\n'
    );
    write(
      repo,
      'rough/home/hero/iteration-01/index.tsx',
      'export default function Fork({ title }: { title: string }) {\n  return <h2>{title}</h2>;\n}\n'
    );
    write(repo, 'rough/preview.tsx', PREVIEW_WRAPPER);
    const keys = ['home/hero/iteration-00', 'home/hero/iteration-01'];
    write(repo, 'rough/preview-registry.ts', renderPreviewRegistry(keys, [keys[0]!]));
    const { registry, keys: browserKeys } = renderContext([
      {
        key: 'home/hero',
        page: 'home',
        component: 'hero',
        address: '/',
        source: {
          slug: 'hero',
          name: 'Hero',
          kind: 'section',
          files: ['components/home/hero.tsx'],
          export: 'default',
          fixture: null,
          alone: 'yes',
          why: null,
          byAgent: false
        },
        iterations: [
          {
            key: 'home/hero/iteration-01',
            iteration: 'iteration-01',
            shown: 'rough/home/hero/iteration-01/index.tsx'
          }
        ]
      }
    ]);
    write(repo, 'rough/context-registry.ts', registry);
    write(repo, 'rough/context-keys.ts', browserKeys);
    // The route as a mapped repo has it, page compositions and all, and the server's wrapper.
    for (const route of previewRouteFiles('app', { compose: true })) {
      write(repo, route.file, route.content);
    }
    for (const item of contextFiles('app')) write(repo, item.file, item.content);

    const errors = typeErrors(repo, [
      'rough/preview-registry.ts',
      'rough/context-registry.ts',
      'app/rough-preview/[...slug]/page.tsx',
      'app/rough-preview/context/section.tsx'
    ]);
    assert.deepEqual(errors, []);
  });
});
