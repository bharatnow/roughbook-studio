// Doctor's map-context check and the gate's look for the in-page view's switch
// (ROUGHBOOK-BROWNFIELD-PLAN.md, B5): each adopted section's iterations shown in their page inside
// their marker; the page without a swap showing the app's own, marked; the markers leaving its
// picture the same; and nothing of the switch in a production build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, it } from 'node:test';
import { contextCheck, hasMarker, type ContextGate } from '../doctor/context.js';
import { buildGate } from '../doctor/gate.js';
import type { DoctorTools } from '../doctor/types.js';
import { defaultEnvironment } from '../environment/read.js';
import { writeMap } from '../map/file.js';
import type { MapComponent, MapPage, RepoMap } from '../map/types.js';
import { recipeFor } from '../recipes/index.js';
import { CONTEXT_SENTINEL } from '../recipes/context.js';
import { contextFiles, editNextConfig } from '../recipes/next/context.js';
import { LAZY_IMPORT_FAULT } from '../recipes/next/fault.js';
import { pictureDifference, pngPixels } from '../snapshot/png.js';
import { tempDir } from './helpers.js';

const next = recipeFor('next')!;
const LINK = {
  version: 1 as const,
  orgId: 'org-1',
  project: 'site',
  roughCommitted: true,
  appDir: 'app'
};
const DEV = 'http://localhost:3000';

const write = (repo: string, file: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

const page = (slug: string, address: string | null, sections: string[]): MapPage => ({
  slug,
  name: slug,
  address,
  example: null,
  signIn: 'no',
  files: [],
  sections,
  byAgent: false
});
const component = (slug: string, file: string, exported: string): MapComponent => ({
  slug,
  name: slug,
  kind: 'section',
  files: [file],
  export: exported,
  fixture: null,
  alone: 'unknown',
  why: null,
  byAgent: false
});

const MAP: RepoMap = {
  version: 1,
  by: ['next'],
  pages: [page('pricing', '/pricing', ['pricing-section', 'faq'])],
  components: [
    component('pricing-section', 'components/pricing/pricing-section.tsx', 'PricingSection'),
    component('faq', 'components/pricing/faq.tsx', 'Faq')
  ],
  missed: [],
  unplaced: []
};

/** A mapped repo with the switch set up and two iterations of the pricing section. */
async function repo(options: { installed?: boolean } = {}): Promise<string> {
  const root = await tempDir('roughbook-context-doctor-');
  writeMap(root, MAP);
  write(root, 'app/layout.tsx', 'x');
  const config = 'const nextConfig = {};\n\nexport default nextConfig;\n';
  write(root, 'next.config.mjs', editNextConfig(config, 'next.config.mjs', 'app')!);
  if (options.installed !== false) {
    for (const item of contextFiles('app')) write(root, item.file, item.content);
  }
  for (const key of ['iteration-00', 'iteration-01', 'iteration-02']) {
    write(root, `rough/pricing/pricing-section/${key}/index.tsx`, 'x');
  }
  write(root, 'rough/pricing/faq/iteration-00/index.tsx', 'x');
  return root;
}

/** A one-pixel PNG of a colour. */
function png(rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, ...rgb]))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * The app's dev server with the switch: /pricing marks its sections, and a swap it knows shows
 * the iteration in its marker. `broken` swaps answer 500; `unmarked` leaves the markers out;
 * `shifts` makes the picture with markers differ from the one without.
 */
function tools(
  faults: {
    broken?: string[];
    lost?: string[];
    unmarked?: boolean;
    shifts?: boolean;
    moves?: boolean;
  } = {}
) {
  let shots = 0;
  const asked: string[] = [];
  let clock = 0;
  const fake: Partial<DoctorTools> = {
    browser: 'chrome',
    // Each look at the clock a minute on, so a page that never shows is given up on at once.
    now: () => (clock += 60_000),
    sleep: async () => {},
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      asked.push(`${url.pathname}${url.search}`);
      if (url.pathname !== '/pricing') return new Response('missing', { status: 404 });
      const swap = url.searchParams.get('roughbook-swap');
      if (swap && faults.broken?.includes(swap)) return new Response('Boom', { status: 500 });
      // Turbopack's error for an import its restart onto the old cache lost (B7b).
      if (swap && faults.lost?.includes(swap)) {
        return new Response(
          `<html><body><pre>Error: Lazily compiled dynamic import [project]/rough/${swap}/index.tsx [app-rsc] (ecmascript, async loader) was not activated</pre></body></html>`,
          { status: 500 }
        );
      }
      if (faults.unmarked) return new Response('<section>plans</section>');
      const marker = (key: string, swapped?: string) =>
        `<roughbook-section data-roughbook-section="${key}"${swapped ? ` data-roughbook-swap="${swapped}"` : ''} style="display:contents">`;
      const pricing = swap?.startsWith('pricing/pricing-section/')
        ? `${marker('pricing/pricing-section', swap)}<section>the fork</section></roughbook-section>`
        : `${marker('pricing/pricing-section')}<section>plans</section></roughbook-section>`;
      return new Response(`<main>${pricing}${marker('pricing/faq')}</roughbook-section></main>`);
    }) as typeof fetch,
    screenshot: async input => {
      const bare = new URL(input.url).searchParams.get('roughbook-markers') === '0';
      fs.mkdirSync(path.dirname(input.file), { recursive: true });
      shots += 1;
      // A page that moves on its own (an endless animation) differs from one picture to the next.
      const colour: [number, number, number] = faults.moves
        ? [shots % 256, 0, 0]
        : faults.shifts && !bare
          ? [255, 0, 0]
          : [255, 255, 255];
      fs.writeFileSync(input.file, png(colour));
      return true;
    }
  };
  return { asked, tools: fake as DoctorTools };
}

async function check(
  root: string,
  fake: DoctorTools,
  gate: ContextGate = { leaked: [], where: 'the production build' }
) {
  const shotsDir = path.join(root, '.shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  return contextCheck({
    repoRoot: root,
    environment: next.environment(LINK),
    recipe: next,
    tools: fake,
    base: DEV,
    shotsDir,
    gate,
    link: LINK
  });
}

describe('map-context', () => {
  it('passes when each iteration shows in its page in its marker, the page is marked without a swap, the pictures match and production is clean', async () => {
    const root = await repo();
    const fake = tools();
    const found = await check(root, fake.tools);
    assert.equal(found.status, 'pass', found.detail);
    assert.match(found.detail, /^2 of 2 iterations of 1 adopted section shown in its page/);
    assert.match(found.detail, /the markers leave 2 pictures the same/);
    assert.match(found.detail, /the production build holds nothing of the switch/);
    assert.deepEqual(
      fake.asked.filter(item => item.includes('swap')),
      [
        '/pricing?roughbook-swap=pricing/pricing-section/iteration-01',
        '/pricing?roughbook-swap=pricing/pricing-section/iteration-02'
      ]
    );
  });

  it('fails an iteration the page does not show, and a page whose sections are not marked', async () => {
    const root = await repo();
    const broken = await check(
      root,
      tools({ broken: ['pricing/pricing-section/iteration-02'] }).tools
    );
    assert.equal(broken.status, 'fail');
    assert.match(
      broken.detail,
      /pricing\/pricing-section\/iteration-02: \/pricing\?roughbook-swap=pricing\/pricing-section\/iteration-02 answered HTTP 500: Boom/
    );
    const unmarked = await check(root, tools({ unmarked: true }).tools);
    assert.equal(unmarked.status, 'fail');
    assert.match(unmarked.detail, /pricing\/pricing-section: \/pricing shows no marker naming it/);
  });

  it('fails when the markers change the page’s picture', async () => {
    const found = await check(await repo(), tools({ shifts: true }).tools);
    assert.equal(found.status, 'fail');
    assert.match(
      found.detail,
      /\/pricing at desktop looks different with its markers \(100\.00% of its pixels\)/
    );
  });

  it('does not blame the markers for a page that moves on its own, and names it', async () => {
    const found = await check(await repo(), tools({ moves: true }).tools);
    assert.equal(found.status, 'pass', found.detail);
    assert.match(found.detail, /the markers leave 0 pictures the same/);
    assert.match(
      found.detail,
      /\/pricing at desktop: not compared, the page moves on its own \(\d+\.\d{2}% of its pixels between two pictures without markers\)/
    );
  });

  it('fails when the switch reached production, and says when production was not checked', async () => {
    const root = await repo();
    const leaked = await check(root, tools().tools, {
      leaked: ['.next/static/chunks/app.js'],
      where: 'the production build'
    });
    assert.equal(leaked.status, 'fail');
    assert.match(
      leaked.detail,
      /the production build holds the switch: \.next\/static\/chunks\/app\.js/
    );
    const skipped = await check(root, tools().tools, {
      skipped: 'production was not checked for the switch (--skip-build)'
    });
    assert.equal(skipped.status, 'pass');
    assert.match(skipped.detail, /--skip-build/);
  });

  it('asks for setup --upgrade when the switch is not set up, and skips with nothing to show', async () => {
    const missing = await check(await repo({ installed: false }), tools().tools);
    assert.equal(missing.status, 'fail');
    assert.match(missing.fix ?? '', /roughbook setup --upgrade/);
    const root = await repo();
    fs.rmSync(path.join(root, 'rough/pricing/pricing-section/iteration-01'), { recursive: true });
    fs.rmSync(path.join(root, 'rough/pricing/pricing-section/iteration-02'), { recursive: true });
    const none = await check(root, tools().tools);
    assert.equal(none.status, 'skip');
    assert.match(none.detail, /no adopted section has an iteration yet/);
    const shopify = await contextCheck({
      repoRoot: root,
      environment: next.environment(LINK),
      recipe: recipeFor('shopify'),
      tools: tools().tools,
      base: DEV,
      shotsDir: root,
      gate: null,
      link: LINK
    });
    assert.equal(shopify.status, 'skip');
    assert.match(shopify.detail, /has no in-page view yet/);
  });

  it('names Turbopack’s lost lazy import and says to restart the dev server (decision 68)', async () => {
    const found = await check(
      await repo(),
      tools({ lost: ['pricing/pricing-section/iteration-02'] }).tools
    );
    assert.equal(found.status, 'fail');
    assert.match(
      found.detail,
      /pricing\/pricing-section\/iteration-02: \/pricing\?roughbook-swap=pricing\/pricing-section\/iteration-02 answered HTTP 500: Lazily compiled dynamic import … was not activated/
    );
    assert.ok(found.detail.includes(LAZY_IMPORT_FAULT.what), found.detail);
    assert.ok(found.fix?.startsWith(LAZY_IMPORT_FAULT.fix), found.fix ?? '');
    // Without it, the words are as they were.
    const broken = await check(
      await repo(),
      tools({ broken: ['pricing/pricing-section/iteration-02'] }).tools
    );
    assert.ok(!broken.detail.includes(LAZY_IMPORT_FAULT.what));
    assert.ok(!broken.fix?.includes(LAZY_IMPORT_FAULT.fix));
  });

  it('asks for setup --upgrade when next.config’s block leaves Turbopack’s development cache on (decision 67)', async () => {
    const root = await repo();
    const config = path.join(root, 'next.config.mjs');
    const current = fs.readFileSync(config, 'utf8');
    fs.writeFileSync(config, current.replace(', turbopackFileSystemCacheForDev: false', ''));
    const found = await check(root, tools().tools);
    assert.equal(found.status, 'fail');
    assert.match(
      found.detail,
      /^next\.config\.mjs: the switch's block leaves Turbopack's development cache on \(it has no turbopackFileSystemCacheForDev: false\)/
    );
    // The swaps are still asked for.
    assert.match(found.detail, /2 of 2 iterations of 1 adopted section shown/);
    assert.match(found.fix ?? '', /^Run roughbook setup --upgrade, which rewrites the block/);
    fs.writeFileSync(config, current);
    assert.equal((await check(root, tools().tools)).status, 'pass');
  });

  it('reads a marker by its key and the iteration it says it swapped in', () => {
    const html =
      '<roughbook-section data-roughbook-section="a/b" data-roughbook-swap="a/b/iteration-01" style="display:contents">';
    assert.ok(hasMarker(html, 'a/b'));
    assert.ok(hasMarker(html, 'a/b', 'a/b/iteration-01'));
    assert.ok(!hasMarker(html, 'a/b', null));
    assert.ok(!hasMarker(html, 'a/c'));
  });

  it('says what the recipe notes of its in-page view, passing or failing', async () => {
    const note = 'Native screens show components alone; In its page is the web target’s.';
    const noted = { ...next, contextPreview: { ...next.contextPreview!, note } };
    const root = await repo();
    const shotsDir = path.join(root, '.shots');
    fs.mkdirSync(shotsDir, { recursive: true });
    const run = (fake: DoctorTools) =>
      contextCheck({
        repoRoot: root,
        environment: next.environment(LINK),
        recipe: noted,
        tools: fake,
        base: DEV,
        shotsDir,
        gate: { leaked: [], where: 'the production build' },
        link: LINK
      });
    const passed = await run(tools().tools);
    assert.equal(passed.status, 'pass', passed.detail);
    assert.ok(passed.detail.endsWith(` ${note}`), passed.detail);
    const failed = await run(tools({ unmarked: true }).tools);
    assert.equal(failed.status, 'fail');
    assert.ok(failed.detail.endsWith(` ${note}`), failed.detail);
    // Without a note, the detail is as it was.
    assert.ok(!(await check(root, tools().tools)).detail.includes(note));
  });
});

describe('the gate and the switch', () => {
  it('finds the switch’s sentinel in a production build’s output, and fails the gate for it', async () => {
    const root = await tempDir('roughbook-context-gate-');
    const environment = {
      ...defaultEnvironment(),
      build: { command: 'npm run build', output: ['.next/server'] }
    };
    const exec = async () => {
      write(root, '.next/server/app/page.js', `function x(){return "${CONTEXT_SENTINEL}"}`);
      return { code: 0 };
    };
    const found = await buildGate(
      root,
      environment,
      { exec },
      'roughbook-doctor-1234',
      CONTEXT_SENTINEL
    );
    assert.deepEqual(found.switchLeaked, ['.next/server/app/page.js']);
    assert.match(
      found.problems.join(' '),
      /holds the in-page view's switch: \.next\/server\/app\/page\.js/
    );
    const clean = await buildGate(
      root,
      environment,
      {
        exec: async () => {
          fs.rmSync(path.join(root, '.next'), { recursive: true, force: true });
          write(root, '.next/server/app/page.js', 'function x(){}');
          return { code: 0 };
        }
      },
      'roughbook-doctor-1234',
      CONTEXT_SENTINEL
    );
    assert.deepEqual(clean.switchLeaked, []);
    assert.deepEqual(clean.problems, []);
    // A recipe with no switch: nothing is looked for.
    const none = await buildGate(root, environment, { exec: async () => ({ code: 0 }) }, 'x');
    assert.equal(none.switchLeaked, null);
  });
});

describe('comparing two pictures', () => {
  it('reads a PNG’s pixels and the share of them that differ', () => {
    assert.deepEqual([...pngPixels(png([1, 2, 3]))!.data], [1, 2, 3, 255]);
    assert.equal(pictureDifference(png([1, 2, 3]), png([1, 2, 3])), 0);
    assert.equal(pictureDifference(png([1, 2, 3]), png([1, 2, 4])), 1);
    assert.equal(pictureDifference(png([1, 2, 3]), Buffer.from('not a png')), 1);
  });
});
