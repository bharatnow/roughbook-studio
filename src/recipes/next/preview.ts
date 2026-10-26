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
import { COMPOSE_PARAM, MARKER_ELEMENT, PICK_PARAM, SECTION_ATTRIBUTE } from '../context.js';

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
 * A page's composition on the route (B6 of ROUGHBOOK-BROWNFIELD-PLAN.md, decisions 46 and 54), for
 * a mapped repo: at the page's key with ?${COMPOSE_PARAM}=<component>:<iteration>,…, each section
 * with its fixture, in order, inside one Preview, each in the in-page view's marker so Pick works.
 */
const COMPOSITION_BRANCH = `  const search = await searchParams;
  const composed = search["${COMPOSE_PARAM}"];
  if (typeof composed === "string") {
    const page = (await params).slug.join("/");
    const sections = await composition(registry, page, composed);
    const variant = variantOf(search);
    const { Preview } = registry;
    return (
      <div
        data-roughbook-variant
        dir={variant.dir}
        lang={variant.lang}
        className={variant.scheme === "dark" ? "dark" : undefined}
        style={{ colorScheme: variant.scheme, fontSize: variant.text === "large" ? "125%" : undefined }}
      >
        <Preview>
          {sections.map((section) =>
            createElement(
              "${MARKER_ELEMENT}",
              { key: section.key, "${SECTION_ATTRIBUTE}": section.marker, style: { display: "contents" } },
              createElement(section.Section, section.fixture),
            ),
          )}
        </Preview>
        <Pick />
        <Ready id={\`\${page}/composition\`} />
      </div>
    );
  }
`;

const COMPOSITION_FUNCTION = `
type Registry = {
  loaders: Record<string, () => Promise<{ default: ComponentType }>>;
  fixtures: Record<string, () => Promise<{ default: Record<string, unknown> }>>;
};

/** A page's composition: each section's iteration and fixture, in order; a section the registry lacks is a 404. */
async function composition(registry: Registry, page: string, composed: string) {
  const sections = composed.split(",").filter(Boolean);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page) || !sections.length || sections.length > 30) notFound();
  return Promise.all(
    sections.map(async (section) => {
      const [component = "", iteration = ""] = section.split(":");
      const key = \`\${page}/\${component}/\${iteration}\`;
      const load = registry.loaders[key];
      if (!load) notFound();
      return {
        key,
        marker: \`\${page}/\${component}\`,
        Section: (await load()).default as ComponentType<Record<string, unknown>>,
        fixture: registry.fixtures[key] ? (await registry.fixtures[key]()).default : {},
      };
    }),
  );
}
`;

const PICK_FILE = `"use client";
// ${MARKER}. Pick on a page's composition: with ?${PICK_PARAM}=1, a click posts { roughbook: "section", key }
// to the frame, naming the section it fell in, instead of following the page.
import { useEffect } from "react";

export function Pick() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("${PICK_PARAM}") !== "1") return;
    const pick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const section = event.target instanceof Element ? event.target.closest("[${SECTION_ATTRIBUTE}]") : null;
      const key = section?.getAttribute("${SECTION_ATTRIBUTE}");
      if (key) window.parent.postMessage({ roughbook: "section", key }, "*");
    };
    document.addEventListener("click", pick, true);
    return () => document.removeEventListener("click", pick, true);
  }, []);
  return null;
}
`;

/** The id a failure posts: the key in the path, `<page>/composition` for a page's composition. */
const COMPOSED_ID = `window.location.pathname.replace(/^\\/${PREVIEW_ROUTE}\\//, "") + (new URLSearchParams(window.location.search).has("${COMPOSE_PARAM}") ? "/composition" : "")`;

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
  options: { cacheComponents?: boolean; compose?: boolean } = {}
): { file: string; content: string }[] {
  const up = '../'.repeat(appDir.split('/').length + 2);
  // A repo that maps nothing keeps the route it had before B6.
  const compose = options.compose === true;
  const failedId = compose
    ? COMPOSED_ID
    : `window.location.pathname.replace(/^\\/${PREVIEW_ROUTE}\\//, "")`;
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
${compose ? 'import { createElement, type ComponentType } from "react";\nimport { Pick } from "./pick";' : 'import type { ComponentType } from "react";'}
import { Ready } from "./ready";
${blocking}
export default async function RoughPreview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Search>;
}) {
  // Answers requests addressed to this machine only, so a dev server reachable on the network shows nothing from ${ROUGH_DIR}/ (the preview contract, point 5).
  const host = (await headers()).get("host") ?? "";
  if (!/^(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?$/.test(host)) notFound();
  // The bundler drops this branch from production builds, so nothing in ${ROUGH_DIR}/ is ever built for production.
  const registry = process.env.NODE_ENV === "development" ? await import("${up}${ROUGH_DIR}/preview-registry") : null;
  if (!registry) notFound();
${compose ? COMPOSITION_BRANCH : ''}  const key = (await params).slug.join("/");
  const load = registry.loaders[key];
  if (!load) notFound();
  const Iteration = (await load()).default as ComponentType<Record<string, unknown>>;
  // An iteration's ${FIXTURE}, when it has one, holds its inputs (the preview contract, point 2).
  const fixture = registry.fixtures[key] ? (await registry.fixtures[key]()).default : {};
  const { Preview } = registry;
  // The variant asked for: the dark class for apps that switch by class, color-scheme for the rest, and the text direction and language on the root.
  const variant = variantOf(${compose ? 'search' : 'await searchParams'});
  return (
    <div
      data-roughbook-variant
      dir={variant.dir}
      lang={variant.lang}
      className={variant.scheme === "dark" ? "dark" : undefined}
      style={{ colorScheme: variant.scheme, fontSize: variant.text === "large" ? "125%" : undefined }}
    >
      <Preview>
        <Iteration {...fixture} />
      </Preview>
      <Ready id={key} />
    </div>
  );
}

type Search = Record<string, string | string[] | undefined>;
${compose ? COMPOSITION_FUNCTION : ''}
/** The variant the studio asks for in the address (the preview contract, point 2), as attributes on the iteration's root. */
function variantOf(search: Search) {
  const one = (name: string) => {
    const value = search[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const scheme = one("roughbook-scheme") === "dark" ? "dark" : "light";
  const dir = one("roughbook-dir") === "rtl" ? "rtl" : undefined;
  const lang = one("roughbook-lang")?.replace(/[^A-Za-z0-9-]/g, "") || undefined;
  const text = one("roughbook-text") === "large" ? "large" : undefined;
  return { scheme, dir, lang, text };
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
    const id = ${failedId};
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
    const id = ${failedId};
    window.parent.postMessage({ roughbook: "error", id, message: "No iteration at this key." }, "*");
  }, []);
  return <p style={{ padding: "2rem" }}>No iteration at this key.</p>;
}
`
    },
    ...(compose ? [{ file: `${dir}/pick.tsx`, content: PICK_FILE }] : [])
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
