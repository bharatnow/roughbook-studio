# Roughbook studio

Design iterations inside your own repo, with the coding agent and editor you already use. The
studio links a repo to a Roughbook project, writes each iteration's prompt into `rough/`, hands it
to your agent, checks what came back, and lets you review, select and promote from a local UI.
Your code stays on your machine: the server only ever sees ids, review decisions and run metadata.

Runs on Windows, macOS and Linux, with Node 22 or later.

## Install

```bash
npm install -g roughbook
roughbook login
roughbook init       # in your app's repo
roughbook start
```

Installed once, `roughbook` runs as it is, with no version and no `npx`. `npm install -g
roughbook@latest` updates it. `npx roughbook <command>` works without installing, but npx keeps
its own copy and asks before fetching each new one.

## Commands

| Command                                                  | Does                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roughbook login [--server <url>] [--no-browser]`        | Signs this machine in: shows a code to enter at the web's `/link` page and opens it                                                                                                                                                                                                             |
| `roughbook init`                                         | In an app's repo: links it to a project and prepares it, showing every change first                                                                                                                                                                                                             |
| `roughbook start [--port <port>] [--dev-url <url>]`      | Opens the local UI in your browser: the project's components, their iterations live, compare, review, runs with the built-in terminal, Done and promote                                                                                                                                         |
| `roughbook run <page>/<component> …`                     | Starts iterations: `--direction <idea>` (up to eight), `--fork <iteration>`, or `--refine <iteration> --intent <text>`; opens your agent in a terminal, `--headless` runs it unattended, and `--agent cursor` (or `vscode`, `antigravity`, `windsurf`, `other`) opens the prompt in that editor |
| `roughbook done [<run or iteration>]`                    | Finishes a run: checks the iteration, lists files changed outside it, takes screenshots, reports it                                                                                                                                                                                             |
| `roughbook screenshot [<page>/<component>/<iteration>]`  | Takes an iteration's screenshots again (the last finished run's when none is named), as the iteration screen's Take screenshots does                                                                                                                                                            |
| `roughbook review <page>/<component>/<iteration> …`      | `--select`, `--reject <reason> [--why <text>]`, or `--note <observation>`, and `--rating <1-5\|none>` with either or alone; saved on the server, so the next prompt remembers                                                                                                                   |
| `roughbook revert <page>/<component>/<iteration> <file>` | Puts back a file the run changed outside its iteration                                                                                                                                                                                                                                          |
| `roughbook pull <page>/<component>[/<sketch>]`           | Lists the component's web sketches, or brings one into `rough/` as the next local iteration                                                                                                                                                                                                     |
| `roughbook promote <page>/<component>`                   | Hands the selected iteration to your agent to write the real component (`--to <file>`, `--iteration <id>`)                                                                                                                                                                                      |
| `roughbook agents [--default <agent>]`                   | Lists the coding agents and editors found here, their sign-in and whether they can run unattended; sets the default                                                                                                                                                                             |
| `roughbook status`                                       | The sign-in, the analytics answer, the linked project, and what is waiting to be sent                                                                                                                                                                                                           |
| `roughbook telemetry [on\|off]`                          | Shares usage analytics from this studio, or stops; with no argument, says which                                                                                                                                                                                                                 |
| `roughbook logout`                                       | Signs this machine out, here and on the server                                                                                                                                                                                                                                                  |

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
- writes `rough/tsconfig.json`, which extends the app's so editors check iterations with its paths
  and types while the build still skips them;
- tells git what to keep: run state, screenshots, the registry and the route are never committed,
  and `rough/` itself only when you choose not to commit it.

A file the studio did not write is never replaced; it is listed for you to change by hand. Running
`init` again changes nothing, and it adopts a repo prepared by Roughbook v2.

## Local UI

`roughbook start` serves the local UI on `127.0.0.1` (port 4848, or `--port`, which is kept
for next time) and opens it. It shows each component's iterations rendered live by the app's own
dev server (`--dev-url`, `ROUGHBOOK_DEV_URL`, or `http://localhost:3000`), with the last
screenshot when the dev server is not answering; Compare; the review drawer, notes, select, reject
and refine; a run panel for new directions, forks and refinements with the agent of your choice;
each run's Done, its report, and Put it back for files changed outside it; the component's web
sketches, each with Pull; and Deliver. The brief is read-only here, with a link to edit it on the web. While it runs, it keeps
`rough/preview-registry.ts` in step with the iteration folders and sends what waits in the
outbox.

Runs open in the **built-in terminal** in the page (xterm.js on `node-pty`), or in your own
terminal if you choose. A session runs the agent itself, never a shell, and belongs to its run:
closing or reloading the page leaves it running, and joining again replays what it printed. It is
used on Windows, macOS and glibc Linux, where `node-pty` installs and starts; elsewhere, and with
`ROUGHBOOK_TERMINAL=external`, runs open in your own terminal.

The server answers only `127.0.0.1` and `localhost` as its Host, and its API and terminal only
the page it opened: a token made at each start reaches the page in the link's fragment, and every
call carries it. Iterations load the project's and library's asset files from
`http://127.0.0.1:<port>/api/files/…`, which this server fetches from the backend with your
sign-in; prompts name that address, so keep the port.

## Development

```bash
npm install
npm run dev -- --help
```

| Script               | Does                                                     |
| -------------------- | -------------------------------------------------------- |
| `npm run dev -- <…>` | Runs the CLI from source through `tsx`                   |
| `npm test`           | `node --test` over `src/**/*.test.ts`, never the network |
| `npm run type-check` | `tsc --noEmit` for the CLI and the local UI              |
| `npm run lint`       | ESLint, including the studio's own rules (`AGENTS.md`)   |
| `npm run build`      | Compiles to `dist/` and the UI to `dist/ui/`             |
| `npm run build:ui`   | The local UI alone, with Vite                            |

The backend is `roughbook-backend`. The studio talks to `http://localhost:4000` unless
`ROUGHBOOK_SERVER` or `roughbook login --server` says otherwise; anything but this machine must be
https.

## Where things are kept

| What                           | Where                                                |
| ------------------------------ | ---------------------------------------------------- |
| Your sign-in (install token)   | The user config folder (below), readable only by you |
| The repo's link to its project | `rough/roughbook.json`, committed with `rough/`      |
| The default agent, local port  | `settings.json` in the user config folder            |
| Your analytics answer          | `settings.json` too; the backend keeps it as well    |
| Analytics events not yet sent  | `events.json` in the user config folder              |
| Runs, snapshots, the outbox    | `rough/.roughbook/`, never committed                 |
| Screenshots                    | `rough/.screenshots/`, never committed               |

The user config folder is `%APPDATA%\Roughbook` on Windows, `~/Library/Application Support/Roughbook`
on macOS, and `$XDG_CONFIG_HOME/roughbook` (or `~/.config/roughbook`) on Linux.
`ROUGHBOOK_CONFIG_DIR` overrides it.

Usage analytics are opt-in: `roughbook login` asks, and `roughbook telemetry on` or `off` changes
the answer. With a yes, the backend records what this studio asks it to do (runs, ratings,
selections, pulls, promotions) as ids, counts and codes, and the studio sends the two events only it
sees: that the local UI started, with the agents it found, and a failure's error code. Never code,
prompts, names, paths or anything you type; the web's `/analytics` page lists every event.
`ROUGHBOOK_TELEMETRY=off` turns it all off on this machine, whatever the answer.

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

Claude Code and Codex are supported, found without any setup: on PATH, then where installers put
them when PATH misses it (the native installers' `~/.local/bin`, npm's global folder, WinGet,
Scoop, Homebrew, Volta, Bun), then, for Claude Code, its older `~/.claude/local` install and the
copy the Claude desktop app keeps, including the Windows package's own folder.
`ROUGHBOOK_CLAUDE_BIN` or `ROUGHBOOK_CODEX_BIN` names one anywhere else.

Cursor, VS Code (with Copilot), Antigravity and Windsurf run iterations with their own agents, with
you driving: `run --agent cursor` (or the local UI's Agent list) opens the repo and the run's prompt
in the editor, through its own launcher (`cursor`, `code`, `antigravity`, `windsurf`; on Windows the
editor's exe and `cli.js` that its `.cmd` launcher runs, with no shell), and puts the one-line
instruction on the clipboard for a new chat with the editor's agent. Each is found on PATH, in its
install folder (Windows), app bundle (macOS) or package folder (Linux), or through
`ROUGHBOOK_<EDITOR>_BIN`. `--agent other` opens the prompt with the OS's default app instead, and the
default app takes over when an editor cannot start. Editors never run unattended; Done, the checks
and the snapshot are the same as for a terminal agent. With no default set, `run` uses the first
terminal agent found, then the first editor.

A terminal agent's run opens it in a terminal: Windows Terminal or a
console window on Windows, Terminal or iTerm on macOS (`ROUGHBOOK_TERMINAL=iterm`), and
`$TERMINAL`, `x-terminal-emulator`, GNOME Terminal, Konsole or xterm on Linux; otherwise it prints
the command to paste. `--headless` runs the agent unattended, only with your own API key
(`ANTHROPIC_API_KEY` for Claude Code, `CODEX_API_KEY` or `OPENAI_API_KEY` for Codex), confined
to the run's folder, and reports its token counts. `done` takes desktop and phone screenshots
through the app's dev server (`--dev-url`, `ROUGHBOOK_DEV_URL`, or `http://localhost:3000`) with
Chrome, Chromium or Edge (`ROUGHBOOK_BROWSER` names another), into `rough/.screenshots/`. It asks
the preview route first and takes none, saying why, when nothing answers or the app answers with a
login (such as a pre-launch password), a redirect elsewhere, a 404 or an error; `roughbook
screenshot` takes them once that is fixed. What the studio itself writes while a run is open,
`init`'s prep, a pull or a promotion, is never counted as the run's write outside its folder.

## Pull

`pull` brings a web sketch into the repo as the starting point of a local iteration: a fork whose
parent is the sketch. The backend allocates the next number and sends the sketch's files; the
studio checks every path before writing (its own folder only, known file types, a few folders
deep), never writes over an iteration, points the sketch's `/api/files/…` URLs at the local server,
and regenerates the preview registry. The iteration is generated already, so it can be reviewed,
refined (`run --refine`) and promoted like any other. Sketches use React, Tailwind and a few allowed
packages (motion, lucide-react, clsx, three, model-viewer); `pull` names any the app's
`package.json` does not list, with the command that adds them. A run going at the time does not
count the pulled files as its own writes. Nothing local goes up.

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
                review decisions, sketch pulls, and promotion
  repo/         the repo root, repo prep and the preview route, the link file, scratch apps
  fs/           whole-file JSON writes and the lock the CLI and local server share
  server/       the local server: its API, the built-in terminal's sessions, who may ask
  tests/
ui/             the local UI: Vite, React and @roughbook/ui, built into dist/ui
```
