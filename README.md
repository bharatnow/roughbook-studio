# Roughbook studio

Design iterations inside your own repo, with the coding agent and editor you already use. The
studio links a repo to a Roughbook project, writes each iteration's prompt into `rough/`, hands it
to your agent, checks what came back, and lets you review, select and promote from a local UI.
Your code stays on your machine: the server only ever sees ids, review decisions and run metadata.

Runs on Windows, macOS and Linux, with Node 22 or later.

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
| Runs, snapshots, the outbox    | `rough/.roughbook/`, never committed                 |

The user config folder is `%APPDATA%\Roughbook` on Windows, `~/Library/Application Support/Roughbook`
on macOS, and `$XDG_CONFIG_HOME/roughbook` (or `~/.config/roughbook`) on Linux.
`ROUGHBOOK_CONFIG_DIR` overrides it.

Reviews and run results are written to the outbox first and sent in order when the backend can be
reached, so nothing is lost offline.

## Layout

```text
src/
  cli.ts        the only process.cwd(); finds the repo root; runs a command
  commands/     one file per command, and the registry
  api/          the typed client for /studio, its errors, and the outbox
  config/       sign-in, server address, the user config folder
  repo/         the repo root and the rough/ folder
  fs/           whole-file JSON writes and the lock the CLI and local server share
  tests/
```
