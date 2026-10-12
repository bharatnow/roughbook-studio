// Iterations live in the repo's rough/ and render through the repo's own dev server, so they can
// use its components, fonts and tokens. Three pieces make that work:
//
//   <app>/rough-preview/[...slug]/page.tsx   the route (development only, gitignored)
//   rough/preview-registry.ts                 one loader per iteration, generated (gitignored)
//   rough/preview.tsx                         wraps iterations in the app's providers
//
// The route loads the registry only when NODE_ENV is "development", inside a branch the bundler
// removes from production builds, so a broken iteration can never fail the app's build. The
// folder is "rough-preview", not "_rough": Next.js treats folders starting with "_" as private.
// Ported from roughbook src/lib/delivery/preview.ts (v2-local).
import fs from 'node:fs';
import path from 'node:path';
import { ROUGH_DIR } from './root.js';

export const PREVIEW_ROUTE = 'rough-preview';
export const REGISTRY_FILE = 'preview-registry.ts';
const MARKER = 'Roughbook preview route';
export const ITERATION = /^iteration-\d{2,}$/;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where the App Router lives in this repo, or null when it has none. */
export function detectAppDir(repo: string): string | null {
  for (const candidate of ['src/app', 'app']) {
    if (fs.existsSync(path.join(repo, candidate))) return candidate;
  }
  return null;
}

export function previewRouteDir(appDir: string): string {
  return `${appDir}/${PREVIEW_ROUTE}`;
}

/** An iteration's folder, relative to the repo, with forward slashes. */
export function iterationDir(page: string, component: string, iteration: string): string {
  return `${ROUGH_DIR}/${page}/${component}/${iteration}`;
}

export function previewUrl(
  devUrl: string,
  page: string,
  component: string,
  iteration: string
): string {
  return `${devUrl.replace(/\/$/, '')}/${PREVIEW_ROUTE}/${page}/${component}/${iteration}`;
}

/**
 * The route's two files. Imports climb from <app>/rough-preview/[...slug]/ to the repo root.
 *
 * With Cache Components on (Next.js 16's default for new apps), a page that reads `params`
 * outside Suspense is an error on every request, and the dev overlay's badge would show in
 * screenshots. The page then says it may wait for the request (`instant = false`), which keeps
 * real status codes: 404 for a missing iteration and 500 for a broken one, which the screenshot
 * step reads. Without Cache Components, Next.js refuses that line and the whole app fails to
 * compile, so it is written only when the app's config turns them on.
 */
export function previewRouteFiles(
  appDir: string,
  options: { cacheComponents?: boolean } = {}
): { file: string; content: string }[] {
  const up = '../'.repeat(appDir.split('/').length + 2);
  const dir = `${previewRouteDir(appDir)}/[...slug]`;
  const blocking = options.cacheComponents
    ? [
        '',
        '// This app has Cache Components on: the preview waits for the request, so a missing',
        '// iteration still answers 404 and a broken one 500.',
        'export const instant = false;',
        ''
      ].join('\n')
    : '';
  return [
    {
      file: `${dir}/page.tsx`,
      content: `// ${MARKER}. Development only, not committed (see .gitignore).
// Renders one iteration from ${ROUGH_DIR}/ with this app's own layout, styles and components.
// tsconfig excludes this file, so editors check it alone; TypeScript 6 and later then load no @types.
/// <reference types="node" />
import { notFound } from "next/navigation";
import { Ready } from "./ready";
${blocking}
export default async function RoughPreview({ params }: { params: Promise<{ slug: string[] }> }) {
  // The bundler drops this branch from production builds, so nothing in ${ROUGH_DIR}/ is ever built for production.
  const registry = process.env.NODE_ENV === "development" ? await import("${up}${ROUGH_DIR}/preview-registry") : null;
  if (!registry) notFound();
  const key = (await params).slug.join("/");
  const load = registry.loaders[key];
  if (!load) notFound();
  const { default: Iteration } = await load();
  const { Preview } = registry;
  return (
    <>
      <Preview>
        <Iteration />
      </Preview>
      <Ready id={key} />
    </>
  );
}
`
    },
    {
      file: `${dir}/ready.tsx`,
      content: `"use client";
// ${MARKER}. Tells Roughbook the iteration rendered, so it does not fall back to a screenshot.
import { useEffect } from "react";

export function Ready({ id }: { id: string }) {
  useEffect(() => {
    window.parent.postMessage({ roughbook: "ready", id }, "*");
  }, [id]);
  return null;
}
`
    }
  ];
}

export const PREVIEW_WRAPPER = `// Wraps every iteration previewed through this app. Add the providers your
// components need (theme, i18n, query client), as your root layout does.
import type { ReactNode } from "react";

export default function Preview({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
`;

function subdirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

/** Every iteration under rough/<page>/<component>/iteration-NN/ with an index.tsx, as keys. */
export function listIterations(repo: string): string[] {
  const root = path.join(repo, ROUGH_DIR);
  const keys: string[] = [];
  for (const page of subdirs(root).filter(name => SLUG.test(name))) {
    for (const component of subdirs(path.join(root, page)).filter(name => SLUG.test(name))) {
      for (const iteration of subdirs(path.join(root, page, component)).filter(name =>
        ITERATION.test(name)
      )) {
        if (fs.existsSync(path.join(root, page, component, iteration, 'index.tsx'))) {
          keys.push(`${page}/${component}/${iteration}`);
        }
      }
    }
  }
  return keys;
}

export function renderPreviewRegistry(keys: string[]): string {
  const lines = keys.map(
    key => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(`./${key}/index`)}),`
  );
  return `// Generated by Roughbook from the iterations in this folder. Do not edit.
import type { ComponentType } from "react";

export { default as Preview } from "./preview";

export const loaders: Record<string, () => Promise<{ default: ComponentType }>> = {
${lines.map(line => `${line}\n`).join('')}};
`;
}

/** Rewrites rough/preview-registry.ts when the iterations changed. Returns whether it wrote. */
export function writePreviewRegistry(repo: string): boolean {
  const file = path.join(repo, ROUGH_DIR, REGISTRY_FILE);
  const next = renderPreviewRegistry(listIterations(repo));
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current === next) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return true;
}

/** Whether a file is one Roughbook wrote for the preview route, so it may be updated. */
export function isOurPreviewFile(text: string | null): boolean {
  return Boolean(text?.includes(MARKER));
}
