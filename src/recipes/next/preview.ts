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
import { listFixtures, listIterations } from '../../repo/iterations.js';
import { ROUGH_DIR } from '../../repo/root.js';

export const PREVIEW_ROUTE = 'rough-preview';
export const REGISTRY_FILE = 'preview-registry.ts';
const MARKER = 'Roughbook preview route';
/** The file every iteration has in this recipe, and the registry loads. */
const ENTRY = 'index.tsx';
/** The file an iteration may hold with its inputs for the preview (the contract, point 2). */
export const FIXTURE = 'preview.json';

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
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import { Ready } from "./ready";
${blocking}
export default async function RoughPreview({ params }: { params: Promise<{ slug: string[] }> }) {
  // Answers requests addressed to this machine only, so a dev server reachable on the network shows nothing from ${ROUGH_DIR}/ (the preview contract, point 5).
  const host = (await headers()).get("host") ?? "";
  if (!/^(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?$/.test(host)) notFound();
  // The bundler drops this branch from production builds, so nothing in ${ROUGH_DIR}/ is ever built for production.
  const registry = process.env.NODE_ENV === "development" ? await import("${up}${ROUGH_DIR}/preview-registry") : null;
  if (!registry) notFound();
  const key = (await params).slug.join("/");
  const load = registry.loaders[key];
  if (!load) notFound();
  const Iteration = (await load()).default as ComponentType<Record<string, unknown>>;
  // An iteration's ${FIXTURE}, when it has one, holds its inputs (the preview contract, point 2).
  const fixture = registry.fixtures[key] ? (await registry.fixtures[key]()).default : {};
  const { Preview } = registry;
  return (
    <>
      <Preview>
        <Iteration {...fixture} />
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
    },
    {
      file: `${dir}/error.tsx`,
      content: `"use client";
// ${MARKER}. Tells Roughbook the iteration failed to render, and why (the preview contract, point 3).
import { useEffect } from "react";

export default function RoughPreviewError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    const id = window.location.pathname.replace(/^\\/${PREVIEW_ROUTE}\\//, "");
    window.parent.postMessage({ roughbook: "error", id, message: error.message || "The iteration failed to render." }, "*");
  }, [error]);
  return <pre style={{ padding: "2rem", whiteSpace: "pre-wrap" }}>{error.message}</pre>;
}
`
    },
    {
      file: `${dir}/not-found.tsx`,
      content: `"use client";
// ${MARKER}. Tells Roughbook there is no iteration at this key (the preview contract, point 3).
import { useEffect } from "react";

export default function RoughPreviewNotFound() {
  useEffect(() => {
    const id = window.location.pathname.replace(/^\\/${PREVIEW_ROUTE}\\//, "");
    window.parent.postMessage({ roughbook: "error", id, message: "No iteration at this key." }, "*");
  }, []);
  return <p style={{ padding: "2rem" }}>No iteration at this key.</p>;
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

export function renderPreviewRegistry(keys: string[], fixtures: string[] = []): string {
  const lines = keys.map(
    key => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(`./${key}/index`)}),`
  );
  const fixtureLines = fixtures.map(
    key => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(`./${key}/${FIXTURE}`)}),`
  );
  return `// Generated by Roughbook from the iterations in this folder. Do not edit.
import type { ComponentType } from "react";

export { default as Preview } from "./preview";

export const loaders: Record<string, () => Promise<{ default: ComponentType }>> = {
${lines.map(line => `${line}\n`).join('')}};

/** Each iteration's ${FIXTURE}, where it has one: its inputs for the preview. */
export const fixtures: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
${fixtureLines.map(line => `${line}\n`).join('')}};
`;
}

/** The registry as the iterations in the repo are now. */
export function currentPreviewRegistry(repo: string): string {
  const keys = listIterations(repo, ENTRY);
  return renderPreviewRegistry(keys, listFixtures(repo, keys, FIXTURE));
}

/** Rewrites rough/preview-registry.ts when the iterations changed. Returns whether it wrote. */
export function writePreviewRegistry(repo: string): boolean {
  const file = path.join(repo, ROUGH_DIR, REGISTRY_FILE);
  const next = currentPreviewRegistry(repo);
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
