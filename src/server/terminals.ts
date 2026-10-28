// The built-in terminal's sessions. Each runs one agent command (never a shell) in a
// pseudo-terminal and belongs to its run, not to a page: closing or reloading the page leaves it
// running, a page that joins again gets the scrollback first, and only Stop or the agent's own
// exit ends it.
import { randomUUID } from 'node:crypto';
import type { PtyModule, PtyProcess } from '../launch/pty.js';
import type { TerminalActivity } from './activity.js';

export type TerminalInfo = {
  id: string;
  runId: string | null;
  title: string;
  status: 'running' | 'exited';
  exitCode: number | null;
  /** Ended with Stop, rather than by the agent itself. */
  stopped: boolean;
  startedAt: string;
};

/** What a page receives, as JSON text. */
export type TerminalMessage =
  | { type: 'snapshot'; data: string; status: TerminalInfo['status']; exitCode: number | null }
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number };

/** What a page sends. */
export type TerminalInput =
  { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };

export type TerminalClient = { send(text: string): void };

type Session = TerminalInfo & {
  child: PtyProcess;
  scrollback: string;
  clients: Set<TerminalClient>;
  /** When it last printed, in ms; null before it first prints. */
  lastOutputAt: number | null;
  /** A bell, OSC 9 or OSC 777 since the last keystroke (decision 37). */
  bell: boolean;
  /** An OSC sequence cut off at the end of the last print, read with the next. */
  oscTail: string;
};

/** Enough for an agent's whole conversation on screen; older output is let go. */
const SCROLLBACK_LIMIT = 2_000_000;

const ESC = '\u001b';
const BEL = '\u0007';
/** String Terminator, the other way an OSC sequence ends. */
const ST = `${ESC}\\`;
/** An unterminated OSC sequence longer than this is not one; it is let go. */
const OSC_TAIL_LIMIT = 4096;

/**
 * Whether a print rings for the designer: a plain BEL, or a notification by OSC 9 (but not 9;4,
 * a progress report) or OSC 777;notify. A BEL that ends an OSC sequence, such as a window title,
 * is not a bell. Returns the unterminated OSC sequence at the end, if any, to read with the next.
 */
export function rings(text: string): { bell: boolean; rest: string } {
  let bell = false;
  let at = 0;
  while (at < text.length) {
    const start = text.indexOf(`${ESC}]`, at);
    const plain = start === -1 ? text.slice(at) : text.slice(at, start);
    if (plain.includes(BEL)) bell = true;
    if (start === -1) {
      return { bell, rest: text.endsWith(ESC) ? ESC : '' };
    }
    const bel = text.indexOf(BEL, start + 2);
    const st = text.indexOf(ST, start + 2);
    const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st);
    if (end === -1) {
      const rest = text.slice(start);
      return { bell, rest: rest.length > OSC_TAIL_LIMIT ? '' : rest };
    }
    const body = text.slice(start + 2, end);
    if (/^9;(?!4;)/.test(body) || /^777;notify;/.test(body)) bell = true;
    at = end + (end === bel ? 1 : 2);
  }
  return { bell, rest: '' };
}

function clampSize(value: unknown, fallback: number): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 10 && number <= 500 ? number : fallback;
}

export class Terminals {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly pty: PtyModule,
    private readonly now: () => Date = () => new Date()
  ) {}

  start(options: {
    title: string;
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    runId: string | null;
    cols?: number;
    rows?: number;
  }): TerminalInfo {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.env)) {
      if (value !== undefined) env[key] = value;
    }
    env.TERM = 'xterm-256color';
    const child = this.pty.spawn(options.command, options.args, {
      name: 'xterm-256color',
      cols: clampSize(options.cols, 120),
      rows: clampSize(options.rows, 32),
      cwd: options.cwd,
      env
    });
    const session: Session = {
      id: randomUUID(),
      runId: options.runId,
      title: options.title,
      status: 'running',
      exitCode: null,
      stopped: false,
      startedAt: this.now().toISOString(),
      child,
      scrollback: '',
      clients: new Set(),
      lastOutputAt: null,
      bell: false,
      oscTail: ''
    };
    this.sessions.set(session.id, session);
    child.onData(data => {
      session.lastOutputAt = this.now().getTime();
      const heard = rings(session.oscTail + data);
      session.oscTail = heard.rest;
      if (heard.bell) session.bell = true;
      session.scrollback += data;
      if (session.scrollback.length > SCROLLBACK_LIMIT) {
        session.scrollback = session.scrollback.slice(-SCROLLBACK_LIMIT);
      }
      this.broadcast(session, { type: 'data', data });
    });
    child.onExit(({ exitCode }) => {
      session.status = 'exited';
      session.exitCode = exitCode;
      this.broadcast(session, { type: 'exit', exitCode });
    });
    return this.info(session);
  }

  list(): TerminalInfo[] {
    return [...this.sessions.values()].map(session => this.info(session));
  }

  /** When each session last printed and whether it rang since the last keystroke, for activityOf. */
  activity(): TerminalActivity[] {
    return [...this.sessions.values()].map(session => ({
      id: session.id,
      runId: session.runId,
      status: session.status,
      startedAt: Date.parse(session.startedAt),
      lastOutputAt: session.lastOutputAt,
      bell: session.bell
    }));
  }

  /** The last line a session printed, without its colours and cursor moves, for progress words. */
  lastLine(id: string): string | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const plain = session.scrollback
      .slice(-4000)
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007|\r/g, '');
    const lines = plain
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    return lines.length ? lines[lines.length - 1]!.slice(0, 200) : null;
  }

  /** Whether a running session printed what `test` looks for, in the scrollback it keeps. */
  printed(id: string, test: (text: string) => boolean): boolean {
    const session = this.sessions.get(id);
    return session?.status === 'running' && test(session.scrollback);
  }

  get(id: string): TerminalInfo | null {
    const session = this.sessions.get(id);
    return session ? this.info(session) : null;
  }

  /** Joins a page to a session: the scrollback first, then everything as it comes. */
  attach(id: string, client: TerminalClient): (() => void) | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    client.send(
      JSON.stringify({
        type: 'snapshot',
        data: session.scrollback,
        status: session.status,
        exitCode: session.exitCode
      } satisfies TerminalMessage)
    );
    session.clients.add(client);
    return () => session.clients.delete(client);
  }

  /** A key press or a new size from a page. Anything else is ignored. */
  receive(id: string, raw: string): void {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'running') return;
    let message: TerminalInput;
    try {
      message = JSON.parse(raw) as TerminalInput;
    } catch {
      return;
    }
    if (message.type === 'input' && typeof message.data === 'string') {
      // The designer answered, so whatever rang has been heard.
      session.bell = false;
      session.child.write(message.data);
    } else if (message.type === 'resize') {
      session.child.resize(clampSize(message.cols, 120), clampSize(message.rows, 32));
    }
  }

  stop(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.status === 'running') {
      session.stopped = true;
      session.child.kill();
    }
    return true;
  }

  /** Forgets an exited session and its scrollback. */
  remove(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.status === 'running') return false;
    this.sessions.delete(id);
    return true;
  }

  stopAll(): void {
    for (const session of this.sessions.values()) {
      if (session.status === 'running') session.child.kill();
    }
  }

  private broadcast(session: Session, message: TerminalMessage): void {
    const text = JSON.stringify(message);
    for (const client of session.clients) client.send(text);
  }

  private info(session: Session): TerminalInfo {
    return {
      id: session.id,
      runId: session.runId,
      title: session.title,
      status: session.status,
      exitCode: session.exitCode,
      stopped: session.stopped,
      startedAt: session.startedAt
    };
  }
}
