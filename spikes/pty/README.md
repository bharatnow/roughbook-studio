# Built-in terminal spike (S1 step 5)

Can the local UI run an agent in a terminal of its own, the same way on Windows, macOS and Linux? These scripts run programs in a pseudo-terminal with `node-pty` (1.1.0, or 1.2.0-beta.15 as `node-pty-beta`) or `@lydell/node-pty` and show them with xterm.js. They are not part of the studio, and the studio's install never sees this folder.

```bash
npm install
node check.mjs node-pty
node check.mjs node-pty-beta
node check.mjs @lydell/node-pty
node serve.mjs node-pty 4791
```

`check.mjs` runs five checks and prints a JSON report:

- **tui**: a stand-in for an agent's full-screen UI (`tui.mjs`) sees a TTY, draws on the alternate screen, gets raw keys and arrow keys, sees a resize, and exits with its own code.
- **shell**: the platform's shell answers a command and exits.
- **interrupt**: Ctrl+C typed into the terminal reaches the program as SIGINT.
- **kill**: stopping the terminal ends the program and a process it started.
- **throughput**: 1.4 MB of output arrives whole.

`serve.mjs` serves xterm.js on 127.0.0.1 and joins it to a pseudo-terminal over a WebSocket. Open the URL it prints; `program=shell` or `program=node` in the URL's fragment swaps the program. The socket is refused without the page's token, from another origin, or through another host name.

The `Terminal spike` workflow runs `check.mjs` on every GitHub runner when a `spike/**` branch is pushed. The results and the decision are in the split plan, under S1.
