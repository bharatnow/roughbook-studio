// Assets from the web in a studio run (ROUGHBOOK-STUDIO-PARITY-PLAN.md, T5): fetch_asset copies a
// confirmed asset's bytes, from the backend, into the run's own folder, and proposes one by its
// address and the agent's words. The backend is fakeFetch; nothing reaches the network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { readRun, saveRun } from '../runs/store.js';
import { writeWebAsset } from '../runs/webAsset.js';
import { ASSET, FOLDER, RUN, RUN_ASSETS, BYTES, assetRun, view } from './assetRun.js';

describe('fetch_asset in a studio run', () => {
  it('copies a confirmed asset from the backend into the run folder, with its attribution', async () => {
    const { repo, backend, fetchAsset } = await assetRun();
    const listed = await fetchAsset({ action: 'list' });
    assert.deepEqual(
      listed.confirmed.map((item: { asset: string }) => item.asset),
      [ASSET]
    );

    const answer = await fetchAsset({ action: 'get', asset: ASSET });
    const file = path.join(repo, ...FOLDER.split('/'), 'assets', 'inter-variable.woff2');
    assert.equal(fs.readFileSync(file, 'utf8'), BYTES);
    assert.equal(answer.file, `${FOLDER}/assets/inter-variable.woff2`);
    assert.equal(answer.import, './assets/inter-variable.woff2');
    assert.equal(answer.licence, 'OFL-1.1');
    assert.equal(answer.source, 'https://fonts.example.org/Inter-Variable.woff2');
    assert.equal(
      answer.attribution,
      'inter-variable.woff2: OFL-1.1, from https://fonts.example.org/Inter-Variable.woff2'
    );
    assert.match(answer.next, /never from https:\/\/fonts\.example\.org/);

    // The bytes came from the backend; nothing went to the source, and the GETs carry no body.
    assert.deepEqual(
      backend.requests.map(request => `${request.method} ${request.url}`),
      [`GET ${RUN_ASSETS}`, `GET ${RUN_ASSETS}`, `GET ${RUN_ASSETS}/${ASSET}/file`]
    );
    assert.ok(backend.requests.every(request => request.body === null));
    // Named by its source address too.
    await fetchAsset({ action: 'get', asset: 'https://fonts.example.org/Inter-Variable.woff2' });
  });

  it('proposes by address and words alone, and copies an address already confirmed', async () => {
    const { repo, backend, fetchAsset } = await assetRun();
    const pending = await fetchAsset({
      action: 'propose',
      url: 'https://models.example.org/chair.glb',
      reason: 'The product in the hero',
      licence: 'CC0'
    });
    assert.equal(pending.status, 'pending');
    assert.match(pending.next, /cannot be used until they confirm it/);
    assert.deepEqual(backend.requests[0]!.body, {
      url: 'https://models.example.org/chair.glb',
      reason: 'The product in the hero',
      licence: 'CC0'
    });
    assert.equal(fs.existsSync(path.join(repo, ...FOLDER.split('/'), 'assets')), false);

    const known = await fetchAsset({
      action: 'propose',
      url: 'https://fonts.example.org/Inter-Variable.woff2',
      reason: 'The headline face',
      licence: 'OFL-1.1'
    });
    assert.equal(known.import, './assets/inter-variable.woff2');
  });

  it("relays the backend's refusal in words: a bad address, another organization's run", async () => {
    const { fetchAsset, tool, call } = await assetRun();
    await assert.rejects(
      fetchAsset({
        action: 'propose',
        url: 'http://inside.test/x.png',
        reason: 'x',
        licence: 'CC0'
      }),
      /^Error: Only https addresses can be fetched\. Carry on without it\.$/
    );
    await assert.rejects(
      tool.call({ run: RUN, action: 'get', asset: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, call),
      /No confirmed asset matches/
    );
    // A run the backend does not know for this install, such as another organization's.
    const theirs = await assetRun({ refuseRun: true });
    await assert.rejects(
      theirs.fetchAsset({ action: 'list' }),
      /RUN_NOT_FOUND Carry on without it/
    );
    await assert.rejects(theirs.fetchAsset({ action: 'get', asset: ASSET }), /RUN_NOT_FOUND/);
    assert.equal(fs.existsSync(path.join(theirs.repo, ...FOLDER.split('/'), 'assets')), false);
    await assert.rejects(
      fetchAsset({ action: 'propose', url: 'https://a.example/x.png', reason: '', licence: '' }),
      /propose needs reason, licence/
    );
  });

  it('refuses a finished run without asking the backend', async () => {
    const { repo, backend, fetchAsset } = await assetRun();
    const run = (await readRun(repo, RUN))!;
    await saveRun(repo, { ...run, status: 'finished', finishedAt: '2026-11-28T00:00:00.000Z' });
    await assert.rejects(fetchAsset({ action: 'list' }), /is finished/);
    assert.equal(backend.requests.length, 0);
  });

  it('writes only a safe name inside the run folder, within the caps and the size on record', async () => {
    const { repo, fetchAsset } = await assetRun({ asset: view({ fileName: '../../src/evil.js' }) });
    await assert.rejects(fetchAsset({ action: 'get', asset: ASSET }), /not one the studio writes/);
    assert.equal(fs.existsSync(path.join(repo, 'src', 'evil.js')), false);

    const short = await assetRun({ bytes: 'short' });
    await assert.rejects(
      short.fetchAsset({ action: 'get', asset: ASSET }),
      /not the size on record/
    );

    const big = Buffer.alloc(15 * 1024 * 1024 + 1);
    assert.throws(
      () =>
        writeWebAsset(
          repo,
          FOLDER,
          { fileName: 'a.png', size: null, contentType: 'image/png' },
          big
        ),
      /over the 15 MB/
    );
    assert.throws(
      () =>
        writeWebAsset(
          repo,
          'src/app',
          { fileName: 'a.png', size: 1, contentType: 'image/png' },
          Buffer.from('a')
        ),
      /not inside rough/
    );
    assert.throws(
      () =>
        writeWebAsset(
          repo,
          'rough/../src',
          { fileName: 'a.png', size: 1, contentType: 'image/png' },
          Buffer.from('a')
        ),
      /not inside rough/
    );
    for (const name of ['.env', 'a/b.png', 'a\\b.png', 'C:x.png', 'noext', '..png']) {
      assert.throws(
        () =>
          writeWebAsset(
            repo,
            FOLDER,
            { fileName: name, size: 1, contentType: 'image/png' },
            Buffer.from('a')
          ),
        /not one the studio writes/,
        name
      );
    }
  });
});
