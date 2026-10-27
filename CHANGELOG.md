# Changelog

## 0.3.17 (2026-10-27)

Roughbook on the UI your app already has. Until now the studio designed new pages and components;
this release lets it work on the ones an app ships today. The studio maps the app's pages and
components, shows them on the canvas as they are now, and lets you fork them, compare them with
what ships, see an iteration in its real page, rearrange a page's sections, and write the chosen
design back into the app's own files. Only names and pictures reach Roughbook's service, never your
code or paths. It needs `@roughbook/ui` 0.4.3 and Node.js 22 or later.

### New

- **`roughbook map`** finds the app's pages, the sections each one shows in order, the parts every
  page shares and the small atoms, and writes them to `rough/map.md`. It reads what the stack
  declares (Next.js, Vite with React, Nuxt, Expo, Laravel with Blade, WordPress themes and Shopify
  themes); `--agent` has your agent fill in what a stack does not declare. `roughbook init` maps an
  app that already has UI.
- **`roughbook adopt <page>[/<component>]`** (or `--all`) makes the map's pages and components
  project records, by name only. Each adopted component gets a baseline, `iteration-00`, marked
  "In the app": a pointer to the real file, so it always shows the code as it is now.
- **Pictures for the team and client reviewers.** The studio uploads pictures of every iteration it
  makes and of every adopted page, so people on the web see what they review. A project setting
  turns them off and deletes what was stored.
- **Fork and refine what the app has.** A fork of a baseline starts from a copy of the component's
  own files and keeps the original beside it, so you can compare the iteration with what ships.
- **`roughbook promote` writes back into the original file.** It replaces the component in place,
  merges when the app changed since the fork (keeping both changes), and writes nothing when the
  two changes conflict, saying where. It then runs the app's build and checks and shows the diff.
  `--branch [<name>]` puts the change on a new branch and commits only its files there, on your
  yes. `roughbook revert` puts a file back.
- **In its page.** An iteration of an adopted component can be seen in its real page, with the
  page's real data, beside the component alone: on Next.js, Vite with React, Nuxt, Expo's web
  target, Laravel and WordPress. A development-only switch does it, and `doctor` proves none of it
  reaches a production build. With Pick on, a click on the page selects its section.
- **Page compositions.** Reorder, add, remove or replace a page's sections in the composition
  editor, or with `roughbook compose`; `roughbook section` makes a new section for the page. On
  Next.js the composition is previewed as one page; elsewhere its sections show one under another.
  Promoting a composition rewrites only the page's own file and writes each new section beside the
  page's other sections.
- **The map follows the app** while `roughbook start` runs: a renamed or moved component keeps its
  cards and iterations, a removed one is marked "Gone from the app" with its work kept, and a
  section new to an adopted page is adopted by itself, in the app's order.
- **Large apps.** Pictures are taken as cards come on screen, visible ones first, and kept while
  the source is unchanged; the "In the app" group can be filtered by page, kind, adoption and gone,
  and searched by name.
- **`doctor`'s map checks**: the map's pages answer, its sections render alone, its screenshots come
  out clean, and an iteration shows in its page while production holds none of it.

### Changed

- **The recipes' setups have new versions** (Next.js 8, Vite 5, Nuxt 3, Expo 5, Laravel 2,
  WordPress 4). `roughbook setup --upgrade` brings a repo up.
- **Next.js: Turbopack's development cache is off in repos with the in-page switch.** A dev server
  restarted onto its old cache could answer "Lazily compiled dynamic import … was not activated"
  for a preview or a swap. The frame and `doctor` now name that error and say to restart.

### Fixed

- A local `next build` no longer fails its type check when an adopted component needs props.
- A page with an adopted client component no longer fails in development because of an iteration
  that only runs on the server.
- The web's order of an adopted page follows the app's.

### Compatibility

- Needs the updated Roughbook service. A studio still on 0.3.16 keeps working against it, but
  update the whole team together: on a project a teammate adopted from the app, 0.3.16 cannot fork
  or promote the app's own components.
- A repo set up with 0.3.16 keeps working; run `roughbook setup --upgrade`, then `roughbook map`, to
  work on its existing UI.

## 0.3.16 (2026-10-24)

Roughbook on any stack, web or mobile. Until now the studio worked in Next.js repos only. This
release makes the core stack-free: the studio detects your stack, your coding agent builds the
preview setup once, and every run writes iterations in your stack's own code. It needs
`@roughbook/ui` 0.4.2 and Node.js 22 or later, as before.

### New

- **Any stack.** `roughbook init` detects the stack and prepares the repo from a tested recipe where
  there is one: Next.js, Vite with React, WordPress themes, Laravel with Blade, Nuxt, Expo and
  Jetpack Compose. Recipes for Shopify themes, Flutter and SwiftUI are included but not yet proven
  end to end. For any other stack, `roughbook setup` has your agent build the preview, and
  `roughbook doctor` proves it on your repo.
- **`roughbook doctor`** checks the repo's preview setup against the preview contract
  (`rough/CONTRACT.md`) and says what to fix: the app answers, an iteration renders and reports
  ready, a failed or missing one reports an error, screenshots come out clean, changes show without
  a restart, nothing reaches a production build, and whether the preview can be reached from the
  network.
  `--json` and `--report` for CI and support; `--speed` and `--snapshots` for the speed budgets and
  snapshot stacks.
- **`roughbook setup`** has your agent build the preview setup; `--fix` brings doctor's failed
  checks back to it, `--apply` applies a recipe's templates without an agent, and `--upgrade`
  brings a recipe's setup up to the recipe's current version.
- **`roughbook new`** starts an app of a recipe's stack in an empty folder, then links and prepares
  it.
- **`roughbook uninstall`** removes the preview setup from the app, and nothing else; `rough/`
  stays.
- **`rough/environment.md`** records the repo's environment: its stack, entry file, sources, start
  and build commands, preview address, viewports, gate and timeouts. Every command reads it.
- **Three preview modes.** Live, through the app's own dev server. Standalone, where the studio
  serves an HTML or React iteration itself, for sites with no dev server of their own. Snapshot,
  for mobile stacks, from the stack's own snapshot tests.
- **The preview frame** in the local UI: loading, ready and error states, every viewport, variants
  (dark, right to left, another language, larger text), and a reload when an iteration changes.
  `roughbook start` starts the app with its approved start command when nothing is answering.
- **Web sketches into any stack.** `roughbook pull` copies a sketch where the stack can take its
  code as it is, and otherwise has your agent port it, keeping its layout, type, colour, copy and
  motion. `roughbook promote` writes into any template or source file your stack uses.
- **Checks for every family**: markup checks read Blade, Vue, Liquid, PHP and HTML, and native
  stacks (Flutter, SwiftUI, Compose) get checks written for them.

### Changed

- **Commands from `rough/environment.md` run only after you approve them.** With no terminal
  attached (CI, an agent's shell, an IDE task) nothing is approved unless you pass `--yes`.
- **`roughbook start` watches `rough/` only**, so a large repo no longer exhausts file watches on
  Linux.
- **Ctrl+C stops what a command started**, the servers doctor starts included.
- **The headless browser's profiles are cleaned up**, instead of piling up in the temp folder.

### Compatibility

- A repo linked with 0.3.15 keeps working: with no `rough/environment.md` it is read as a Next.js
  repo, as before. Run `roughbook init` again to get the new setup.
- A studio still on 0.3.15 keeps working against the service, with Next.js wording in its local
  prompts.
- New runtime dependency: `esbuild`, for the standalone preview.
