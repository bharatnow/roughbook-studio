// The built-in terminal spike (S1 step 5): runs programs in a pseudo-terminal with the given
// node-pty package and feeds their output to xterm.js's headless terminal, the same parser the
// local UI would render in the browser. Prints one JSON report and exits 1 if anything failed.
//   node check.mjs [node-pty | @lydell/node-pty]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xterm from '@xterm/headless';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageName = process.argv[2] ?? 'node-pty';
const windows = process.platform === 'win32';

const loadStart = performance.now();
const pty = require(packageName);
const loadMs = Math.round(performance.now() - loadStart);

const strip = text =>
  text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[\]P^_][^\x07\x1b]*(\x07|\x1b\\)/g, '');

function open(command, args, { cols = 100, rows = 30 } = {}) {
  const term = new xterm.Terminal({ cols, rows, allowProposedApi: true });
  const proc = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: here,
    env: { ...process.env, FORCE_COLOR: '1' }
  });
  let raw = '';
  const waiters = new Set();
  proc.onData(data => {
    raw += data;
    term.write(data);
    for (const waiter of waiters) waiter();
  });
  const exited = new Promise(resolve => proc.onExit(resolve));
  return {
    proc,
    term,
    text: () => strip(raw),
    waitFor(pattern, ms = 15_000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const match = strip(raw).match(pattern);
          if (!match) return;
          waiters.delete(check);
          clearTimeout(timer);
          resolve(match);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`no ${pattern} in ${JSON.stringify(strip(raw).slice(-400))}`));
        }, ms);
        waiters.add(check);
        check();
      });
    },
    exit(ms = 10_000) {
      return Promise.race([
        exited,
        new Promise((_, reject) => setTimeout(() => reject(new Error('did not exit')), ms))
      ]);
    },
    /** The rendered screen, as xterm.js holds it, once it has parsed everything written. */
    screen() {
      return new Promise(resolve =>
        term.write('', () => {
          const buffer = term.buffer.active;
          const lines = [];
          for (let row = 0; row < term.rows; row += 1) {
            lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
          }
          resolve({ type: buffer.type, lines });
        })
      );
    }
  };
}

const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const checks = {
  /** A full-screen UI: TTY on both ends, alternate screen, raw keys, resize, exit code. */
  async tui() {
    const session = open(process.execPath, [path.join(here, 'tui.mjs')]);
    await session.waitFor(/READY 100x30/);
    const first = await session.screen();
    if (first.type !== 'alternate') throw new Error(`screen is ${first.type}`);
    if (!first.lines.some(line => line.includes('Roughbook pty spike'))) {
      throw new Error(`not drawn: ${first.lines.slice(0, 3).join(' | ')}`);
    }
    session.proc.resize(120, 40);
    session.term.resize(120, 40);
    await session.waitFor(/RESIZE 120x40/);
    session.proc.write('x');
    await session.waitFor(/KEY 78/);
    session.proc.write('\x1b[A');
    await session.waitFor(/KEY 1b\s+KEY 5b\s+KEY 41/);
    session.proc.write('q');
    const { exitCode } = await session.exit();
    if (exitCode !== 7) throw new Error(`exit code ${exitCode}`);
    const last = await session.screen();
    return `alternate screen, resize, raw keys, exit 7; back on the ${last.type} screen`;
  },

  /** The platform's own shell, for a designer who wants one beside the agent. */
  async shell() {
    const session = windows ? open('cmd.exe', ['/d']) : open('/bin/sh', []);
    session.proc.write(windows ? 'set /a 6*7\r' : 'echo $((6*7))\r');
    await session.waitFor(/\b42\b/);
    session.proc.write('exit\r');
    const { exitCode } = await session.exit();
    return `${windows ? 'cmd.exe' : '/bin/sh'} answered and exited ${exitCode}`;
  },

  /** Ctrl+C typed in the terminal reaches the program as SIGINT, as it would in a real one. */
  async interrupt() {
    const session = open(process.execPath, [
      '-e',
      "process.on('SIGINT',()=>{console.log('GOT-SIGINT');process.exit(3)});console.log('WAITING');setInterval(()=>{},1000)"
    ]);
    await session.waitFor(/WAITING/);
    session.proc.write('\x03');
    await session.waitFor(/GOT-SIGINT/, 5_000);
    const { exitCode } = await session.exit();
    if (exitCode !== 3) throw new Error(`exit code ${exitCode}`);
    return 'SIGINT handled, exit 3';
  },

  /** Stopping a run ends the agent and the tools it started. */
  async kill() {
    const session = open(process.execPath, [
      '-e',
      "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('CHILD '+c.pid);setInterval(()=>{},1000)"
    ]);
    const [, child] = await session.waitFor(/CHILD (\d+)/);
    const childPid = Number(child);
    session.proc.kill();
    await session.exit(5_000);
    for (let tries = 0; tries < 20 && alive(childPid); tries += 1) await sleep(250);
    if (alive(childPid)) {
      process.kill(childPid);
      throw new Error('the agent stopped but the process it started kept running');
    }
    return 'the program and the process it started both ended';
  },

  /** A burst of output arrives whole and in order. */
  async throughput() {
    const session = open(process.execPath, [
      '-e',
      "let s='';for(let i=1;i<=20000;i++)s+='line '+i+' '+'x'.repeat(60)+'\\n';process.stdout.write(s+'END\\n')"
    ]);
    const started = performance.now();
    await session.waitFor(/END/, 30_000);
    const ms = Math.round(performance.now() - started);
    const text = session.text();
    const missing = [1, 5000, 10000, 19999, 20000].filter(n => !text.includes(`line ${n} `));
    await session.exit();
    if (missing.length) throw new Error(`lines missing: ${missing.join(', ')}`);
    return `1.4 MB in ${ms} ms`;
  }
};

const report = {
  package: packageName,
  version: JSON.parse(
    readFileSync(path.join(here, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8')
  ).version,
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  loadMs,
  results: []
};
for (const [name, check] of Object.entries(checks)) {
  const started = performance.now();
  try {
    const detail = await check();
    report.results.push({ name, ok: true, ms: Math.round(performance.now() - started), detail });
  } catch (error) {
    report.results.push({
      name,
      ok: false,
      ms: Math.round(performance.now() - started),
      detail: String(error.message ?? error)
    });
  }
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.results.every(result => result.ok) ? 0 : 1);
