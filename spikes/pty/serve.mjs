// The browser half of the spike: xterm.js in a page on 127.0.0.1, joined to a pseudo-terminal
// over a WebSocket. A terminal in the browser is a shell for anything that can reach it, so the
// socket takes only this run's token and only this page's origin.
//   node serve.mjs [node-pty | @lydell/node-pty] [port], then open the printed URL
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pty = require(process.argv[2] ?? 'node-pty');
const token = randomBytes(24).toString('hex');
const windows = process.platform === 'win32';

const PROGRAMS = {
  tui: () => [process.execPath, [path.join(here, 'tui.mjs')]],
  shell: () => (windows ? ['cmd.exe', ['/d']] : [process.env.SHELL || '/bin/sh', []]),
  node: () => [process.execPath, []]
};

const files = {
  '/xterm.mjs': ['@xterm/xterm/lib/xterm.mjs', 'text/javascript'],
  '/addon-fit.mjs': ['@xterm/addon-fit/lib/addon-fit.mjs', 'text/javascript'],
  '/xterm.css': ['@xterm/xterm/css/xterm.css', 'text/css']
};

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Roughbook terminal spike</title>
<link rel="stylesheet" href="/xterm.css">
<style>html,body{margin:0;height:100%;background:#16161d}#term{position:absolute;inset:12px}</style>
</head><body><div id="term"></div>
<script type="module">
import { Terminal } from '/xterm.mjs';
import { FitAddon } from '/addon-fit.mjs';
const params = new URLSearchParams(location.hash.slice(1));
const term = new Terminal({ fontFamily: 'Cascadia Mono, Menlo, DejaVu Sans Mono, monospace', fontSize: 14, cursorBlink: true });
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('term'));
fit.fit();
const url = new URL('/pty', location.href);
url.protocol = 'ws:';
url.searchParams.set('program', params.get('program') || 'tui');
url.searchParams.set('cols', term.cols);
url.searchParams.set('rows', term.rows);
const socket = new WebSocket(url, ['roughbook.' + params.get('token')]);
const send = message => socket.readyState === 1 && socket.send(JSON.stringify(message));
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.type === 'data') term.write(message.data);
  if (message.type === 'exit') term.write('\\r\\n[exited ' + message.exitCode + ']\\r\\n');
};
socket.onclose = event => { window.spikeClosed = event.code; };
term.onData(data => send({ type: 'input', data }));
term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
new ResizeObserver(() => fit.fit()).observe(document.getElementById('term'));
window.spike = { term };
term.focus();
</script></body></html>`;

const server = http.createServer((request, response) => {
  const { pathname } = new URL(request.url, 'http://127.0.0.1');
  if (pathname === '/') {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    return response.end(page);
  }
  const file = files[pathname];
  if (file) {
    response.writeHead(200, { 'content-type': file[1] });
    return response.end(readFileSync(path.join(here, 'node_modules', file[0])));
  }
  response.writeHead(404).end();
});

const sameToken = offered => {
  const given = Buffer.from(offered ?? '');
  const expected = Buffer.from(`roughbook.${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

const sockets = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const offered = String(request.headers['sec-websocket-protocol'] ?? '')
    .split(',')[0]
    ?.trim();
  if (
    request.headers.host !== `127.0.0.1:${server.address().port}` ||
    request.headers.origin !== origin ||
    !sameToken(offered)
  ) {
    console.log(`refused: host=${request.headers.host} origin=${request.headers.origin}`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(request, socket, head, ws => {
    const query = new URL(request.url, origin).searchParams;
    const [command, args] = (PROGRAMS[query.get('program')] ?? PROGRAMS.tui)();
    const proc = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: Number(query.get('cols')) || 80,
      rows: Number(query.get('rows')) || 24,
      cwd: here,
      env: process.env
    });
    console.log(`started ${path.basename(command)} as ${proc.pid}`);
    proc.onData(data => ws.send(JSON.stringify({ type: 'data', data })));
    proc.onExit(({ exitCode }) => {
      ws.send(JSON.stringify({ type: 'exit', exitCode }));
      ws.close();
    });
    ws.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'input') proc.write(message.data);
      if (message.type === 'resize') proc.resize(message.cols, message.rows);
    });
    ws.on('close', () => proc.kill());
  });
});

server.listen(Number(process.argv[3] ?? process.env.PORT) || 0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`http://127.0.0.1:${port}/#token=${token}&program=tui`);
});
