# Roughbook studio

The studio is a Node + TypeScript CLI, with a local UI and an MCP server, that runs inside a
designer's own repo on Windows, macOS or Linux. It hands each prompt to the designer's own coding
agent or editor, checks what the agent wrote, and keeps that code on the machine. The plan it
follows is `ROUGHBOOK-SPLIT-PLAN.md` in the `roughbook` repo.

Rules for every change:

1. **No studio request carries code or file paths.** Request bodies hold ids, enums, numbers and
   short text the designer typed (review notes). The outbound-request test fails on any body
   containing text from a `rough/` file.
2. **Only `src/cli.ts` reads `process.cwd()`.** It finds the repo root once and passes it down;
   everything else takes `repoRoot` as an argument. ESLint enforces it.
3. **No platform-specific code outside `src/launch/` and `src/screenshot/`** (and
   `src/config/userDir.ts`, which knows where each OS keeps settings). Spawn processes with
   argument arrays, never shell strings; build paths with `node:path`; write files with `\n` line
   endings. ESLint enforces the first two.
4. **Pure JavaScript dependencies only,** so `npm install` needs no build tools on any OS. Add
   one only with a reason in the plan.
5. **The studio never writes outside the repo it was started in**, except its own sign-in in the
   user config folder. In the repo it writes inside `rough/`, the preview route, and a
   promotion's target, and shows every other change (`init`) before making it.
6. **State files are written whole** (`writeJsonAtomic`) and, where the CLI and the local server
   can both write them, under `withLock`.
7. **Tests never reach the network.** API calls go through `fakeFetch`, which records every
   request.

Checks before a commit: `npm run type-check`, `npm run lint`, `npm test`. CI runs them on Windows,
macOS and Linux with Node 22 and 24.
