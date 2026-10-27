// The pictures the studio uploads (ROUGHBOOK-BROWNFIELD-PLAN.md, B2; decisions 21, 23 and 28): of
// studio iterations, baselines and adopted pages only, after their screenshots, through the
// outbox so an offline studio sends them later, again only when one changed, and none while the
// project's pictures are off. A whole map, adopt and upload run is read request by request.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { picturePath, StudioApi } from '../api/client.js';
import { Outbox, sha256 } from '../api/outbox.js';
import type { AdoptBody, ProjectTree } from '../api/types.js';
import { main } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import { saveSettings } from '../config/settings.js';
import { pictureRefusal } from '../pictures/allowed.js';
import { pictureSizes, type PictureShot } from '../pictures/share.js';
import type { Shots } from '../screenshot/iteration.js';
import { eventsFile, type QueuedEvent } from '../telemetry/events.js';
import {
  assertCarriesNoRepoContent,
  fakeFetch,
  ok,
  recordingIo,
  refused,
  tempDir,
  type RecordedRequest
} from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = `/orgs/${ORG}/projects/site`;

const write = (repo: string, file: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};

/** A picture as the browser gives one: WebP's header, then what it shows. */
function webp(shows: string): Buffer {
  return Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 '), Buffer.from(shows)]);
}

const isWebp = (bytes: Buffer) =>
  bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';

function iteration(id: string, origin: 'sketch' | 'local' | 'app') {
  return {
    id,
    number: Number(id.slice(-2)),
    name: id,
    status: 'draft',
    parent: null,
    direction: '',
    generation: { mode: origin === 'sketch' ? 'sketch' : 'local' },
    origin
  };
}

/** The project after `home` and its hero and pricing were adopted, with a studio iteration and a pulled-in sketch. */
function adoptedTree(pictures: boolean): ProjectTree {
  return {
    slug: 'site',
    name: 'Site',
    delivery: { componentsDir: 'components', publicDir: 'public', devUrl: 'http://localhost:3000' },
    pictures,
    pages: [
      {
        slug: 'home',
        name: 'Home',
        inApp: true,
        components: [
          {
            slug: 'hero',
            name: 'Hero',
            inApp: true,
            selectedIteration: null,
            iterations: [
              iteration('iteration-00', 'app'),
              iteration('iteration-01', 'local'),
              iteration('iteration-02', 'sketch')
            ]
          },
          {
            slug: 'pricing',
            name: 'Pricing',
            inApp: true,
            selectedIteration: null,
            iterations: [iteration('iteration-00', 'app')]
          }
        ]
      },
      { slug: 'about', name: 'About', inApp: false, components: [] }
    ]
  };
}

describe('which pictures the project takes', () => {
  it('a studio iteration’s, a baseline’s and an adopted page’s, while pictures are on', () => {
    const on = adoptedTree(true);
    const at = (component: string, iteration: string) => ({ page: 'home', component, iteration });
    assert.equal(pictureRefusal(on, at('hero', 'iteration-00')), null);
    assert.equal(pictureRefusal(on, at('hero', 'iteration-01')), null);
    assert.equal(pictureRefusal(on, at('hero', 'iteration-02')), 'NOT_A_STUDIO_ITERATION');
    assert.equal(pictureRefusal(on, at('hero', 'iteration-09')), 'NOT_A_STUDIO_ITERATION');
    assert.equal(pictureRefusal(on, { page: 'home' }), null);
    assert.equal(pictureRefusal(on, { page: 'about' }), 'PAGE_NOT_IN_APP');
    assert.equal(pictureRefusal(on, { page: 'blog' }), 'PAGE_NOT_IN_APP');
    // Absent means on (the contract); a backend older than B2 says no origin, and takes none.
    const { pictures: _pictures, ...unsaid } = on;
    assert.equal(pictureRefusal(unsaid, at('hero', 'iteration-01')), null);
    const old = structuredClone(on);
    delete old.pages[0]!.components[0]!.iterations[1]!.origin;
    assert.equal(pictureRefusal(old, at('hero', 'iteration-01')), 'NOT_A_STUDIO_ITERATION');
    assert.equal(pictureRefusal(adoptedTree(false), at('hero', 'iteration-01')), 'PICTURES_OFF');
    assert.equal(pictureRefusal(adoptedTree(false), { page: 'home' }), 'PICTURES_OFF');
  });

  it('takes a thumbnail one screen at 1280 px, and full-length desktop and phone pictures', () => {
    const viewports = [
      { name: 'desktop', width: 1440, height: 900, mobile: false },
      { name: 'mobile', width: 390, height: 844, mobile: true }
    ];
    assert.deepEqual(pictureSizes(viewports), [
      { kind: 'thumbnail', size: { width: 1280, height: 800, mobile: false }, full: false },
      { kind: 'desktop', size: { width: 1440, height: 900, mobile: false }, full: true },
      { kind: 'phone', size: { width: 390, height: 844, mobile: true }, full: true }
    ]);
  });
});

describe('uploading a picture through the outbox', () => {
  const setup = async (
    respond: (request: RecordedRequest) => ReturnType<typeof ok> | 'offline'
  ) => {
    const repo = await tempDir();
    const fake = fakeFetch(respond);
    const api = new StudioApi({
      server: SERVER,
      token: 'rbi_token',
      userAgent: 'roughbook-studio/test',
      fetch: fake.fetch
    });
    const outbox = new Outbox(path.join(repo, 'rough/.roughbook/outbox.json'), undefined, repo);
    return { repo, api, outbox, requests: fake.requests };
  };
  const target = { page: 'home', component: 'hero', iteration: 'iteration-01' };
  const route = picturePath(ORG, 'site', target, 'thumbnail');
  const file = 'rough/.screenshots/home/hero/iteration-01/pictures/thumbnail.webp';
  const upload = (bytes: Buffer) => ({
    file,
    type: 'image/webp' as const,
    hash: sha256(bytes),
    picture: { orgId: ORG, project: 'site', ...target, kind: 'thumbnail' as const }
  });

  it('waits offline, is retried from the outbox, and is sent again only when it changed', async () => {
    let online = false;
    let tree = adoptedTree(true);
    const { repo, api, outbox, requests } = await setup(request => {
      if (!online) return 'offline';
      if (request.method === 'GET') return ok(tree);
      return ok({ kind: 'thumbnail', width: 640, height: 400, updatedAt: '2026-10-25T00:00:00Z' });
    });
    assert.equal(
      route,
      `${PROJECT}/pages/home/components/hero/iterations/iteration-01/pictures/thumbnail`
    );
    const first = webp('first');
    write(repo, file, first);
    assert.deepEqual(await outbox.upload(api, route, upload(first)), { status: 'queued' });
    const [waiting] = await outbox.pending();
    assert.equal(waiting!.attempts, 1);
    assert.equal(waiting!.lastError, 'OFFLINE');

    // A newer picture while offline replaces the one waiting: only the newest goes.
    const second = webp('second');
    write(repo, file, second);
    await outbox.upload(api, route, upload(second));
    assert.equal((await outbox.pending()).length, 1);

    online = true;
    const flushed = await outbox.flush(api);
    assert.equal(flushed.left, 0);
    const put = requests.filter(request => request.method === 'PUT');
    assert.equal(put.length, 1);
    assert.equal(new URL(put[0]!.url).pathname, `/v1/api/studio${route}`);
    assert.equal(put[0]!.headers['content-type'], 'image/webp');
    assert.match(put[0]!.headers['idempotency-key']!, /^[0-9a-f-]{36}$/);
    assert.deepEqual(put[0]!.bytes, second);
    assert.equal(put[0]!.body, null, 'the bytes only: no name, no path');

    // The same picture again is not sent; a changed one is.
    assert.deepEqual(await outbox.upload(api, route, upload(second)), { status: 'unchanged' });
    assert.equal(requests.filter(request => request.method === 'PUT').length, 1);
    const third = webp('third');
    write(repo, file, third);
    assert.equal((await outbox.upload(api, route, upload(third))).status, 'sent');
    assert.equal(requests.filter(request => request.method === 'PUT').length, 2);

    // Turned off while one waited: nothing is sent, nothing is listed as lost, and once they are
    // on again every picture goes up again (the backend deleted them).
    online = false;
    const fourth = webp('fourth');
    write(repo, file, fourth);
    await outbox.upload(api, route, upload(fourth));
    tree = adoptedTree(false);
    online = true;
    await outbox.flush(api);
    assert.equal(requests.filter(request => request.method === 'PUT').length, 2);
    assert.deepEqual(await outbox.pending(), []);
    assert.deepEqual(await outbox.dropped(), []);
    tree = adoptedTree(true);
    assert.equal((await outbox.upload(api, route, upload(third))).status, 'sent');
  });

  it('lets a review behind a waiting picture wait too, in order', async () => {
    let online = false;
    const { repo, api, outbox, requests } = await setup(request =>
      !online ? 'offline' : request.method === 'GET' ? ok(adoptedTree(true)) : ok({ saved: true })
    );
    const bytes = webp('one');
    write(repo, file, bytes);
    await outbox.upload(api, route, upload(bytes));
    assert.deepEqual(await outbox.send(api, '/reviews', { rating: 4 }), { status: 'queued' });
    online = true;
    await outbox.flush(api);
    assert.deepEqual(
      requests
        .filter(request => request.method !== 'GET')
        .slice(-2)
        .map(request => request.method),
      ['PUT', 'POST']
    );
  });
});

/** A Next.js app whose lines exist nowhere else, linked, in a git repo. */
const APP: Record<string, string> = {
  'package.json': '{ "dependencies": { "next": "16.0.0", "react": "19.0.0" } }\n',
  'tsconfig.json': '{ "compilerOptions": { "jsx": "preserve", "paths": { "@/*": ["./*"] } } }\n',
  'app/layout.tsx': `import { SiteHeader } from "@/components/site-header";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body><SiteHeader />{children}</body></html>;
}
`,
  'app/page.tsx': `import Hero from "@/components/hero";
import { Pricing } from "@/components/pricing";
export default function Home() { return <main><Hero /><Pricing /></main>; }
`,
  'app/about/page.tsx': `import { Story } from "@/components/story";
export default function About() { return <Story />; }
`,
  'components/site-header.tsx':
    'export function SiteHeader() { return <header className="private-header-7d1">Acme</header>; }\n',
  'components/hero.tsx':
    'export default function Hero({ title }: { title?: string }) { return <h1 className="hero-secret-91">{title}</h1>; }\n',
  'components/hero.stories.tsx': `import Hero from "./hero";
export default { component: Hero };
export const Default = { args: { title: "Plan less, ship the quarterly forecast" } };
`,
  'components/pricing.tsx':
    'export function Pricing() { return <section data-tier="enterprise-only-44">Plans</section>; }\n',
  'components/story.tsx':
    'export function Story() { return <article>Founded in a garage, 1999</article>; }\n'
};

async function linkedApp(): Promise<string> {
  const repo = path.join(await tempDir('roughbook-pictures-'), 'app');
  for (const [file, text] of Object.entries(APP)) write(repo, file, text);
  write(
    repo,
    'rough/roughbook.json',
    JSON.stringify({
      version: 1,
      orgId: ORG,
      project: 'site',
      roughCommitted: true,
      appDir: 'app',
      stack: ['next-16', 'react-19'],
      family: 'react-like'
    })
  );
  execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

type Reply = ReturnType<typeof ok> | 'offline';

/**
 * The studio against a fake backend that adopts what it is sent and keeps the pictures, with the
 * app answering: screenshots and pictures are recorded, never taken.
 */
async function studio(repo: string, options: { pictures?: () => boolean } = {}) {
  const configDir = await tempDir('roughbook-config-');
  await saveCredentials(configDir, {
    server: SERVER,
    installId: 'install-1',
    token: 'rbi_token',
    signedInAs: 'dana@example.test',
    savedAt: new Date(0).toISOString()
  });
  await saveSettings(configDir, { analyticsConsent: true });
  let online = true;
  const fake = fakeFetch((request): Reply => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/api/studio/')) return 'offline';
    if (!online) return 'offline';
    const route = `${request.method} ${url.pathname.replace('/v1/api/studio', '')}`;
    if (route === `POST ${PROJECT}/adopt`) {
      const body = request.body as AdoptBody;
      return ok({
        pages: body.pages.map(page => ({
          slug: page.slug,
          created: true,
          components: page.components.map(c => ({
            slug: c.slug,
            created: true,
            baseline: 'iteration-00'
          }))
        }))
      });
    }
    if (route === `GET ${PROJECT}`) return ok(adoptedTree(options.pictures?.() ?? true));
    if (request.method === 'PUT' && url.pathname.includes('/pictures/')) {
      return ok({
        kind: url.pathname.split('/').at(-1),
        width: 640,
        height: 400,
        updatedAt: '2026-10-25T00:00:00Z'
      });
    }
    return refused('NOT_FOUND', 404);
  });
  const shot: string[] = [];
  const pictured: string[] = [];
  // What the app shows: changing it changes the pictures.
  let version = 1;
  const takePicture: PictureShot = async ({ url, size, full }) => {
    pictured.push(`${new URL(url).pathname} ${size.width}${full ? ' full' : ''}`);
    return webp(`${url} ${size.width} v${version}`);
  };
  const io = recordingIo();
  const home = await tempDir('roughbook-home-');
  const run = (argv: string[]) =>
    main(argv, {
      cwd: repo,
      env: { ROUGHBOOK_CONFIG_DIR: configDir },
      io,
      fetch: fake.fetch,
      platform: 'win32',
      home,
      askPreview: async url => ({ status: 200, url }),
      screenshot: async (_repo, _url, target): Promise<Shots> => {
        const key = `${target.page}/${target.component}/${target.iteration}`;
        shot.push(key);
        return { files: { desktop: `rough/.screenshots/${key}/desktop.png` }, warning: null };
      },
      takePicture
    });
  return {
    io,
    run,
    requests: fake.requests,
    shot,
    pictured,
    configDir,
    offline: (value: boolean) => (online = !value),
    change: () => (version += 1)
  };
}

const puts = (requests: RecordedRequest[]) =>
  requests
    .filter(request => request.method === 'PUT')
    .map(request => new URL(request.url).pathname.replace(`/v1/api/studio${PROJECT}`, ''));

describe('a whole map, adopt and upload run', () => {
  it('sends no path, fixture or code, and no picture but a studio iteration’s or an adopted page’s', async () => {
    const repo = await linkedApp();
    const { io, run, requests, shot, pictured, configDir, offline, change } = await studio(repo);
    assert.equal(await run(['map']), 0, io.errors.join('\n'));
    assert.equal(requests.length, 0, 'mapping asks the server nothing');
    const events = JSON.parse(fs.readFileSync(eventsFile(configDir), 'utf8')) as QueuedEvent[];
    assert.deepEqual(
      events.map(event => [event.type, { ...event.props, milliseconds: 0 }]),
      [
        [
          'map.ran',
          { pages: 3, components: 4, missed: 0, unplaced: 0, agent: false, milliseconds: 0 }
        ]
      ]
    );

    // Adopting the home page: its baselines are screenshotted and pictured, and so is the page.
    assert.equal(await run(['adopt', 'home']), 0, io.errors.join('\n'));
    assert.deepEqual(shot, ['home/hero/iteration-00', 'home/pricing/iteration-00']);
    assert.deepEqual(pictured.slice(0, 3), [
      '/rough-preview/home/hero/iteration-00 1280',
      '/rough-preview/home/hero/iteration-00 1440 full',
      '/rough-preview/home/hero/iteration-00 390 full'
    ]);
    assert.ok(pictured.includes('/ 1440 full'), 'the page at its own address');
    const kinds = ['thumbnail', 'desktop', 'phone'];
    assert.deepEqual(puts(requests), [
      ...kinds.map(kind => `/pages/home/components/hero/iterations/iteration-00/pictures/${kind}`),
      ...kinds.map(
        kind => `/pages/home/components/pricing/iterations/iteration-00/pictures/${kind}`
      ),
      ...kinds.map(kind => `/pages/home/pictures/${kind}`)
    ]);

    // A studio iteration is pictured; a web sketch's copy here, or a page nobody adopted, never.
    write(
      repo,
      'rough/home/hero/iteration-01/index.tsx',
      'export default function Hero() { return <h1 className="studio-only-hero-55">Bold</h1>; }\n'
    );
    write(
      repo,
      'rough/home/hero/iteration-02/index.tsx',
      'export default function Hero() { return <h1 className="sketch-only-hero-66">Web</h1>; }\n'
    );
    assert.equal(await run(['screenshot', 'home/hero/iteration-01']), 0, io.errors.join('\n'));
    assert.equal(await run(['screenshot', 'home/hero/iteration-02']), 0, io.errors.join('\n'));
    // With its pictures in its page (B5), since Next.js has the in-page view.
    const inPage = ['page-desktop', 'page-phone'];
    assert.deepEqual(
      puts(requests).slice(9),
      [...kinds, ...inPage].map(
        kind => `/pages/home/components/hero/iterations/iteration-01/pictures/${kind}`
      )
    );
    assert.ok(!pictured.some(line => line.includes('iteration-02')), 'not even taken');

    // The same pictures again go nowhere; offline, changed ones wait, and go once it is back.
    assert.equal(await run(['screenshot', 'home/hero/iteration-01']), 0);
    assert.equal(puts(requests).length, 14);
    change();
    write(
      repo,
      'components/hero.tsx',
      'export default function Hero() { return <h1 className="hero-secret-92">New</h1>; }\n'
    );
    offline(true);
    assert.equal(await run(['screenshot', 'home/hero/iteration-00']), 0);
    assert.ok(io.lines.some(line => line.includes('pictures 3 waiting to upload')));
    offline(false);
    // Any later upload sends what waits; iteration-01's own pictures did not change, and its
    // pictures in its page, which show the app's hero around it, are taken again.
    assert.equal(await run(['screenshot', 'home/hero/iteration-01']), 0);
    assert.deepEqual(
      puts(requests).slice(14).sort(),
      [
        ...kinds.map(
          kind => `/pages/home/components/hero/iterations/iteration-00/pictures/${kind}`
        ),
        ...inPage.map(
          kind => `/pages/home/components/hero/iterations/iteration-01/pictures/${kind}`
        )
      ].sort()
    );

    // Every request: no line of the app, its fixtures or the baselines, no path of this machine.
    assertCarriesNoRepoContent(requests, { repo, root: path.dirname(repo), minimumLines: 5 });
    for (const request of requests) {
      if (!request.bytes) continue;
      assert.equal(request.method, 'PUT');
      assert.ok(isWebp(request.bytes), 'only a picture goes as bytes');
      assert.match(
        new URL(request.url).pathname,
        /\/pages\/home\/(components\/(hero|pricing)\/iterations\/iteration-0[01]\/)?pictures\/(thumbnail|desktop|phone|page-desktop|page-phone)$/
      );
    }
    assert.ok(
      !requests.some(request => /about|shared|site-header/.test(new URL(request.url).pathname))
    );
  });

  it('sends the pictures again once the project’s pictures are on again, since they were deleted', async () => {
    const repo = await linkedApp();
    let on = true;
    const { io, run, requests } = await studio(repo, { pictures: () => on });
    assert.equal(await run(['map']), 0, io.errors.join('\n'));
    assert.equal(await run(['adopt', 'home']), 0, io.errors.join('\n'));
    write(
      repo,
      'rough/home/hero/iteration-01/index.tsx',
      'export default function Hero() { return <h1>Bold</h1>; }\n'
    );
    const shots = () => run(['screenshot', 'home/hero/iteration-01']);
    const iterationPuts = () =>
      puts(requests).filter(put => put.includes('/iterations/iteration-01/'));
    assert.equal(await shots(), 0, io.errors.join('\n'));
    const first = iterationPuts().length;
    assert.ok(first > 0);
    // Turned off: the backend deletes them, and nothing goes up.
    on = false;
    assert.equal(await shots(), 0, io.errors.join('\n'));
    assert.equal(iterationPuts().length, first);
    // On again, nothing changed here: they go up again all the same.
    on = true;
    assert.equal(await shots(), 0, io.errors.join('\n'));
    assert.equal(iterationPuts().length, first * 2);
  });

  it('sends an adopted page’s new order when roughbook map finds it, as start’s watch does', async () => {
    const repo = await linkedApp();
    const { io, run, requests } = await studio(repo);
    assert.equal(await run(['map']), 0, io.errors.join('\n'));
    assert.equal(await run(['adopt', 'home']), 0, io.errors.join('\n'));
    const adopts = () => requests.filter(request => request.url.endsWith('/adopt'));
    const before = adopts().length;
    write(
      repo,
      'app/page.tsx',
      `import Hero from "@/components/hero";
import { Pricing } from "@/components/pricing";
export default function Home() { return <main><Pricing /><Hero /></main>; }
`
    );
    assert.equal(await run(['map']), 0, io.errors.join('\n'));
    assert.equal(adopts().length, before + 1, io.lines.join('\n'));
    const body = adopts().at(-1)!.body as AdoptBody;
    assert.deepEqual(body.pages[0]!.sections, ['pricing', 'hero']);
  });

  it('uploads nothing while the project’s pictures are off, and takes none either', async () => {
    const repo = await linkedApp();
    const { io, run, requests, pictured } = await studio(repo, { pictures: () => false });
    assert.equal(await run(['map']), 0, io.errors.join('\n'));
    assert.equal(await run(['adopt', 'home']), 0, io.errors.join('\n'));
    write(
      repo,
      'rough/home/hero/iteration-01/index.tsx',
      'export default function Hero() { return <h1>Bold</h1>; }\n'
    );
    assert.equal(await run(['screenshot', 'home/hero/iteration-01']), 0, io.errors.join('\n'));
    assert.deepEqual(puts(requests), []);
    assert.deepEqual(pictured, []);
    assert.ok(
      fs.existsSync(path.join(repo, 'rough/home/hero/iteration-00/index.tsx')),
      'adopted all the same'
    );
  });
});
