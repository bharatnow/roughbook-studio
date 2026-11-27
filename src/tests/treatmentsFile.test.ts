import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { StudioApi } from '../api/client.js';
import { flutter } from '../recipes/flutter/index.js';
import type { RepoLink } from '../repo/link.js';
import { syncMirror } from '../repo/mirror.js';
import { TREATMENTS_FILE } from '../repo/root.js';
import { inScope, startRuns } from '../runs/lifecycle.js';
import type { StartRunRequest, StartedRun } from '../runs/types.js';
import { fakeFetch, ok, refused, tempDir, type RecordedRequest } from './helpers.js';

// The treatments' stylesheet (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T3): written whole at
// rough/look/treatments.css from each start's answer, changed when the answer changes, removed
// when the project has none, and left alone by a backend from before it.

const ORG = '11111111-1111-4111-8111-111111111111';
const LINK: RepoLink = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: 'src/app'
};
const GENERATE: StartRunRequest = {
  page: 'home',
  component: 'hero',
  agent: 'claude-code',
  mode: 'interactive',
  kind: 'generate',
  directions: [{ direction: 'Glassy' }]
};
const GLASS = [
  ':where(:root) {',
  '  --look-surface: #ffffff;',
  '}',
  '',
  "/* Treatments: the maker's chosen look (SP5). */",
  '/* rb-t-glass-chrome */',
  '.rb-t-glass-chrome { background: var(--look-surface); }',
  ''
].join('\r\n');

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

async function setup() {
  const repo = path.join(await tempDir('roughbook-treatments-'), 'app');
  write(repo, 'package.json', '{}');
  write(repo, 'src/app/page.tsx', 'export default function Page() { return null; }\n');
  write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
  let number = 0;
  let answer: StartedRun['treatments'];
  const fake = fakeFetch((request: RecordedRequest) => {
    if (!request.url.endsWith('/runs')) return refused('NOT_FOUND', 404);
    number += 1;
    const iteration = `iteration-0${number}`;
    const run: StartedRun = {
      runId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${number}`,
      iteration,
      parent: null,
      targetFolder: `rough/home/hero/${iteration}`,
      prompt: '<task>\nGenerate.\n</task>\n',
      checks: [{ kind: 'entry-file', file: 'index.tsx' }],
      ...(answer === undefined ? {} : { treatments: answer })
    };
    return ok([run], 201);
  });
  const api = new StudioApi({
    server: 'http://localhost:4000',
    token: 'rbi_token',
    userAgent: 'roughbook-studio/test',
    fetch: fake.fetch
  });
  const file = path.join(repo, ...TREATMENTS_FILE.split('/'));
  return {
    repo,
    file,
    requests: fake.requests,
    start: async (treatments: StartedRun['treatments']) => {
      answer = treatments;
      await startRuns(repo, api, LINK, GENERATE);
    }
  };
}

describe('the treatments stylesheet', () => {
  it('is written whole on a start, follows a changed treatment, and goes with the last one', async () => {
    const { file, start, requests } = await setup();
    assert.equal(TREATMENTS_FILE, 'rough/look/treatments.css');

    // No treatment: no file.
    await start(null);
    assert.ok(!fs.existsSync(file));

    await start({ css: GLASS, version: 'aaaaaaaaaaaa' });
    const first = fs.readFileSync(file, 'utf8');
    assert.match(first, /\.rb-t-glass-chrome \{ background: var\(--look-surface\); \}/);
    assert.match(first, /^ {2}--look-surface: #ffffff;$/m);
    assert.ok(!first.includes('\r'), 'written with \\n line endings');
    assert.ok(first.endsWith('}\n'));
    // Nothing is left beside it from the whole write.
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['treatments.css']);

    // A changed treatment reaches the next start.
    await start({ css: GLASS.replace('var(--look-surface)', 'var(--look-brand)'), version: 'b' });
    assert.match(fs.readFileSync(file, 'utf8'), /background: var\(--look-brand\)/);

    // A backend from before it says nothing: the file stays as it was.
    await start(undefined);
    assert.match(fs.readFileSync(file, 'utf8'), /var\(--look-brand\)/);

    // The project's last treatment removed: so is the file.
    await start(null);
    assert.ok(!fs.existsSync(file));
    // The CSS came from the backend's answer; no request carried it there.
    for (const request of requests) {
      assert.ok(!JSON.stringify(request.body ?? '').includes('rb-t-'), request.url);
    }
  });

  it("is the studio's own file, never a run's change, and mirrored where an import finds it", async () => {
    assert.ok(inScope(TREATMENTS_FILE, [], []));
    assert.ok(!inScope('rough/look/other.css', [], []));

    const repo = await tempDir('roughbook-treatments-mirror-');
    write(repo, 'rough/home/hero/iteration-01/index.tsx', 'x\n');
    write(repo, TREATMENTS_FILE, GLASS);
    const environment = { ...flutter.environment(null), entry: 'index.tsx' };
    assert.equal(environment.placement.kind, 'in-tree');
    const mirror =
      environment.placement.kind === 'in-tree' ? environment.placement.path : 'unreachable';
    const mirrored = path.join(repo, ...mirror.split('/'), 'look', 'treatments.css');
    syncMirror(repo, environment);
    assert.equal(fs.readFileSync(mirrored, 'utf8'), GLASS);
    // The iteration's import, ../../../look/treatments.css, lands on it from the mirror too.
    const from = path.join(repo, ...mirror.split('/'), 'home', 'hero', 'iteration-01');
    assert.equal(path.resolve(from, '../../../look/treatments.css'), mirrored);
    assert.ok(fs.existsSync(path.join(from, 'index.tsx')));
    fs.rmSync(path.join(repo, ...TREATMENTS_FILE.split('/')));
    syncMirror(repo, environment);
    assert.ok(!fs.existsSync(path.dirname(mirrored)), 'the empty look folder goes too');
  });
});
