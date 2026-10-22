// Vite with React: an extra HTML entry at the repo's root, which Vite serves in development and
// leaves out of its build (vite build bundles index.html alone), so nothing from rough/ ever
// reaches dist/ (the build gate). Three pieces:
//
//   rough-preview.html        the page (development only, gitignored)
//   rough/preview-entry.tsx   its script: one iteration by the key in the address (gitignored)
//   rough/preview.tsx         wraps iterations in the app's providers and styles (committed)
//
// The script finds iterations with import.meta.glob, so there is no registry to keep: Vite
// watches the folder and its hot reload shows a changed iteration on its own.
import fs from 'node:fs';
import path from 'node:path';
import { ROUGH_DIR } from '../../repo/root.js';

export const PAGE = 'rough-preview.html';
export const ENTRY_SCRIPT = 'preview-entry.tsx';
export const ENTRY = 'index.tsx';
export const FIXTURE = 'preview.json';
const MARKER = 'Roughbook preview page';

export const PREVIEW_PAGE = `<!doctype html>
<!-- ${MARKER}. Development only, not committed (see .gitignore). Vite serves it at
     /${PAGE}?key=<page>/<component>/<iteration> and never builds it (vite build bundles
     index.html alone), so nothing from ${ROUGH_DIR}/ reaches dist/. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Roughbook preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${ROUGH_DIR}/${ENTRY_SCRIPT}"></script>
  </body>
</html>
`;

export const PREVIEW_SCRIPT = `// ${MARKER}'s script. Development only, not committed (see .gitignore).
// Renders one iteration from this folder by the key in the address, with its ${FIXTURE} as props,
// inside preview.tsx, and tells the Roughbook studio how it went (rough/CONTRACT.md, point 3).
import { Component, StrictMode, useEffect, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import Preview from "./preview";

type Fixture = Record<string, unknown>;

const iterations = import.meta.glob("./*/*/iteration-*/${ENTRY}");
const fixtures = import.meta.glob("./*/*/iteration-*/${FIXTURE}");
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*\\/[a-z0-9]+(?:-[a-z0-9]+)*\\/iteration-\\d{2,}$/;
const LOOPBACK = /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/;

const params = new URLSearchParams(window.location.search);
const key = params.get("key") ?? "";

function post(message: Record<string, unknown>) {
  window.parent.postMessage({ ...message, id: key }, "*");
}

// The variant the studio asks for in the address (rough/CONTRACT.md, point 2).
const root = document.documentElement;
const scheme = params.get("roughbook-scheme");
if (scheme === "dark") root.classList.add("dark");
if (scheme === "dark" || scheme === "light") root.style.colorScheme = scheme;
const dir = params.get("roughbook-dir");
if (dir === "rtl" || dir === "ltr") root.dir = dir;
const lang = params.get("roughbook-lang")?.replace(/[^A-Za-z0-9-]/g, "");
if (lang) root.lang = lang;
if (params.get("roughbook-text") === "large") root.style.fontSize = "125%";

function Problem({ message }: { message: string }) {
  useEffect(() => post({ roughbook: "error", message }), [message]);
  return <pre style={{ padding: "2rem", whiteSpace: "pre-wrap" }}>{message}</pre>;
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    return error ? <Problem message={error.message || "The iteration failed to render."} /> : this.props.children;
  }
}

/** Posts ready once the iteration is on the page. */
function Ready() {
  useEffect(() => post({ roughbook: "ready" }), []);
  return null;
}

async function main() {
  const app = createRoot(document.getElementById("root")!);
  // Answers this machine only, so a dev server reachable on the network shows nothing from ${ROUGH_DIR}/ (point 5).
  if (!LOOPBACK.test(window.location.hostname)) {
    app.render(<Problem message="The preview answers this machine only." />);
    return;
  }
  const load = KEY.test(key) ? iterations[\`./\${key}/${ENTRY}\`] : undefined;
  if (!load) {
    app.render(<Problem message={\`There is no iteration \${key} in this repo.\`} />);
    return;
  }
  try {
    const fixtureModule = fixtures[\`./\${key}/${FIXTURE}\`];
    const fixture = fixtureModule ? ((await fixtureModule()) as { default: Fixture }).default : {};
    const { default: Iteration } = (await load()) as { default: ComponentType<Fixture> };
    app.render(
      <StrictMode>
        <Boundary>
          <Preview>
            <Iteration {...fixture} />
          </Preview>
          <Ready />
        </Boundary>
      </StrictMode>
    );
  } catch (error) {
    app.render(<Problem message={error instanceof Error ? error.message : "The iteration failed to load."} />);
  }
}

void main();
`;

/** The app's global stylesheets, as create-vite and common layouts name them, the first that exists. */
const STYLESHEETS = [
  'src/index.css',
  'src/main.css',
  'src/styles.css',
  'src/styles/globals.css',
  'src/App.css'
];

/** The wrapper, importing the app's global stylesheet when it has one. */
export function previewWrapper(repo: string): string {
  const sheet = STYLESHEETS.find(file => fs.existsSync(path.join(repo, ...file.split('/'))));
  return `// Wraps every iteration previewed through this app. Add the providers your pages
// need (theme, router, query client), as your main.tsx does around the app.
import type { ReactNode } from "react";
${sheet ? `import "../${sheet}";\n` : ''}
export default function Preview({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
`;
}

export function isOurPreviewFile(text: string | null): boolean {
  return Boolean(text?.includes(MARKER));
}
