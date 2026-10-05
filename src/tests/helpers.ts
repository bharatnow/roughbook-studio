import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import type { Io } from '../io.js';

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

export type RecordingIo = Io & { lines: string[]; errors: string[]; answers: (string | null)[] };

/** Records what a command writes, and answers its questions from `answers` in order. */
export function recordingIo(answers: (string | null)[] = []): RecordingIo {
  const io: RecordingIo = {
    lines: [],
    errors: [],
    answers: [...answers],
    out: line => void io.lines.push(line),
    err: line => void io.errors.push(line),
    ask: async () => (io.answers.length ? (io.answers.shift() ?? null) : null)
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
