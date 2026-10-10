// The studio's MCP server: JSON-RPC 2.0 over stdio, one message per line, as the Model Context
// Protocol's stdio transport has it. Small enough to keep by hand rather than take the SDK and
// its dependencies: initialize, ping, tools/list and tools/call, and roots/list asked of the
// client, to learn which folders it has open. Stdout carries protocol messages and nothing else.
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

/** Newest first; a client asking for another is answered with the newest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** How long the client has to say which folders it has open. */
const ROOTS_TIMEOUT_MS = 5000;

type Id = string | number;
type JsonObject = Record<string, unknown>;

/** What a tool's handler is given besides its arguments. */
export type ToolCall = {
  /** The folders the client has open, from roots/list; empty when it does not say. */
  roots(): Promise<string[]>;
  /** Tells the client how far a long call has got, when it asked to hear. */
  progress(message: string): void;
};

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
  annotations: JsonObject;
  /** The text the agent reads. A thrown error becomes a result marked as an error. */
  call(args: JsonObject, call: ToolCall): Promise<string>;
};

export type ServerInfo = { name: string; title: string; version: string };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isId(value: unknown): value is Id {
  return typeof value === 'string' || typeof value === 'number';
}

class ProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

/** A root's folder, from its file URI; null for anything that is not a local folder. */
export function rootFolder(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri.startsWith('file:')) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

export class McpServer {
  private clientRoots = false;
  private roots: Promise<string[]> | null = null;
  private nextId = 1;
  private readonly waiting = new Map<Id, (message: JsonObject) => void>();

  constructor(
    private readonly options: {
      info: ServerInfo;
      instructions: string;
      tools: Tool[];
      /** Writes one message to the client. */
      send(message: JsonObject): void;
    }
  ) {}

  /** Handles one line from the client; answers through `send`. Never throws. */
  async receive(line: string): Promise<void> {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.options.send(this.failure(null, PARSE_ERROR, 'Not JSON.'));
      return;
    }
    if (Array.isArray(parsed)) {
      // JSON-RPC batches, which protocol versions before 2025-06-18 allowed.
      const answers = (await Promise.all(parsed.map(item => this.handle(item)))).filter(
        (answer): answer is JsonObject => answer !== null
      );
      if (answers.length) this.options.send(answers as unknown as JsonObject);
      return;
    }
    const answer = await this.handle(parsed);
    if (answer) this.options.send(answer);
  }

  private failure(id: Id | null, code: number, message: string): JsonObject {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  /** One message: a request is answered, a notification or a response to us is not. */
  private async handle(message: unknown): Promise<JsonObject | null> {
    if (!isObject(message) || message.jsonrpc !== '2.0') {
      return this.failure(null, INVALID_REQUEST, 'Not a JSON-RPC 2.0 message.');
    }
    const { id, method } = message;
    if (method === undefined && isId(id)) {
      this.waiting.get(id)?.(message);
      return null;
    }
    if (typeof method !== 'string') {
      return this.failure(isId(id) ? id : null, INVALID_REQUEST, 'No method.');
    }
    const params = isObject(message.params) ? message.params : {};
    if (!isId(id)) {
      if (method === 'notifications/roots/list_changed') this.roots = null;
      return null;
    }
    try {
      return { jsonrpc: '2.0', id, result: await this.answer(method, params) };
    } catch (error) {
      if (error instanceof ProtocolError) return this.failure(id, error.code, error.message);
      return this.failure(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }

  private async answer(method: string, params: JsonObject): Promise<JsonObject> {
    switch (method) {
      case 'initialize': {
        const capabilities = isObject(params.capabilities) ? params.capabilities : {};
        this.clientRoots = isObject(capabilities.roots);
        const asked = params.protocolVersion;
        return {
          protocolVersion:
            typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked)
              ? asked
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.options.info,
          instructions: this.options.instructions
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return {
          tools: this.options.tools.map(
            ({ name, title, description, inputSchema, annotations }) => ({
              name,
              title,
              description,
              inputSchema,
              annotations
            })
          )
        };
      case 'tools/call':
        return this.callTool(params);
      default:
        throw new ProtocolError(METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  }

  private async callTool(params: JsonObject): Promise<JsonObject> {
    const tool = this.options.tools.find(item => item.name === params.name);
    if (!tool) throw new ProtocolError(INVALID_PARAMS, `Unknown tool: ${String(params.name)}`);
    if (params.arguments !== undefined && !isObject(params.arguments)) {
      throw new ProtocolError(INVALID_PARAMS, 'The arguments must be an object.');
    }
    const meta = isObject(params._meta) ? params._meta : {};
    const token = isId(meta.progressToken) ? meta.progressToken : null;
    let step = 0;
    const call: ToolCall = {
      roots: () => this.listRoots(),
      progress: message => {
        if (token === null) return;
        step += 1;
        this.options.send({
          jsonrpc: '2.0',
          method: 'notifications/progress',
          params: { progressToken: token, progress: step, message }
        });
      }
    };
    try {
      const text = await tool.call(params.arguments ?? {}, call);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true
      };
    }
  }

  /** The client's open folders, asked once and again after it says they changed. */
  private listRoots(): Promise<string[]> {
    if (!this.clientRoots) return Promise.resolve([]);
    this.roots ??= this.request('roots/list').then(
      result =>
        (Array.isArray(result?.roots) ? result.roots : [])
          .map(root => rootFolder(isObject(root) ? root.uri : null))
          .filter((folder): folder is string => folder !== null),
      () => {
        this.roots = null;
        return [];
      }
    );
    return this.roots;
  }

  /** Asks the client something and waits for its answer, for a few seconds at most. */
  private request(method: string): Promise<JsonObject | null> {
    const id = `roughbook-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`No answer to ${method}.`));
      }, ROOTS_TIMEOUT_MS);
      this.waiting.set(id, message => {
        clearTimeout(timer);
        this.waiting.delete(id);
        if (isObject(message.error)) reject(new Error(String(message.error.message)));
        else resolve(isObject(message.result) ? message.result : null);
      });
      this.options.send({ jsonrpc: '2.0', id, method });
    });
  }
}

/**
 * Serves one client over a pair of streams until its input ends, then waits for the calls still
 * going. Each message is one line of JSON.
 */
export async function serveStdio(
  create: (send: (message: JsonObject) => void) => McpServer,
  input: Readable,
  output: Writable
): Promise<void> {
  const server = create(message => void output.write(`${JSON.stringify(message)}\n`));
  const pending = new Set<Promise<void>>();
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    // Calls run side by side: a long finish_run does not hold up a ping.
    const handled = server.receive(line).finally(() => pending.delete(handled));
    pending.add(handled);
  }
  await Promise.all(pending);
}
