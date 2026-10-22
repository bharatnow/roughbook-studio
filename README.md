| `roughbook doctor [--json] [--report] [--skip-build] [--yes]` | Checks this repo's preview setup against the contract (below) and says what to fix; `--json` for a team's CI, `--report` names the redacted bundle it writes for a support ticket, `--skip-build` leaves the production build out and records the repo as unverified, `--yes` approves the environment's commands on this machine |
| `roughbook setup [--fix \| --apply \| --upgrade]` | Has your agent build this repo's preview setup in an interactive session (any stack); `--fix` sends doctor's failures back to it, `--apply` writes the templates in `rough/setup/` into place without an agent, `--upgrade` rewrites a recipe's setup |
| `roughbook uninstall` | Removes the preview setup from the app, exactly the files `rough/environment.md` lists and a recipe's own, and nothing else; `rough/` stays |

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

| Command                                                  | Does                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roughbook login [--server <url>] [--no-browser]`        | Signs this machine in: shows a code to enter at the web's `/link` page and opens it                                                                                                                                                                                                                                                                                 |
| `roughbook init`                                         | In an app's repo: links it to a project and prepares it, showing every change first                                                                                                                                                                                                                                                                                 |
| `roughbook start [--port <port>] [--dev-url <url>]`      | Opens the local UI in your browser: the project's components, their iterations live, compare, review, runs with the built-in terminal, Done and promote; starts the app with the environment's approved start command unless something answers at its address (`--no-app` leaves it to you)                                                                         |
| `roughbook run <page>/<component> …`                     | Starts iterations: `--direction <idea>` (up to eight), `--fork <iteration>`, or `--refine <iteration> --intent <text>`; opens your agent in a terminal (`--agent claude-code`, `codex`, `antigravity-cli` or `cursor-cli`), `--headless` runs it unattended, and `--agent cursor` (or `vscode`, `antigravity`, `windsurf`, `other`) opens the prompt in that editor |
| `roughbook done [<run or iteration>]`                    | Finishes a run: checks the iteration, lists files changed outside it and asks whether they were yours (`--mine <path>` names them), takes screenshots, reports it                                                                                                                                                                                                   |
| `roughbook screenshot [<page>/<component>/<iteration>]`  | Takes an iteration's screenshots again (the last finished run's when none is named), as the iteration screen's Take screenshots does                                                                                                                                                                                                                                |
| `roughbook review <page>/<component>/<iteration> …`      | `--select`, `--reject <reason> [--why <text>]`, or `--note <observation>`, and `--rating <1-5\|none>` with either or alone; saved on the server, so the next prompt remembers                                                                                                                                                                                       |
| `roughbook revert <page>/<component>/<iteration> <file>` | Puts back a file the run changed outside its iteration                                                                                                                                                                                                                                                                                                              |
| `roughbook pull <page>/<component>[/<sketch>]`           | Lists the component's web sketches, or brings one into `rough/` as the next local iteration                                                                                                                                                                                                                                                                         |
| `roughbook promote <page>/<component>`                   | Hands the selected iteration to your agent to write the real component (`--to <file>`, `--iteration <id>`)                                                                                                                                                                                                                                                          |
| `roughbook agents [--default <agent>]`                   | Lists the coding agents and editors found here, their sign-in and whether they can run unattended; sets the default                                                                                                                                                                                                                                                 |
| `roughbook mcp install [<editor>…]`                      | Lets your editors' and agents' own agents find, check and finish runs themselves: adds `roughbook mcp`, the MCP server, to each one found here, or to those named                                                                                                                                                                                                   |
| `roughbook status`                                       | The sign-in, the analytics answer, the linked project, and what is waiting to be sent                                                                                                                                                                                                                                                                               |
| `roughbook telemetry [on\|off]`                          | Shares usage analytics from this studio, or stops; with no argument, says which                                                                                                                                                                                                                                                                                     |
| `roughbook logout`                                       | Signs this machine out, here and on the server                                                                                                                                                                                                                                                                                                                      |

`init` works in any repo with git, package.json or not. It first reads the repo's marker files and
says what it found: the stack as short tokens (`laravel-13`, `blade`, `php-8`; `next-16`,
`react-19`), the family of checks that goes with it, the package manager, a container setup and
the repo's own agent rule files. Those tokens and the family go to the server with the link, and
nothing else about the repo. It asks which project the repo works on, by its number, name or slug,
or `n` for a new one, whose name it shows back before creating it (or `--project <slug>`,
`--new <name>`, with `--org <id>` when two organizations share a slug) and whether to commit
`rough/` (`--commit`, the default, or `--no-commit`); `--yes` applies without asking. `--scratch
<dir>` first makes a minimal Next.js 16 app with Tailwind v4 and a git repository there. It then:

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

The preview route above is the Next.js recipe's. When no recipe fits the stack, `init` writes the
workspace alone and offers the **setup run** (`roughbook setup`): an interactive session of your
agent that reads the repo, writes `rough/environment.md` and the templates in `rough/setup/`, builds
the preview setup in the repo's own stack and a sample iteration for `doctor`, and may run the
app's commands; it never runs unattended. When it says the setup is ready, start the app and run
`roughbook doctor`; `roughbook setup --fix` takes its findings back to the agent. On a teammate's
clone, `init` finds `rough/environment.md`, shows the templates it is about to apply and the
commands it is about to approve, applies and approves them, and runs `doctor` when the app answers.

## The environment

`rough/environment.md` is the repo's environment: a header between `---` lines the studio reads,
then prose for agents, written by the setup run (or implied by a recipe), reviewed by you and
committed. The header is `key: value` lines and `key:` with `- item` lines. Its fields: `contract`
(1), `recipe` (`next`, `expo`, `flutter`, or `none` when your agent built the setup), `stack` and `family`, `mode`
(`live`, `snapshot` or `standalone`), `entry` (the file every iteration has), `sources` and
`code` (extensions the checks and the import check read), `placement`, `wrapper`, `runtime`
(`local`, or `container @ <url>`), `shell`, `start` (`<command> @ <url>`, or the address alone),
`preview` (`/path/{key}`), `snapshot` (the command that renders keys to images, below) and
`device` (the one that opens a key on a simulator or device, `{key}` in it), `viewports`
(`name WxH [mobile]`), `variants` (`light`, `dark`, a
language tag such as `en` or `ar`, `large-text`, or a word of the setup's own, which reach the
preview as `roughbook-scheme`, `roughbook-dir`, `roughbook-lang`, `roughbook-text` and
`roughbook-variant` query parameters), `reload` (`app` when the stack reloads a changed iteration
itself, `studio` when the frame reloads it on a change), `stylesheets` and `public` (standalone
mode, below), `ignore`, `overlays`,
`fixture`, `build` and `buildOutput`, `gate` (`build`, `runtime` or `both`), `production`
(`<command> @ <url>`), `checks`, `timeoutStart`, `timeoutPreview` and `timeoutBuild`, `promote` and
`promoteExtensions`, `assets` and `assetsCopy`, `copy` (`inline`, or `localized <file>`), `terms`
(`page: view`, `component: partial`), `workshop`, `setupFiles` and `devDependencies`. A command
differs on Windows through its `…Windows` twin (`shellWindows`, `startWindows`, `snapshotWindows`,
`deviceWindows`, `buildWindows`, `productionWindows`, `checksWindows`). With `recipe: none`,
`entry`, `sources` and `gate` are required, with `start` and `preview` for a live preview and
`snapshot` in snapshot mode. A header the studio cannot read is
refused with the field named, and nothing in the prose is ever interpreted.

Every command the environment names runs in the shell it declares (`none` starts the program by
name, as before; `bash`, `sh`, `zsh`, `powershell`, `pwsh` or `cmd` are started by name with the
line as their one command), never the machine's default shell, one at a time per repo, and only
after you have approved it on this machine: `init`, `setup --apply` and `doctor` show each command
with its shell and ask, and keep the approval by its hash in `rough/.roughbook/approvals.json`, so
a command changed by a commit is asked again and a committed file never runs code on a teammate's
machine unseen.

`setupFiles` lists every file the setup adds or changes outside `rough/`, each with its template in
`rough/setup/`: a whole file at `rough/setup/<path>`, or lines added to a file the app already has
as `<path> (snippet)` with the lines at `rough/setup/<path>.snippet`. `setup --apply` and `init` on
a clone write them into place (a snippet is appended once), and `uninstall` takes exactly them out.
`rough/setup/sample/good/` and `rough/setup/sample/broken/` hold the iterations `doctor` renders
for a repo with no recipe, with `{{roughbook:marker}}` and `{{roughbook:fixture}}` where their text
shows.

## Local UI

`roughbook start` serves the local UI on `127.0.0.1` (port 4848, or `--port`, which is kept
for next time) and opens it. It opens on the project's canvas, as the web does: pages as sections,
components as frames, and each iteration in `rough/` as a card with its last screenshot, beside
the web sketches not pulled yet (each with Pull) and the runs an agent is making now. A prompt at
the foot starts new directions, forks and refinements with the agent of your choice; the
selection's toolbar has each run's Done, Stop and Copy prompt, Compare (or Shift-click), the
component's brief (read-only here, with a link to edit it on the web) and Promote; and ⌘K or
Ctrl K finds every command. An iteration opens on its stage, in the preview frame
(`@roughbook/ui`'s `PreviewFrame`, the same for every stack and mode): the page from the app's
own dev server (`--dev-url`, `ROUGHBOOK_DEV_URL`, or the environment's `start` address) at each
of the environment's viewports and in each of its variants, its state (starting, making, ready,
failed, missing) with its message and the app's last line while it starts, Reload, Open, and the
last screenshot when the app is not answering; beside it the review drawer, notes, select, reject
and refine, and its run's report with Put it back for files changed outside it. The frame and the
stage say the stack's own words for page and component beside Roughbook's (`terms`). Compare
shows each column in the same frame, loaded only while on screen and four at most; the rest show
their stills. One status dot in the bar holds the app's state (with Start the app when it is not
answering), the outbox, the agents and the version. While it runs, it keeps
`rough/preview-registry.ts` in step with the iteration folders, sends what waits in the outbox,
reads `rough/environment.md` again whenever it changes, watches the iteration folders (the frame
reloads on a change where the environment says `reload: studio`, and the changed iteration's
screenshots are taken again once its files have been still for a few seconds, unless an agent is
still writing it), and asks the app every few seconds whether it answers.

Runs open in the **built-in terminal**, a dock at the foot of the canvas with one tab per session
(xterm.js on `node-pty`), or in your own terminal if you choose. A session runs the agent itself, never a shell, and belongs to its run:
closing or reloading the page leaves it running, and joining again replays what it printed. It is
used on Windows, macOS and glibc Linux, where `node-pty` installs and starts; elsewhere, and with
`ROUGHBOOK_TERMINAL=external`, runs open in your own terminal. It comes as `@lydell/node-pty`,
node-pty's own files split into one package per platform with no install script, so npm has
none to run or warn about.

The server answers only `127.0.0.1` and `localhost` as its Host, and its API and terminal only
the page it opened: a token made at each start reaches the page in the link's fragment, and every
call carries it. A card's `<img>`, which cannot send it, reads its screenshot with a key derived
from the token that reads screenshots and nothing else. Iterations load the project's and library's asset files from
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

The backend is `roughbook-backend`. The studio talks to `https://rough-api.nuverasoft.com` unless
`ROUGHBOOK_SERVER` or `roughbook login --server` says otherwise, such as `http://localhost:4000`
for a backend on this machine; anything but this machine must be https.

## Where things are kept

| What                           | Where                                                |
| ------------------------------ | ---------------------------------------------------- |
| Your sign-in (install token)   | The user config folder (below), readable only by you |
| The repo's link to its project | `rough/roughbook.json`, committed with `rough/`      |
| The default agent, local port  | `settings.json` in the user config folder            |
| Your analytics answer          | `settings.json` too; the backend keeps it as well    |
| Analytics events not yet sent  | `events.json` in the user config folder              |
| Runs, snapshots, the outbox    | `rough/.roughbook/`, never committed                 |
| Approved commands, by hash     | `rough/.roughbook/approvals.json`, never committed   |
| Setup runs and doctor's report | `rough/.roughbook/setup/`, `doctor-report.json`      |
| The repo's environment         | `rough/environment.md` and `rough/setup/`, committed |
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
appears) and its own (nothing outside `rough/` imports from it), lists every file changed outside the run's folder, and sends the outcome, warning codes and counts. What you changed yourself while the run was open is not the agent's: `done` shows those files and asks, `--mine <path>` names them (a file, a folder, or `.` for all), the local UI's Done lists them to tick, and `finish_run` takes `mine`; they are kept on the run and left out of the count. The run records who finished it: the agent through MCP, `done`, the local UI, or the agent exiting. Any such file can be put back:
a new one is removed, an uncommitted one comes back from its copy, a committed one from git.

Reviews and run results are written to the outbox first and sent in order when the backend can be
reached, so nothing is lost offline; the server applies one sent twice once. `run` sends what is
waiting before it asks for a prompt, so a rejection always reaches the next one.

Claude Code, Codex, Antigravity CLI (`agy`) and Cursor's CLI (`agent`) are supported, found without any setup: on PATH, then where installers put
them when PATH misses it (the native installers' `~/.local/bin`, npm's global folder, WinGet,
Scoop, Homebrew, Volta, Bun), then, for Claude Code, its older `~/.claude/local` install and the
copy the Claude desktop app keeps, including the Windows package's own folder, and on Windows `%LOCALAPPDATA%gyin` and `%LOCALAPPDATA%\cursor-agent`. `ROUGHBOOK_CLAUDE_BIN`, `ROUGHBOOK_CODEX_BIN`, `ROUGHBOOK_AGY_BIN` or `ROUGHBOOK_CURSOR_CLI_BIN` names one anywhere else. Gemini CLI is not among them: Google replaced it with Antigravity CLI for personal accounts on 2026-06-18.

Cursor, VS Code (with Copilot), Antigravity and Windsurf run iterations with their own agents, with
you driving: `run --agent cursor` (or the local UI's Agent list) opens the repo and the run's prompt
in the editor, through its own launcher (`cursor`, `code`, `antigravity`, `windsurf`; on Windows the
editor's exe and `cli.js` that its `.cmd` launcher runs, with no shell), and puts the instruction on the clipboard for a new chat with the editor's agent: follow the prompt, and when the iteration is ready finish the run with the roughbook MCP tools. Each is found on PATH, in its
install folder (Windows), app bundle (macOS) or package folder (Linux), or through
`ROUGHBOOK_<EDITOR>_BIN`. `--agent other` opens the prompt with the OS's default app instead, and the
default app takes over when an editor cannot start. Editors never run unattended; Done, the checks
and the snapshot are the same as for a terminal agent. With no default set, `run` uses the first
terminal agent found, then the first editor.

## MCP

`roughbook mcp` is an MCP server (stdio) with four tools, so an editor's agent finds a run and
finishes it itself: `list_runs` (the runs open in the repo), `get_prompt`, `get_checks` (what the
iteration must pass, checked now, without finishing anything) and `finish_run` (Done: the checks,
the files changed outside the run's folder, the screenshots and the report, with the warnings back
to the agent). It reads and writes local files only and reports through the same client and outbox
as `done`. It works out the repo from the folders the editor says it has open, else the folder it
was started in, else the `repo` path the agent passes. Unattended runs end when their agent exits,
so `finish_run` leaves them alone.

`roughbook mcp install` adds the server, as `roughbook`, at the user level, so every repo has it:
to `~/.cursor/mcp.json` for Cursor; to VS Code's user `mcp.json` (`%APPDATA%\Code\User`,
`~/Library/Application Support/Code/User` or `~/.config/Code/User`); to
`~/.gemini/config/mcp_config.json` for Antigravity (and its older `~/.gemini/antigravity/` file when
there is one); to `~/.codeium/windsurf/mcp_config.json` for Windsurf; and through
`claude mcp add --scope user` and `codex mcp add` for Claude Code and Codex. Name any of `cursor`, `vscode`, `antigravity`, `windsurf`, `claude-code` and `codex` (`cursor-cli` and `antigravity-cli` mean the file their editor reads), or none for every one found here.
It keeps what else the file holds, leaves a file with comments alone and prints the entry to
paste, and `--print` only prints. The entry starts this Node with this install's `cli.js`, which
needs no shell or PATH on any OS (`npx -y roughbook mcp` when the studio runs from npx's cache);
run it again after moving Node. When `ROUGHBOOK_CONFIG_DIR` is set, the entry sets it too, so the
agents' server uses the same sign-in. A run's prompt ends by telling the agent to call `get_checks` and then `finish_run` with the run's id when it has the tools, to hand back to you when it does not, and that the app's dev server is yours to run, never its to start or stop, naming where the iteration renders (`--dev-url`, `ROUGHBOOK_DEV_URL` or `http://localhost:3000`); after an editor run, the studio says to install the server if that editor does not have it.

A terminal agent's run opens it in a terminal: Windows Terminal or a
console window on Windows, Terminal or iTerm on macOS (`ROUGHBOOK_TERMINAL=iterm`), and
`$TERMINAL`, `x-terminal-emulator`, GNOME Terminal, Konsole or xterm on Linux, where the window
stays open with the exit code until Enter when the agent fails; otherwise it prints
the command to paste. `--headless` runs the agent unattended, only with your own API key: `ANTHROPIC_API_KEY` for Claude Code, `CODEX_API_KEY` or `OPENAI_API_KEY` for Codex, `GEMINI_API_KEY` for Antigravity CLI (which takes it only with `"modelProvider": "gemini"` in `~/.gemini/antigravity-cli/settings.json`), `CURSOR_API_KEY` for Cursor's CLI. The key, not the login, because that is what each vendor publishes: Anthropic keeps the Claude account sign-in for ordinary use of Claude Code itself and points products that drive it to API keys ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)); OpenAI says to use an API key for programmatic Codex CLI workflows ([authentication](https://learn.chatgpt.com/docs/auth)); Cursor's CLI docs set one for scripts. A terminal or editor session is you driving your own tool, on whatever sign-in it has. Claude Code and Codex are confined to the run's folder by their own permissions; agy writes in the workspace and runs no commands; Cursor's CLI applies its changes with its shell in its sandbox; the studio's snapshot covers all four. Token counts are reported where the CLI gives them, which Cursor's does not. `done` takes desktop and phone screenshots
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

## The preview contract

Whatever the stack, a repo's preview setup must do six things, and `roughbook init` writes them down
for the agent in `rough/CONTRACT.md`: nothing from `rough/` reaches production (the build's output
holds none of it, or the preview URL answers 404 in production mode); each iteration can be shown on
its own inside the app, with its `preview.json` passed in as its inputs when it has one; a rendered
iteration posts `{ roughbook: "ready", id }` to the page's parent and a missing or failed one posts
`{ roughbook: "error", id, message }` (and 404 or 500 where the stack can); a change to an
iteration's files shows without a restart; the preview answers requests addressed to this machine
only; and every file the setup adds outside `rough/` is listed in `rough/environment.md`.

## Standalone mode

For a repo no live dev server suits (a plain HTML site, a PHP site with no Node.js tooling, a
design-system repo), `mode: standalone` makes the studio's own server the preview, so the setup
writes nothing outside `rough/`. It serves an iteration's HTML entry (`index.html`, a fragment or a
whole page) as it is, or bundles a React one (`index.tsx`, `index.jsx`) with esbuild against the
repo's own `react` and `react-dom`, at `/rough-preview/<page>/<component>/<iteration>/`, inside a
page that loads the site's stylesheets. `public` names the folder served at the site's root (`.`
for the repo itself), so the iteration's links to the site's files (`/images/logo.svg`) resolve as
on the site, while its own files are linked relative to its folder; `stylesheets` lists the
stylesheets as the site's pages link them, a path under that folder (`/css/site.css`) or a full
address. An HTML `wrapper` holds `{{roughbook:iteration}}` where the iteration goes; a React one is
a component that takes `children`. The fixture reaches an HTML iteration as
`window.roughbookFixture` and a React one as its props, and the variants reach the page's root
(`lang`, `dir`, a `dark` class with `color-scheme: dark`). The server answers 200, 404 for a key with
no iteration and 500 for one it cannot render (with the reason, such as esbuild's error), posts the
ready and error messages itself, and renders again on every request, so `reload` is `studio`.

It listens on 127.0.0.1 only: in the local UI on the studio's own port under the name `localhost`,
an origin apart from the UI's page at `127.0.0.1`, so an iteration's code never reaches the UI or
its token; for `doctor`, `screenshot` and a run finished outside the UI, on a free port for the time
it takes. Every request carries the previews' own token (in the address, which the frame and the
screenshots get from the studio) unless the browser marks it as the preview page's own
(`Sec-Fetch-Site: same-origin`), which no other site can. The gate is about the site itself:
`build: none` with the folders it publishes as they are in `buildOutput` (none may hold `rough/`), or
`gate: runtime` with `production` serving the site, which must not hand out `rough/`.

## Snapshot mode

For a stack whose previews are rendered images (Jetpack Compose with Roborazzi or Paparazzi,
SwiftUI snapshot tests, Flutter's widget tests), `mode: snapshot` has the repo's own `snapshot`
command render them, and a live preview through a mobile stack's web target (Expo, Flutter) may
name one too, for final review beside the page. The studio runs it with the keys of the iterations
whose files changed since their images were made (`{keys}` in the line, `ROUGHBOOK_KEYS`, and the
request file `ROUGHBOOK_REQUEST` names), every shot a key gets in `ROUGHBOOK_SHOTS`
(`<name>:<width>x<height>:<variant>`), where the stack sees the iterations in
`ROUGHBOOK_ITERATIONS`, and where the images go in `ROUGHBOOK_OUT`. The command writes
`<out>/<key>/<shot>.png`, the screenshots' own paths, so the frame, the canvas's cards and doctor
read them as screenshots, and says per key `roughbook: ready <key>`, `roughbook: missing <key>` or
`roughbook: error <key>: <why>` on a line of its own, or the same word in `result.txt` beside the
images where its test runner swallows what tests print; it exits 0 when every key rendered. A key it
says nothing of has rendered only if every image is new. One command runs at a time per repo; the
local UI renders the keys that changed together, five seconds after the last write; the frame shows
the images, Render again, and On the device where the environment names a `device` command.

`placement: in-tree <path>` is for a stack that compiles nothing outside its own source tree: the
studio mirrors each iteration folder of `rough/` into `<path>/<page>/<component>/<iteration>/`
before every render (and writes a mark there, so it never empties a folder it did not make). The
path is a debug-only source set or target, gitignored (`init` adds it) and in the environment's
ignore list (the studio adds it), and the production build leaves it out, which doctor proves. On a
snapshot stack (`assetsCopy: yes`, the default in snapshot mode) the studio copies the asset files a
run's prompt names into the iteration's `assets/` folder, since its tools load nothing over the
network.

The Expo recipe previews live through the app's web target (`npx expo start --localhost`): a route
under Expo Router that loads the iterations only under `__DEV__`, which the root layout lets through
in development; `rough/snapshots.mjs` renders final-review snapshots on an attached Android device
or emulator (adb) or a booted iOS simulator, and opens a key there. The Flutter recipe mirrors
iterations into `lib/rough/` with a registry of them, previews live through the web target
(`flutter run -d web-server -t lib/rough_preview.dart`), and renders snapshots with a widget test
(`flutter test test/rough_snapshot_test.dart`).

## Doctor

`roughbook doctor` proves the contract on this repo, with the app's dev server running (with
`--speed`, doctor starts it itself when nothing answers, with the approved start command, and
stops it after). It first
checks the prerequisites (every program the environment's commands name is on the PATH, with how
to install each missing one) and that the environment reads and its commands are approved here;
then it writes two iterations of its own under a page of its own, `rough/doctor-check-<id>/` (one
that renders, one that fails; a recipe's own, or the setup run's samples from `rough/setup/sample/`),
asks the dev server about them as the studio would, takes screenshots at every viewport and
variant, changes
the iteration and waits for the change to show, runs the production build and searches its output
for the iteration (or serves production and expects 404), tries the preview from this machine's
network address, checks that every setup file is in place and matches its template (and, after a
setup run, that nothing else outside `rough/` changed), and takes its iterations away again. Each
check passes, fails with what to fix, or is skipped with the reason. The renders check tells three failures apart: the dev server never sent the iteration, the
app sent it but the page shows something else (a layout or wrapper that decides what to show by
path, and so must let the preview's address through in development), or the page shows it and
never posts ready; the checks that need the iteration on the page are skipped after the second.
The page's name is new on every run because a dev server's watcher (webpack's, on Windows) loses
a folder that was deleted and made again, and would miss the change to the iteration. The exit code
is 0 when every check passed, 1 when one failed, and 2 when the build was skipped (`--skip-build`),
which leaves the repo unverified. `--json` prints the report for a team's own CI. Every run writes
`rough/.roughbook/doctor-report.json`, the checks and the versions with no path and nothing from
the repo, which `setup --fix` reads and `--report` names for a support ticket. The outcome, the
mode, the family, the stack tokens and the ids of the checks that failed go to the server with the
link, so ratings and analytics can be read by stack; nothing else does.

In snapshot mode, or with `--snapshots` for a live repo's final-review command, doctor runs the
snapshot command for the two samples and a key with no iteration in one go, and expects images at
every shot (PNGs with the viewport's proportions, a dark one unlike the light), an error for the
broken sample and missing for the absent key; it changes the sample's fixture and expects other
images, renders with nothing changed and expects nothing rendered, then changes the sample and
expects it alone rendered again with other images; and builds for release with the sample mirrored
in place, searching the output inside app packages too (`app.apk!classes.dex`). Nothing is served,
so the loopback check is skipped.

In standalone mode doctor starts the studio's own server instead of asking the app, checks that the
site's folder and the stylesheets on it are there, and runs the same checks through it; the gate
searches the folders the site publishes for the sample iteration (`build: none`), or asks the site
in production mode for the sample's own file under `rough/` and expects anything but that file
back: a 404, or a page of the site's own, as PHP's built-in server answers a missing file
(`gate: runtime`).

The twelfth check, `--speed`, measures the speed budgets of ROUGHBOOK-FRAMEWORKS-PLAN.md on a third
sample iteration, as a finished run leaves one: the preview visible (warmed once, then until it
shows and says ready) within 3 s; the cold start, from the start command to the first preview,
within 60 s when doctor started the app; and the screenshots at every viewport and variant within
15 s, taken once and not again when nothing changed. Each is said with its number and its budget.

The conformance suite is doctor over each recipe's fixture: `npm run build`, then
`npm run conformance -- next` copies `conformance/fixtures/next` to a temp folder, installs it,
prepares it as `init` would, starts its dev server, runs doctor and takes everything down;
`--speed` lets doctor start the dev server itself, so the cold start is measured too.

## Speed

The budgets the plan sets are met the same way on every stack: the canvas shows still pictures
(each card's first screenshot) and only the open iteration and a comparison are live; a run's
preview is asked for once when the run finishes, so a dev server that compiles on first request
has it ready before you look; one headless browser is kept for the session and its tab reused for
every screenshot and probe (started on the first, closed after a few minutes idle or when the
command ends); frames load only while on screen, four at most; and screenshots are taken once per
iteration, at every viewport and variant, and again only when its files or the environment's
viewports changed (`rough/.screenshots/<iteration>/shots.json` records what they were taken of;
Take them again on the stage takes them anyway).

## Layout

```text
src/
  cli.ts        the only process.cwd(); finds the repo root; runs a command
  commands/     one file per command, and the registry
  api/          the typed client for /studio, its errors, and the outbox
  config/       sign-in, server address, the user config folder
  agents/       one adapter per coding agent: finding it, terminal sessions, unattended runs
  launch/       everything that differs by OS: terminals, opening a browser, naming the OS
  mcp/          the MCP server: the protocol, the four tools, and adding it to editors
  screenshot/   one headless Chrome, Chromium or Edge kept for the session, at every viewport and variant
  runs/         local runs: slots and prompt files, the checks, snapshots and revert, the watcher,
                review decisions, sketch pulls, and promotion
  repo/         the repo root, repo prep, the link file, command approvals, the setup templates
  recipes/      everything that names a stack: the detection table, the Next.js, Expo and Flutter
                recipes, tool hints, and the standalone server's renderers (HTML as it is, React
                through esbuild)
  snapshot/     snapshot mode: the command's contract, rendering the changed keys, the device command
  environment/  rough/environment.md: its header's fields, read for this operating system
  standalone/   the standalone server: the page around an iteration, its files, who may ask
  doctor/       roughbook doctor: the contract, its checks (snapshot mode's apart), the sentinel search
  fs/           whole-file JSON writes and the lock the CLI and local server share
  server/       the local server: its API, the built-in terminal's sessions, who may ask
  tests/
ui/             the local UI: Vite, React and @roughbook/ui, built into dist/ui
```
