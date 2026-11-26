import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SHARED_PAGE_SLUG, pagePath } from './vendor-shims.js';

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backend = path.join(studio, '..', 'roughbook-backend');
const vendor = path.join(studio, 'src', 'facts', 'vendor');
const hasBackend = fs.existsSync(path.join(backend, 'src', 'utils', 'rules', 'factIndex.ts'));
const skip = hasBackend ? false : 'no ../roughbook-backend checkout beside the studio (as in CI)';

const lf = (text: string) => text.replace(/\r\n/g, '\n');

describe('the copied fact rules', () => {
  it('are what scripts/sync-facts.mjs makes from the backend now', { skip }, async () => {
    const script = pathToFileURL(path.join(studio, 'scripts', 'sync-facts.mjs')).href;
    const { generate } = (await import(script)) as {
      generate: (backendPath: string) => Map<string, string>;
    };
    const wanted = generate(backend);
    assert.deepEqual(fs.readdirSync(vendor).sort(), [...wanted.keys()].sort());
    for (const [name, content] of wanted) {
      assert.equal(
        lf(fs.readFileSync(path.join(vendor, name), 'utf8')),
        lf(content),
        `src/facts/vendor/${name} is out of step: run node scripts/sync-facts.mjs`
      );
    }
  });

  it('have shims that say what the backend says', { skip }, () => {
    const shared = fs.readFileSync(
      path.join(backend, 'src', 'utils', 'format', 'shared.ts'),
      'utf8'
    );
    assert.match(shared, new RegExp(`SHARED_PAGE_SLUG = '${SHARED_PAGE_SLUG}'`));
    const plan = fs.readFileSync(
      path.join(backend, 'src', 'utils', 'rules', 'sitePlan.ts'),
      'utf8'
    );
    const home = /HOME_PAGE_SLUG = '([^']+)'/.exec(plan)?.[1];
    const others = /HOME_SLUGS = new Set\(\[HOME_PAGE_SLUG, ([^\]]+)\]\)/.exec(plan)?.[1];
    assert.ok(home && others, 'sitePlan.ts still names its home slugs the same way');
    const slugs = [home, ...[...others.matchAll(/'([^']+)'/g)].map(match => match[1]!)];
    for (const slug of slugs) assert.equal(pagePath(slug), '/', slug);
    assert.equal(pagePath('clinics'), '/clinics');
  });
});
