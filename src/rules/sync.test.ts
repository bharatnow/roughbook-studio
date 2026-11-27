import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backend = path.join(studio, '..', 'roughbook-backend');
const vendor = path.join(studio, 'src', 'rules', 'vendor');
const hasBackend = fs.existsSync(path.join(backend, 'src', 'utils', 'rules', 'techniques'));
const skip = hasBackend ? false : 'no ../roughbook-backend checkout beside the studio (as in CI)';

const lf = (text: string) => text.replace(/\r\n/g, '\n');

describe('the copied house rules and technique library', () => {
  it('are what scripts/sync-rules.mjs makes from the backend now', { skip }, async () => {
    const script = pathToFileURL(path.join(studio, 'scripts', 'sync-rules.mjs')).href;
    const { generate, listVendor } = (await import(script)) as {
      generate: (backendPath: string) => Map<string, string>;
      listVendor: (dir: string) => string[];
    };
    const wanted = generate(backend);
    // Every technique file the backend has is copied, and nothing else is left in vendor/.
    assert.deepEqual(listVendor(vendor).sort(), [...wanted.keys()].sort());
    for (const [name, content] of wanted) {
      assert.equal(
        lf(fs.readFileSync(path.join(vendor, ...name.split('/')), 'utf8')),
        lf(content),
        `src/rules/vendor/${name} is out of step: run node scripts/sync-rules.mjs`
      );
    }
  });

  it('have shims with the backend types the copies read', { skip }, () => {
    const checks = fs.readFileSync(
      path.join(backend, 'src', 'utils', 'compile', 'checks.ts'),
      'utf8'
    );
    assert.match(
      checks,
      /export type Finding = \{ code: string; message: string; blocks\?: true \};/
    );
    const tools = fs.readFileSync(
      path.join(backend, 'src', 'services', 'sketch', 'tools', 'types.ts'),
      'utf8'
    );
    assert.match(tools, /export type ExtraToolOutcome = \{ content: string; isError: boolean \};/);
  });
});
