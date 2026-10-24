# Changelog

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
