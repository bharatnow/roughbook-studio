import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { terminalSocket } from '../api';

type Message =
  | { type: 'snapshot'; data: string; status: 'running' | 'exited'; exitCode: number | null }
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number };

/**
 * One agent session in xterm.js. The session belongs to its run, so this page can close and come
 * back: it gets everything printed so far, then the rest as it comes.
 */
export function TerminalView({ id, onExit }: { id: string; onExit?: (exitCode: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const exited = useRef(onExit);
  exited.current = onExit;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: "'IBM Plex Mono', 'Cascadia Mono', Menlo, 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10_000,
      theme: { background: '#1a1b25', foreground: '#eceff3', cursor: '#c8ccf3' }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    fit.fit();

    const socket = terminalSocket(id);
    const send = (message: object) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    socket.onopen = () => {
      setLink('open');
      send({ type: 'resize', cols: term.cols, rows: term.rows });
    };
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as Message;
      if (message.type === 'snapshot') {
        term.reset();
        term.write(message.data);
        if (message.status === 'exited') {
          term.write(`\r\n\x1b[2m[The agent exited with ${message.exitCode ?? '?'}]\x1b[0m\r\n`);
        }
      } else if (message.type === 'data') {
        term.write(message.data);
      } else if (message.type === 'exit') {
        term.write(`\r\n\x1b[2m[The agent exited with ${message.exitCode}]\x1b[0m\r\n`);
        exited.current?.(message.exitCode);
      }
    };
    socket.onclose = () => setLink('closed');
    const typed = term.onData(data => send({ type: 'input', data }));
    const resized = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // Hidden: nothing to measure.
      }
    });
    observer.observe(element);
    term.focus();

    return () => {
      observer.disconnect();
      typed.dispose();
      resized.dispose();
      socket.close();
      term.dispose();
    };
  }, [id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {link === 'closed' ? (
        <p className="border-b border-ash bg-cloud px-3 py-2 text-xs text-slate">
          Not connected. The session keeps running; reload the page to join it again.
        </p>
      ) : null}
      <div className="min-h-0 flex-1 rounded-card bg-onyx p-3">
        <div ref={box} className="h-full w-full" />
      </div>
    </div>
  );
}
