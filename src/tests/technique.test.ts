import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { studioTools, techniqueTool } from '../mcp/tools.js';
import type { ToolCall } from '../mcp/server.js';
import type { CommandContext } from '../commands/context.js';
import { TECHNIQUES } from '../rules/vendor/techniques/index.js';
import { techniqueAnswer } from '../rules/vendor/technique.js';

// The technique library in the studio (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T2): the MCP tool answers
// with the web tool's own techniqueAnswer, copied from the backend (src/rules/sync.test.ts keeps
// the copy in step), so a studio agent reads what a web sketch reads.

const call = {} as ToolCall;
const ask = (args: Record<string, string>) => techniqueTool.call(args, call);

describe('the technique tool', () => {
  it('is offered beside the run tools', () => {
    const tools = studioTools({} as CommandContext, { devUrl: 'http://localhost:3000' });
    assert.deepEqual(
      tools.map(tool => tool.name),
      ['list_runs', 'get_prompt', 'get_checks', 'finish_run', 'technique', 'fetch_asset']
    );
    assert.match(techniqueTool.description, new RegExp(`${TECHNIQUES.length} tested recipes`));
    assert.match(techniqueTool.description, /install nothing/);
  });

  it('lists every entry with no input, and no code', async () => {
    const list = await ask({});
    assert.equal(list, techniqueAnswer({}).content);
    for (const item of TECHNIQUES) assert.ok(list.includes(`- ${item.id}: ${item.name}.`), item.id);
    assert.doesNotMatch(list, /```/);
  });

  it('answers every entry by its id and by its name, as the web does', async () => {
    assert.ok(TECHNIQUES.length >= 20);
    for (const item of TECHNIQUES) {
      for (const name of [item.id, item.name, item.name.toUpperCase()]) {
        const answer = await ask({ name });
        assert.equal(answer, techniqueAnswer({ name }).content, name);
        assert.ok(answer.startsWith(`# ${item.name} (${item.id})`), name);
        assert.match(answer, /Floors \(keep these whatever you change\):/, name);
        assert.ok(answer.includes(`${item.code[0]!.path}:\n\`\`\``), `${name} has its code`);
      }
    }
  });

  it('answers every entry by a need in its own words', async () => {
    for (const item of TECHNIQUES) {
      const need = `${item.name} for a hero`;
      const answer = await ask({ need });
      assert.equal(answer, techniqueAnswer({ need }).content, need);
      assert.ok(answer.includes(`# ${item.name} (${item.id})`), need);
    }
    const glass = await ask({ need: 'glass header over video' });
    assert.match(glass, /^The best \d? ?entr(y|ies) for "glass header over video"/);
    assert.match(glass, /# Frosted glass/);
    // A need nothing matches is not an error: build it, keeping the floors.
    assert.match(await ask({ need: 'quarterly invoice reconciliation' }), /No entry matches/);
  });

  it('refuses a name that is no entry, with the list', async () => {
    await assert.rejects(ask({ name: 'teleport' }), (error: Error) => {
      assert.match(error.message, /No technique is named "teleport"/);
      assert.match(error.message, /- frosted-glass:/);
      return true;
    });
    // A name that misses with a need beside it falls back to the need, as on the web.
    assert.match(await ask({ name: 'teleport', need: 'bento grid' }), /# Bento/);
    await assert.rejects(techniqueTool.call({ name: 3 }, call), /name must be a string/);
  });
});
