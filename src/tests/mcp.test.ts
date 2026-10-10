// The MCP server's protocol (S2 step 2): JSON-RPC over stdio as the Model Context Protocol has it,
// the client's open folders through roots/list, and progress for long calls.
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { McpServer, PROTOCOL_VERSIONS, rootFolder, serveStdio, type Tool } from '../mcp/server.js';
import { tempDir } from './helpers.js';

/** Parsed JSON, read as freely as the other tests read the server's answers. */
type Parsed = ReturnType<typeof JSON.parse>;
type Message = Record<string, unknown> & { id?: unknown; result?: Parsed; error?: Parsed };

const echo: Tool = {
  name: 'echo',
  title: 'Echo',
  description: 'Says its argument back, with the open folders.',
  inputSchema: { type: 'object', properties: { say: { type: 'string' } } },
  annotations: { readOnlyHint: true },
  async call(args, call) {
    if (args.say === 'fail') throw new Error('Asked to fail.');
    call.progress('Halfway');
    return JSON.stringify({ said: args.say ?? null, roots: await call.roots() });
  }
};

/** A server on a pair of streams, with a client that answers roots/list from `roots`. */
function connect(roots: string[] | null = null) {
  const input = new PassThrough();
  const output = new PassThrough();
  const received: Message[] = [];
  const waiting = new Map<unknown, (message: Message) => void>();
  let buffer = '';
  output.on('data', chunk => {
    buffer += String(chunk);
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      const message = JSON.parse(line) as Message | Message[];
      for (const item of Array.isArray(message) ? message : [message]) {
        received.push(item);
        if (item.method === 'roots/list') {
          input.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: item.id,
              result: { roots: (roots ?? []).map(folder => ({ uri: pathToFileURL(folder).href })) }
            })}\n`
          );
        } else if (item.id !== undefined && !item.method) {
          waiting.get(item.id)?.(item);
        }
      }
      if (Array.isArray(message)) waiting.get('batch')?.(message as unknown as Message);
    }
  });
  const served = serveStdio(
    send =>
      new McpServer({
        info: { name: 'roughbook', title: 'Roughbook', version: '9.9.9' },
        instructions: 'Use the tools.',
        tools: [echo],
        send
      }),
    input,
    output
  );
  let next = 1;
  return {
    received,
    send: (raw: string) => input.write(`${raw}\n`),
    request(method: string, params?: unknown, id: unknown = next++): Promise<Message> {
      return new Promise(resolve => {
        waiting.set(id, resolve);
        input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    waitFor(id: unknown): Promise<Message> {
      return new Promise(resolve => waiting.set(id, resolve));
    },
    async close() {
      input.end();
      await served;
    }
  };
}

const clientInfo = { name: 'test', version: '1' };

describe('the MCP protocol', () => {
  it('starts as the protocol has it, lists its tools and answers pings', async () => {
    const client = connect();
    const init = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo
    });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.deepEqual(init.result.serverInfo, {
      name: 'roughbook',
      title: 'Roughbook',
      version: '9.9.9'
    });
    assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
    assert.equal(init.result.instructions, 'Use the tools.');
    client.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));

    const newer = await client.request('initialize', { protocolVersion: '2099-01-01' });
    assert.equal(newer.result.protocolVersion, PROTOCOL_VERSIONS[0]);

    const tools = await client.request('tools/list');
    assert.deepEqual(tools.result.tools, [
      {
        name: 'echo',
        title: 'Echo',
        description: echo.description,
        inputSchema: echo.inputSchema,
        annotations: { readOnlyHint: true }
      }
    ]);
    assert.deepEqual((await client.request('ping')).result, {});
    await client.close();
    // A notification is never answered.
    assert.equal(client.received.filter(message => message.id === undefined).length, 0);
  });

  it('answers what it cannot do with JSON-RPC errors, and a failed tool as a result', async () => {
    const client = connect();
    assert.equal((await client.request('resources/list')).error.code, -32601);
    assert.equal((await client.request('tools/call', { name: 'nope' })).error.code, -32602);
    assert.equal(
      (await client.request('tools/call', { name: 'echo', arguments: [1] })).error.code,
      -32602
    );
    const failed = await client.request('tools/call', {
      name: 'echo',
      arguments: { say: 'fail' }
    });
    assert.deepEqual(failed.result, {
      content: [{ type: 'text', text: 'Asked to fail.' }],
      isError: true
    });

    const parse = client.waitFor(null);
    client.send('{not json');
    assert.equal((await parse).error.code, -32700);

    const batch = client.waitFor('batch');
    client.send(
      JSON.stringify([
        { jsonrpc: '2.0', id: 'a', method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 'b', method: 'nope' }
      ])
    );
    const answers = (await batch) as unknown as Message[];
    assert.deepEqual(
      answers.map(answer => [answer.id, answer.result ?? answer.error.code]),
      [
        ['a', {}],
        ['b', -32601]
      ]
    );
    await client.close();
  });

  it("asks the client's open folders when it has them, and says how far a call has got", async () => {
    const dir = await tempDir();
    const client = connect([dir]);
    await client.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: { roots: { listChanged: true } },
      clientInfo
    });
    const call = await client.request('tools/call', {
      name: 'echo',
      arguments: { say: 'hi' },
      _meta: { progressToken: 'p1' }
    });
    assert.deepEqual(JSON.parse(call.result.content[0].text), { said: 'hi', roots: [dir] });
    const progress = client.received.filter(item => item.method === 'notifications/progress');
    assert.deepEqual(
      progress.map(item => item.params),
      [{ progressToken: 'p1', progress: 1, message: 'Halfway' }]
    );

    // Asked once, and again only after the client says its folders changed.
    await client.request('tools/call', { name: 'echo', arguments: {} });
    const asked = () => client.received.filter(item => item.method === 'roots/list').length;
    assert.equal(asked(), 1);
    client.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' }));
    await client.request('tools/call', { name: 'echo', arguments: {} });
    assert.equal(asked(), 2);
    await client.close();
  });

  it('never asks a client without roots, and reads only local folders from them', async () => {
    const client = connect(['/never']);
    await client.request('initialize', { protocolVersion: '2025-11-25', capabilities: {} });
    const call = await client.request('tools/call', { name: 'echo', arguments: {} });
    assert.deepEqual(JSON.parse(call.result.content[0].text).roots, []);
    assert.equal(client.received.filter(item => item.method === 'roots/list').length, 0);
    await client.close();

    assert.equal(rootFolder('https://example.test/repo'), null);
    assert.equal(rootFolder(42), null);
    const dir = await tempDir();
    assert.equal(rootFolder(pathToFileURL(dir).href), dir);
  });
});
