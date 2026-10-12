import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import type { AgentAdapter, Detection } from '../agents/types.js';
import type { Io } from '../io.js';

/** An agent or editor that is not on this machine, as a test's injected detection says. */
export function notFound(adapter: AgentAdapter): Detection {
  return {
    id: adapter.id,
    name: adapter.name,
    kind: adapter.kind,
    found: false,
    executable: null,
    version: null,
    signedIn: null,
    signIn: null,
    headless: { ready: false, reason: `${adapter.name} was not found.` },
    capabilities: adapter.capabilities
  };
}

/**
 * A fresh folder under the OS temp folder, removed when the test file ends. It holds an empty
 * `.git` folder, so no search upwards for a repo or an app ever climbs out of it.
 */
export async function tempDir(prefix = 'roughbook-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(dir, '.git'));
  after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export type RecordingIo = Io & {
  lines: string[];
  errors: string[];
  questions: string[];
  answers: (string | null)[];
};

/** Records what a command writes and asks, and answers its questions from `answers` in order. */
export function recordingIo(answers: (string | null)[] = []): RecordingIo {
  const io: RecordingIo = {
    lines: [],
    errors: [],
    questions: [],
    answers: [...answers],
    out: line => void io.lines.push(line),
    err: line => void io.errors.push(line),
    ask: async question => {
      io.questions.push(question);
      return io.answers.length ? (io.answers.shift() ?? null) : null;
    }
  };
  return io;
}

export type RecordedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

type Reply = { status?: number; json?: unknown; text?: string } | 'offline';

/**
 * A fetch that never leaves the process: `respond` answers each request, and every request is
 * recorded, so a test can check exactly what the studio sent.
 */
export function fakeFetch(respond: (request: RecordedRequest) => Reply | Promise<Reply>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null
    };
    requests.push(request);
    const reply = await respond(request);
    if (reply === 'offline') throw new TypeError('fetch failed');
    const text = reply.text ?? JSON.stringify(reply.json ?? null);
    return new Response(text, {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

/** A successful `{ success, data }` answer. */
export function ok(data: unknown, status = 200): Reply {
  return { status, json: { success: true, data } };
}

/** A refusal as the backend sends it. */
export function refused(error: unknown, status: number, message?: string): Reply {
  return { status, json: { success: false, error, ...(message ? { message } : {}) } };
}

// Ground rule 2 of the split plan: no studio request carries code or a path on this machine.

/** Files whose text came from the server or are the studio's own state, not the designer's. */
function fromServerOrState(file: string): boolean {
  return (
    /^rough\/.+\/prompts\/[^/]+\.md$/.test(file) ||
    /^rough\/.+\/copy\.md$/.test(file) ||
    file === 'rough/roughbook.json' ||
    file.startsWith('rough/.roughbook/') ||
    file.startsWith('rough/.screenshots/')
  );
}

function filesIn(root: string, dir = root): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? filesIn(root, full)
      : [path.relative(root, full).split(path.sep).join('/')];
  });
}

/** Every string a request carries: its URL, header values, and each key and value of its body. */
function carried(request: RecordedRequest): string[] {
  const strings: string[] = [decodeURIComponent(request.url), ...Object.values(request.headers)];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        strings.push(key);
        walk(item);
      }
    }
  };
  walk(request.body);
  return strings;
}

/**
 * Fails when any request carries a line (12 characters or more) of a file the designer, the
 * agent or the app wrote in `repo`, one of `extraLines`, or the repo's, `root`'s or the home
 * folder's path.
 */
export function assertCarriesNoRepoContent(
  requests: RecordedRequest[],
  options: { repo: string; root: string; extraLines?: string[]; minimumLines?: number }
): void {
  const { repo, root } = options;
  const lines = new Map<string, string>();
  for (const file of filesIn(repo).filter(file => !fromServerOrState(file))) {
    for (const line of fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8').split('\n')) {
      const text = line.trim();
      if (text.length >= 12 && /[A-Za-z0-9]/.test(text)) lines.set(text, file);
    }
  }
  for (const line of (options.extraLines ?? []).map(item => item.trim())) {
    if (line.length >= 12) lines.set(line, 'the agent');
  }
  const minimum = options.minimumLines ?? 20;
  assert.ok(lines.size > minimum, `only ${lines.size} lines to look for`);
  const forbiddenPaths = [repo, root, os.homedir()].flatMap(item => [
    item.toLowerCase(),
    item.split(path.sep).join('/').toLowerCase()
  ]);

  for (const request of requests) {
    const label = `${request.method} ${request.url}`;
    for (const text of carried(request)) {
      for (const [line, file] of lines) {
        assert.ok(!text.includes(line), `${label} carries a line of ${file}: ${line}`);
      }
      for (const forbidden of forbiddenPaths) {
        assert.ok(
          !text.toLowerCase().includes(forbidden),
          `${label} carries the path ${forbidden}`
        );
      }
    }
  }
}
