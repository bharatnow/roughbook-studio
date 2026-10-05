# Roughbook studio

Design iterations inside your own repo, with the coding agent and editor you already use. The
studio links a repo to a Roughbook project, writes each iteration's prompt into `rough/`, hands it
to your agent, checks what came back, and lets you review, select and promote from a local UI.
Your code stays on your machine: the server only ever sees ids, review decisions and run metadata.

Runs on Windows, macOS and Linux, with Node 22 or later.

## Commands

| Command                                                  | Does                                                                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `roughbook login [--server <url>] [--no-browser]`        | Signs this machine in: shows a code to enter at the web's `/link` page and opens it                                                                                                        |
| `roughbook init`                                         | In an app's repo: links it to a project and prepares it, showing every change first                                                                                                        |
| `roughbook run <page>/<component> …`                     | Starts iterations: `--direction <idea>` (up to eight), `--fork <iteration>`, or `--refine <iteration> --intent <text>`; opens your agent in a terminal, or `--headless` runs it unattended |
| `roughbook done [<run or iteration>]`                    | Finishes a run: checks the iteration, lists files changed outside it, takes screenshots, reports it                                                                                        |
| `roughbook review <page>/<component>/<iteration> …`      | `--select`, `--reject <reason> [--why <text>]`, or `--note <observation>`; saved on the server, so the next prompt remembers                                                               |
| `roughbook revert <page>/<component>/<iteration> <file>` | Puts back a file the run changed outside its iteration                                                                                                                                     |
| `roughbook promote <page>/<component>`                   | Hands the selected iteration to your agent to write the real component (`--to <file>`, `--iteration <id>`)                                                                                 |
| `roughbook agents [--default <agent>]`                   | Lists the coding agents found here, their sign-in and whether they can run unattended; sets the default                                                                                    |
| `roughbook status`                                       | The sign-in, the linked project, and what is waiting to be sent                                                                                                                            |
| `roughbook logout`                                       | Signs this machine out, here and on the server                                                                                                                                             |

`init` asks which project the repo works on (or `--project <slug>`, `--new <name>`, with
`--org <id>` when two organizations share a slug) and whether to commit `rough/` (`--commit`, the
default, or `--no-commit`); `--yes` applies without asking. `--scratch <dir>` first makes a minimal
Next.js 16 app with Tailwind v4 and a git repository there. It then:

- writes `rough/` with `README.md`, `AGENTS.md` (the iteration rules every agent reads),
  `CLAUDE.md` (pointing at them) and `roughbook.json` (the organization and project, no paths);
- adds the development-only preview route under the App Router, `rough/preview.tsx` for the app's
  providers, and the generated `rough/preview-registry.ts`;
- excludes `rough/` and the route from TypeScript and ESLint, and adds an `@source` line so
  Tailwind v4 sees the classes in `rough/`;
- tells git what to keep: run state, screenshots, the registry and the route are never committed,
  and `rough/` itself only when you choose not to commit it.

A file the studio did not write is never replaced; it is listed for you to change by hand. Running
`init` again changes nothing, and it adopts a repo prepared by Roughbook v2.

## Development

```bash
npm install
npm run dev -- --help
```

| Script               | Does                                                     |
| -------------------- | -------------------------------------------------------- |
| `npm run dev -- <…>` | Runs the CLI from source through `tsx`                   |
| `npm test`           | `node --test` over `src/**/*.test.ts`, never the network |
| `npm run type-check` | `tsc --noEmit`                                           |
| `npm run lint`       | ESLint, including the studio's own rules (`AGENTS.md`)   |
| `npm run build`      | Compiles to `dist/`; `node dist/cli.js` is the CLI       |

The backend is `roughbook-backend`. The studio talks to `http://localhost:4000` unless
`ROUGHBOOK_SERVER` or `roughbook login --server` says otherwise; anything but this machine must be
https.

## Where things are kept

| What                           | Where                                                |
| ------------------------------ | ---------------------------------------------------- |
| Your sign-in (install token)   | The user config folder (below), readable only by you |
| The repo's link to its project | `rough/roughbook.json`, committed with `rough/`      |
| The default agent              | `settings.json` in the user config folder            |
| Runs, snapshots, the outbox    | `rough/.roughbook/`, never committed                 |
| Screenshots                    | `rough/.screenshots/`, never committed               |

The user config folder is `%APPDATA%\Roughbook` on Windows, `~/Library/Application Support/Roughbook`
on macOS, and `$XDG_CONFIG_HOME/roughbook` (or `~/.config/roughbook`) on Linux.
`ROUGHBOOK_CONFIG_DIR` overrides it.

## Runs

A run starts with the backend: it allocates the iteration and compiles the prompt. The studio then
records every file in the repo by hash (copying aside any with uncommitted changes), writes the
iteration's folder (a placeholder, or a copy of the parent for a fork or refinement) and the prompt
in `rough/<page>/<component>/prompts/<run>.md`, and hands the agent one line:
`Follow the instructions in <prompt file>`. At Done it applies the backend's checks (the entry
file exists and is not the placeholder, a fork changed from its parent, the approved headline
appears) and its own (nothing outside `rough/` imports from it), lists every file changed outside
the run's folder, and sends the outcome, warning codes and counts. Any such file can be put back:
a new one is removed, an uncommitted one comes back from its copy, a committed one from git.

Reviews and run results are written to the outbox first and sent in order when the backend can be
reached, so nothing is lost offline; the server applies one sent twice once. `run` sends what is
waiting before it asks for a prompt, so a rejection always reaches the next one.

Claude Code and Codex are supported. A run opens the agent in a terminal: Windows Terminal or a
console window on Windows, Terminal or iTerm on macOS (`ROUGHBOOK_TERMINAL=iterm`), and
`$TERMINAL`, `x-terminal-emulator`, GNOME Terminal, Konsole or xterm on Linux; otherwise it prints
the command to paste. `--headless` runs the agent unattended, only with your own API key
(`ANTHROPIC_API_KEY` for Claude Code, `CODEX_API_KEY` or `OPENAI_API_KEY` for Codex), confined
to the run's folder, and reports its token counts. `done` takes desktop and phone screenshots
through the app's dev server (`--dev-url`, `ROUGHBOOK_DEV_URL`, or `http://localhost:3000`) with
Chrome, Chromium or Edge (`ROUGHBOOK_BROWSER` names another), into `rough/.screenshots/`.

## Promote

`promote` takes the component's selected iteration (or `--iteration`). The backend writes the
prompt from the brief; the studio copies the project and library assets the iteration uses into
`public/rough/<page>/<component>/` (beside the app's `package.json`, or `--public <folder>`), the
approved copy to `rough/<page>/<component>/copy.md`, fills in the component file
(`src/components/<Name>.tsx` by default, or `--to <file>`), and opens your agent with the prompt.
The server never hears the file's path. An existing file is never overwritten, and nothing is
committed: you review the diff.

## Layout

```text
src/
  cli.ts        the only process.cwd(); finds the repo root; runs a command
  commands/     one file per command, and the registry
  api/          the typed client for /studio, its errors, and the outbox
  config/       sign-in, server address, the user config folder
  agents/       one adapter per coding agent: finding it, terminal sessions, unattended runs
  launch/       everything that differs by OS: terminals, opening a browser, naming the OS
  screenshot/   headless Chrome, Chromium or Edge, at desktop and phone widths
  runs/         local runs: slots and prompt files, the checks, snapshots and revert, the watcher,
                review decisions, and promotion
  repo/         the repo root, repo prep and the preview route, the link file, scratch apps
  fs/           whole-file JSON writes and the lock the CLI and local server share
  tests/
```
