import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { terminalSocket } from '../api';

type Message =
  | { type: 'snapshot'; data: string; status: 'running' | 'exited'; exitCode: number | null }
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number };

/**
 * The dock's colors: Onyx, Frost and Lavender from @roughbook/ui's light palette. The dock stays
 * dark in every appearance (ROUGHBOOK-APPLE-PLAN.md, decision 27): agents print colors chosen for a
 * dark terminal. xterm takes only concrete colors, so they are read off a probe that wears the
 * tokens in the light scheme (`scheme-light`), whatever scheme the page is in.
 */
const PALETTE_PROBE = 'hidden scheme-light bg-onyx text-frost border-lavender';

function terminalTheme(probe: HTMLElement | null) {
  if (!probe) return {};
  const style = getComputedStyle(probe);
  return {
    background: style.backgroundColor,
    foreground: style.color,
    cursor: style.borderTopColor
  };
}

/** Under increased contrast, xterm lifts any text below 7:1 against its background (WCAG AAA). */
const MORE_CONTRAST = '(prefers-contrast: more)';
const contrastRatio = (more: boolean) => (more ? 7 : 1);

/**
 * One agent session in xterm.js. The session belongs to its run, so this page can close and come
 * back: it gets everything printed so far, then the rest as it comes.
 */
export function TerminalView({
  id,
  autoFocus = false,
  onFocused,
  onExit
}: {
  id: string;
  /** Take the keyboard once open, unless a drawer has it. */
  autoFocus?: boolean;
  /** It took the keyboard. */
  onFocused?: () => void;
  onExit?: (exitCode: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [link, setLink] = useState<'connecting' | 'open' | 'closed'>('connecting');
  /** Counts the designer's "Join again", which opens a new socket to the same session. */
  const [attempt, setAttempt] = useState(0);
  const exited = useRef(onExit);
  exited.current = onExit;
  const focused = useRef(onFocused);
  focused.current = onFocused;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const contrast = window.matchMedia(MORE_CONTRAST);
    const term = new Terminal({
      fontFamily: "'IBM Plex Mono', 'Cascadia Mono', Menlo, 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10_000,
      theme: terminalTheme(probe.current),
      minimumContrastRatio: contrastRatio(contrast.matches)
    });
    const contrastChanged = (event: MediaQueryListEvent) => {
      term.options.minimumContrastRatio = contrastRatio(event.matches);
    };
    contrast.addEventListener('change', contrastChanged);
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
    if (autoFocus && !document.querySelector('[role=dialog][aria-modal=true]')) {
      term.focus();
      focused.current?.();
    }

    return () => {
      contrast.removeEventListener('change', contrastChanged);
      observer.disconnect();
      typed.dispose();
      resized.dispose();
      socket.close();
      term.dispose();
    };
    // Joining again, or the dock's own tabs, leave the keyboard where it is.
  }, [id, attempt]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {link === 'closed' ? (
        <div role="status" className="flex items-center gap-3 px-1 pb-2 text-xs text-graphite">
          Not connected.
          <button
            type="button"
            onClick={() => {
              setLink('connecting');
              setAttempt(value => value + 1);
            }}
            className="min-h-6 text-accent-text hover:underline"
          >
            Join again
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 rounded-card bg-onyx p-3 scheme-light">
        <span ref={probe} aria-hidden className={PALETTE_PROBE} />
        <div ref={box} className="h-full w-full" />
      </div>
    </div>
  );
}
