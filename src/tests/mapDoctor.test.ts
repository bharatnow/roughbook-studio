// Doctor's map checks (ROUGHBOOK-BROWNFIELD-PLAN.md, B1): with rough/map.md in the repo, each page
// is asked at its address, each section and shared part is rendered alone with its fixture and must
// say it is ready, and their screenshots must come out clean. What cannot be checked is named, with
// the reason; what the map says works and does not is a failure. A repo with no map gets none of it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runDoctor } from '../doctor/run.js';
import type { DoctorReport, DoctorTools, Probe } from '../doctor/types.js';
import { readEnvironmentSync } from '../environment/read.js';
import { renderMap } from '../map/file.js';
import type { MapComponent, MapPage, RepoMap } from '../map/types.js';
import { LAZY_IMPORT_NOTICE } from '../recipes/next/fault.js';
import { next } from '../recipes/next/index.js';
import { approveCommands, environmentCommands } from '../repo/approvals.js';
import { applyPrep, planPrep } from '../repo/prep.js';
import { settledScript } from '../screenshot/browser.js';
import { tempDir } from './helpers.js';

const LINK = {
  version: 1 as const,
  orgId: 'org-1',
  project: 'site',
  roughCommitted: true,
  appDir: 'app'
};
const DEV = 'http://localhost:3000';

function page(slug: string, address: string | null, extra: Partial<MapPage> = {}): MapPage {
  return {
    slug,
    name: slug,
    address,
    example: null,
    signIn: 'unknown',
    files: [],
    sections: [],
    byAgent: false,
    ...extra
  };
}

function component(slug: string, extra: Partial<MapComponent> = {}): MapComponent {
  return {
    slug,
    name: slug,
    kind: 'section',
    files: [`components/${slug}.tsx`],
    export: 'default',
    fixture: null,
    alone: 'unknown',
    why: null,
    byAgent: false,
    ...extra
  };
}

const MAP: RepoMap = {
  version: 1,
  by: ['next'],
  pages: [
    page('shared', null, { sections: ['site-header'] }),
    page('home', '/', { sections: ['hero', 'pricing'] }),
    page('blog-slug', '/blog/[slug]', { sections: [] }),
    page('post', '/posts/[id]', { example: '/posts/1' }),
    page('account', '/account', { signIn: 'yes' })
  ],
  components: [
    component('site-header', { kind: 'shared', alone: 'yes' }),
    component('hero', { fixture: 'rough/map/fixtures/hero/preview.json', alone: 'yes' }),
    component('pricing', { alone: 'no', why: 'It fetches the plans on the server.' }),
    component('button', { kind: 'atom', files: ['components/ui/button.tsx'] })
  ],
  missed: [],
  unplaced: []
};

async function mappedRepo(map: RepoMap): Promise<string> {
  const repo = await tempDir('roughbook-map-doctor-');
  fs.mkdirSync(path.join(repo, 'app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"app"}\n');
  applyPrep(planPrep(repo, { link: LINK, recipe: next }));
  await approveCommands(repo, environmentCommands(readEnvironmentSync(repo, LINK)));
  fs.writeFileSync(path.join(repo, 'rough', 'map.md'), renderMap(map));
  fs.mkdirSync(path.join(repo, 'rough', 'map', 'fixtures', 'hero'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'rough', 'map', 'fixtures', 'hero', 'preview.json'),
    '{ "title": "Plan less" }\n'
  );
  return repo;
}

/** What a component's iteration under doctor's map page holds, read back while doctor runs. */
function pointerFiles(repo: string, slug: string): string {
  const rough = path.join(repo, 'rough');
  const own = fs.readdirSync(rough).find(entry => /^doctor-check-[a-z0-9]+-map$/.test(entry));
  const dir = own ? path.join(rough, own, slug, 'iteration-01') : '';
  return own && fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .map(file => `${file}: ${fs.readFileSync(path.join(dir, file), 'utf8')}`)
        .join('\n')
    : '';
}

/**
 * A dev server with the sample iterations doctor writes, and the app's own pages: `/` answers,
 * `/posts/1` answers, `/missing` does not, and `/dashboard` sends a stranger to the sign-in page.
 * A component's iteration renders unless the test names it broken.
 */
function tools(
  repo: string,
  faults: {
    broken?: string[];
    /** Components whose preview answers Turbopack's lost lazy import (B7b). */
    lost?: string[];
    pages?: Record<string, number>;
    overlay?: boolean;
    /** Where a page's own code sends the browser once it has loaded, by the page's path. */
    guard?: Record<string, string>;
    /** Where the app's code sends the browser from every map preview: a guard in its layout. */
    guardPreviews?: string;
    /** Where the app's server sends every map preview, before anything renders. */
    redirectPreviews?: string;
  } = {}
): DoctorTools & { asked: string[]; shots: string[]; probes: string[] } {
  const asked: string[] = [];
  const shots: string[] = [];
  const probes: string[] = [];
  let clock = 0;
  const sampleFiles = (iteration: string) => {
    const rough = path.join(repo, 'rough');
    const own = fs.readdirSync(rough).find(entry => /^doctor-check-[a-z0-9]+$/.test(entry));
    const dir = own ? path.join(rough, own, 'sample', iteration) : '';
    return own && fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .map(file => fs.readFileSync(path.join(dir, file), 'utf8'))
          .join('\n')
      : '';
  };
  const answer = (url: URL): { status: number; body: string; location?: string } => {
    const sample = /^\/rough-preview\/doctor-check-[a-z0-9]+\/sample\/(iteration-\d+)$/.exec(
      url.pathname
    );
    if (sample) {
      const files = sampleFiles(sample[1]!);
      if (sample[1] === 'iteration-02') return { status: 500, body: 'boom' };
      if (!files) return { status: 404, body: 'none' };
      const marker = /roughbook-doctor-[a-z0-9-]+/.exec(files)?.[0] ?? '';
      const fixture = /"note": "([^"]+)"/.exec(files)?.[1] ?? '';
      return { status: 200, body: `<main>${marker} ${fixture}</main>` };
    }
    const pointer =
      /^\/rough-preview\/doctor-check-[a-z0-9]+-map\/([a-z0-9-]+)\/iteration-01$/.exec(
        url.pathname
      );
    if (pointer) {
      if (!pointerFiles(repo, pointer[1]!)) return { status: 404, body: 'none' };
      if (faults.redirectPreviews) {
        return { status: 307, body: '', location: faults.redirectPreviews };
      }
      if (faults.lost?.includes(pointer[1]!)) {
        return {
          status: 500,
          body: `Lazily compiled dynamic import of [project]/rough/doctor-check-map/${pointer[1]}/iteration-01/index.tsx [app-rsc] (ecmascript, lazy compilation proxy FollowReexports(None)) was not activated`
        };
      }
      return faults.broken?.includes(pointer[1]!)
        ? { status: 500, body: 'TypeError: plans is undefined' }
        : { status: 200, body: `<section>${pointer[1]}</section>` };
    }
    const status = faults.pages?.[url.pathname];
    if (status !== undefined) return { status, body: `HTTP ${status}` };
    if (url.pathname === '/dashboard') return { status: 307, body: '', location: '/login' };
    if (['/', '/posts/1', '/login'].includes(url.pathname)) return { status: 200, body: 'page' };
    return { status: 404, body: 'not found' };
  };
  return {
    asked,
    shots,
    probes,
    browser: '/fake/chrome',
    which: program => `/fake/bin/${program}`,
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : String(input));
      asked.push(url.pathname);
      const page = answer(url);
      return new Response(page.body, {
        status: page.status,
        headers: page.location ? { location: page.location } : {}
      });
    }) as typeof fetch,
    async probe({ url, waitMs }) {
      const at = new URL(url);
      probes.push(`${at.pathname}${waitMs ? ` ${waitMs}` : ''}`);
      // The browser follows the server's redirect, then the app's own code may send it on.
      const first = answer(at);
      const landed = first.location ? new URL(first.location, at) : at;
      const sent = /-map\//.test(landed.pathname)
        ? faults.guardPreviews
        : faults.guard?.[landed.pathname];
      const end = sent ? new URL(sent, at) : landed;
      const page = sent || first.location ? answer(end) : first;
      const probe: Probe = {
        shows: true,
        ready: page.status === 200 && !sent && !first.location,
        error: page.status >= 400 ? page.body : null,
        visibleOverlays: faults.overlay ? 1 : 0,
        exceptions: [],
        text: page.body.replace(/<[^>]+>/g, ' '),
        path: end.pathname
      };
      return probe;
    },
    async screenshot({ file, waitMs }) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'png');
      shots.push(`${path.basename(file)}${waitMs ? ` ${waitMs}` : ''}`);
      return true;
    },
    exec: async () => ({ code: 0 }),
    serve: async () => null,
    snapshot: async () => ({ code: 1, output: '' }),
    addresses: () => [],
    sleep: async () => {},
    now: () => (clock += 1000)
  };
}

function check(report: DoctorReport, id: string) {
  const found = report.checks.find(item => item.id === id);
  assert.ok(found, `no ${id} check: ${report.checks.map(item => item.id).join(', ')}`);
  return found;
}

describe("doctor's map checks", () => {
  it('pass when every page answers and every section renders, naming what cannot be checked', async () => {
    const repo = await mappedRepo(MAP);
    const fake = tools(repo);
    const report = await runDoctor(repo, { devUrl: DEV, skipBuild: true, tools: fake });
    const pages = check(report, 'map-pages');
    assert.equal(pages.status, 'pass', pages.detail);
    assert.match(pages.detail, /2 of 4 pages answered at their addresses/);
    assert.match(pages.detail, /blog-slug: no example address/);
    assert.match(pages.detail, /behind a sign-in, not asked \(decision 13\): account\b/);
    const components = check(report, 'map-components');
    assert.equal(components.status, 'pass', components.detail);
    assert.match(components.detail, /2 of 3 sections and shared parts rendered alone/);
    assert.match(components.detail, /pricing: does not render alone: It fetches the plans/);
    assert.match(components.detail, /1 atom is the design system/);
    // The hero was rendered through a pointer to the real file, with its fixture.
    assert.ok(fake.asked.some(item => /-map\/hero\/iteration-01$/.test(item)));
    const shots = check(report, 'map-screenshots');
    assert.equal(shots.status, 'pass', shots.detail);
    // Two components and two pages, at the recipe's two viewports: the app's own pages, which never
    // say ready, after a short wait; the pointers' previews, which do, after theirs.
    const mapShots = fake.shots.filter(shot => /^(page|component)-/.test(shot));
    assert.deepEqual(mapShots.sort(), [
      'component-hero-desktop.png',
      'component-hero-mobile.png',
      'component-site-header-desktop.png',
      'component-site-header-mobile.png',
      'page-home-desktop.png 5000',
      'page-home-mobile.png 5000',
      'page-post-desktop.png 5000',
      'page-post-mobile.png 5000'
    ]);
    assert.equal(report.outcome, 'unverified');
    // The checks come after the contract's, and doctor's map page is gone afterwards.
    assert.deepEqual(
      report.checks.slice(-4).map(item => item.id),
      ['map-pages', 'map-components', 'map-screenshots', 'map-context']
    );
    assert.ok(
      !fs.readdirSync(path.join(repo, 'rough')).some(entry => entry.startsWith('doctor-check'))
    );
  });

  it('wrote the pointer as the app has the component, with its fixture', async () => {
    const repo = await mappedRepo(MAP);
    let seen = '';
    const fake = tools(repo);
    const probe = fake.probe;
    fake.probe = async input => {
      if (input.url.includes('-map/hero/')) seen = pointerFiles(repo, 'hero');
      return probe(input);
    };
    await runDoctor(repo, { devUrl: DEV, skipBuild: true, tools: fake });
    assert.match(
      seen,
      /index\.tsx: .*\nexport \{ default \} from "\.\.\/\.\.\/\.\.\/\.\.\/components\/hero";/
    );
    assert.match(seen, /preview\.json: \{ "title": "Plan less" \}/);
  });

  it('fail on a page that does not answer and a component that does not render', async () => {
    const repo = await mappedRepo({
      ...MAP,
      pages: [
        ...MAP.pages,
        page('gone', '/missing'),
        page('dashboard', '/dashboard', { signIn: 'no' })
      ]
    });
    const report = await runDoctor(repo, {
      devUrl: DEV,
      skipBuild: true,
      tools: tools(repo, { broken: ['hero'] })
    });
    const pages = check(report, 'map-pages');
    assert.equal(pages.status, 'fail');
    assert.match(pages.detail, /gone: \/missing answered HTTP 404/);
    assert.match(
      pages.detail,
      /dashboard: \/dashboard sends a visitor to \/login, but the map says it needs no sign-in/
    );
    assert.ok(pages.fix);
    const components = check(report, 'map-components');
    assert.equal(components.status, 'fail');
    assert.match(
      components.detail,
      /hero: the map says it renders alone, but it failed: TypeError: plans is undefined/
    );
    assert.equal(report.outcome, 'fail');
  });

  it('name a redirect and a failure the map has no word on yet, and fail on overlays', async () => {
    const repo = await mappedRepo({
      ...MAP,
      pages: [...MAP.pages, page('dashboard', '/dashboard')],
      components: MAP.components.map(item =>
        item.slug === 'hero' ? { ...item, alone: 'unknown' as const } : item
      )
    });
    const report = await runDoctor(repo, {
      devUrl: DEV,
      skipBuild: true,
      tools: tools(repo, { broken: ['hero'], overlay: true })
    });
    const pages = check(report, 'map-pages');
    assert.equal(pages.status, 'pass', pages.detail);
    assert.match(
      pages.detail,
      /sent to \/login, behind a sign-in, so not pictured \(decision 13\): dashboard\b/
    );
    const components = check(report, 'map-components');
    assert.equal(components.status, 'pass', components.detail);
    assert.match(
      components.detail,
      /hero: does not render alone yet: TypeError: plans is undefined/
    );
    assert.equal(check(report, 'map-screenshots').status, 'fail');
  });

  it('name Turbopack’s lost lazy import with what it is and what to do (B7b, decision 68)', async () => {
    const repo = await mappedRepo({
      ...MAP,
      components: MAP.components.map(item =>
        item.slug === 'hero' ? { ...item, alone: 'unknown' as const } : item
      )
    });
    const report = await runDoctor(repo, {
      devUrl: DEV,
      skipBuild: true,
      tools: tools(repo, { lost: ['hero'] })
    });
    const components = check(report, 'map-components');
    assert.equal(components.status, 'pass', components.detail);
    assert.match(
      components.detail,
      /hero: does not render alone yet: Lazily compiled dynamic import … was not activated[;.]/
    );
    assert.ok(components.detail.endsWith(` ${LAZY_IMPORT_NOTICE}`), components.detail);
  });

  it('name a page whose own code sends the browser to sign in, at once and with no picture', async () => {
    const repo = await mappedRepo({
      ...MAP,
      pages: [
        ...MAP.pages,
        page('settings', '/settings'),
        page('users', '/users'),
        page('reports', '/reports', { signIn: 'no' }),
        page('docs', '/docs')
      ]
    });
    // Each answers HTTP 200; the app's guard sends the browser on once the page has loaded.
    const fake = tools(repo, {
      pages: { '/settings': 200, '/users': 200, '/reports': 200, '/docs': 200 },
      guard: {
        '/settings': '/login',
        '/users': '/login',
        '/reports': '/login',
        '/docs': '/docs/intro'
      }
    });
    const report = await runDoctor(repo, { devUrl: DEV, skipBuild: true, tools: fake });
    const pages = check(report, 'map-pages');
    assert.equal(pages.status, 'fail');
    assert.match(
      pages.detail,
      /reports: \/reports sends a visitor to \/login, but the map says it needs no sign-in/
    );
    assert.match(
      pages.detail,
      /sent to \/login, behind a sign-in, so not pictured \(decision 13\): settings, users\b/
    );
    assert.match(
      pages.detail,
      /docs: \/docs sends a visitor on to \/docs\/intro, so it is not pictured/
    );
    assert.match(pages.detail, /2 of 8 pages answered at their addresses/);
    // Each page was asked once in the browser, with an app page's short wait, and none of those
    // sent elsewhere was photographed.
    for (const address of ['/settings', '/users', '/reports', '/docs']) {
      assert.deepEqual(
        fake.probes.filter(item => item.split(' ')[0] === address),
        [`${address} 5000`]
      );
    }
    assert.ok(!fake.shots.some(shot => /^page-(settings|users|reports|docs)-/.test(shot)));
    assert.ok(fake.shots.includes('page-home-desktop.png 5000'));
  });

  it("name the sections whose previews the app's guard sends to sign in, asking each once", async () => {
    const repo = await mappedRepo(MAP);
    const fake = tools(repo, { guardPreviews: '/login' });
    const report = await runDoctor(repo, { devUrl: DEV, skipBuild: true, tools: fake });
    const components = check(report, 'map-components');
    // The map says they render alone, but a sign-in stands in the way: named, not failed.
    assert.equal(components.status, 'pass', components.detail);
    assert.match(components.detail, /0 of 3 sections and shared parts rendered alone/);
    assert.match(
      components.detail,
      /previews sent to \/login, behind a sign-in, so not rendered alone or pictured \(decision 13\): site-header, hero\b/
    );
    assert.match(components.detail, /pricing: does not render alone: It fetches the plans/);
    // One visit each: the wait ended when the page left for the sign-in page.
    assert.equal(fake.probes.filter(item => /-map\//.test(item)).length, 2);
    assert.ok(!fake.shots.some(shot => shot.startsWith('component-')));
    assert.equal(check(report, 'map-screenshots').status, 'pass');
  });

  it('name the sections whose previews the server sends to sign in, without the browser', async () => {
    const repo = await mappedRepo(MAP);
    const fake = tools(repo, { redirectPreviews: '/login?next=/rough-preview' });
    const report = await runDoctor(repo, { devUrl: DEV, skipBuild: true, tools: fake });
    const components = check(report, 'map-components');
    assert.equal(components.status, 'pass', components.detail);
    assert.match(
      components.detail,
      /previews sent to \/login, behind a sign-in, so not rendered alone or pictured \(decision 13\): site-header, hero\b/
    );
    assert.equal(fake.probes.filter(item => /-map\//.test(item)).length, 0);
  });

  it("end the browser's wait when the page leaves its address", async () => {
    const window: { __roughbookReady?: boolean } = {};
    const settled = (pathname: string) =>
      new Function('window', 'document', 'location', `return ${settledScript(60_000, '/a/b/')};`)(
        window,
        { getAnimations: () => [] },
        { pathname }
      ) as Promise<boolean>;
    const within = (promise: Promise<boolean>) =>
      Promise.race([promise, new Promise(resolve => setTimeout(() => resolve('waiting'), 400))]);
    // Sent to the sign-in page: settled at once, not after the minute.
    assert.equal(await within(settled('/login')), true);
    // Still at its address, a trailing slash aside: it waits for the ready message.
    const staying = settled('/a/b');
    assert.equal(await within(staying), 'waiting');
    window.__roughbookReady = true;
    assert.equal(await staying, true);
  });

  it('fail on a map that does not read, and say how to write it again', async () => {
    const repo = await mappedRepo(MAP);
    fs.writeFileSync(path.join(repo, 'rough', 'map.md'), '---\npages:\n  - name: Home\n---\n');
    const report = await runDoctor(repo, { devUrl: DEV, skipBuild: true, tools: tools(repo) });
    const pages = check(report, 'map-pages');
    assert.equal(pages.status, 'fail');
    assert.match(pages.detail, /a page needs its slug/);
    assert.match(pages.fix!, /roughbook map/);
    assert.equal(check(report, 'map-components').status, 'skip');
  });

  it('are not there for a repo with no map', async () => {
    const repo = await mappedRepo(MAP);
    fs.rmSync(path.join(repo, 'rough', 'map.md'));
    const report = await runDoctor(repo, { devUrl: DEV, skipBuild: true, tools: tools(repo) });
    assert.ok(!report.checks.some(item => item.id.startsWith('map-')));
    // And skipped, with the reason, when the app does not answer.
    fs.writeFileSync(path.join(repo, 'rough', 'map.md'), renderMap(MAP));
    const down = tools(repo);
    down.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const skipped = await runDoctor(repo, { devUrl: DEV, skipBuild: true, tools: down });
    assert.equal(check(skipped, 'map-pages').status, 'skip');
  });
});
