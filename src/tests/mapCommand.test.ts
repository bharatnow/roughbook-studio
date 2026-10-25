// `roughbook map` (ROUGHBOOK-BROWNFIELD-PLAN.md, B1): the map written from the app's own files with
// no agent and no request to the server, kept up to date, and `--agent`'s map run, whose prompt
// comes from the backend with the studio's stand-ins filled and whose work the next `roughbook map`
// keeps and checks. `init` maps an app that has UI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Detection } from '../agents/types.js';
import { main, type MainOptions } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import type { DoctorTools } from '../doctor/types.js';
import type { TerminalPlan } from '../launch/terminal.js';
import { openMapRun } from '../map/agent.js';
import { parseMap } from '../map/file.js';
import {
  fakeFetch,
  notFound,
  ok,
  recordingIo,
  refused,
  tempDir,
  type RecordedRequest
} from './helpers.js';

const SERVER = 'http://localhost:4000';
const ORG = '11111111-1111-4111-8111-111111111111';

const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

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
  'app/blog/[slug]/page.tsx': `import { Post } from "@/components/post";
export default function BlogPost() { return <Post />; }
`,
  'components/site-header.tsx': 'export function SiteHeader() { return <header />; }\n',
  'components/hero.tsx':
    'export default function Hero({ title }: { title?: string }) { return <h1>{title}</h1>; }\n',
  'components/hero.stories.tsx': `import Hero from "./hero";
export default { component: Hero };
export const Default = { args: { title: "Plan less" } };
`,
  'components/pricing.tsx': 'export function Pricing() { return <section />; }\n',
  'components/post.tsx': 'export function Post() { return <article />; }\n'
};

const MAP_PROMPT = {
  prompt: `<task>\nMap this app.\n</task>\n\n<found>\n{{roughbook:discovered}}\n</found>\n\n<repository>\n{{roughbook:guess}}\n</repository>\n\n<fixtures>\n{{roughbook:fixture-file}}\n</fixtures>\n\n<doctor>\n{{roughbook:map-doctor}}\n</doctor>\n`,
  placeholders: {
    discovered: '{{roughbook:discovered}}',
    fixtureFile: '{{roughbook:fixture-file}}',
    guess: '{{roughbook:guess}}',
    doctor: '{{roughbook:map-doctor}}'
  }
};

function detection(): Detection {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    kind: 'terminal',
    found: true,
    executable: { command: 'C:/tools/claude.exe', prefixArgs: [], source: 'PATH' },
    version: '2.1.286',
    signedIn: true,
    signIn: 'claude.ai',
    headless: { ready: false, reason: 'Set ANTHROPIC_API_KEY.' },
    capabilities: { interactive: true, headless: true, permissions: true, usage: true }
  };
}

type Route = (request: RecordedRequest) => ReturnType<typeof ok> | 'offline';

/** A Next.js app, linked, in a git repo with its first commit. */
async function linkedApp(files: Record<string, string> = APP): Promise<string> {
  const repo = path.join(await tempDir('roughbook-map-'), 'app');
  for (const [file, text] of Object.entries(files)) write(repo, file, text);
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
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=T', ...args], {
      cwd: repo,
      stdio: 'ignore'
    });
  git('init', '--quiet');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'start');
  return repo;
}

async function studio(
  repo: string,
  routes: Record<string, Route> = {},
  options: { answers?: (string | null)[]; doctorTools?: Partial<DoctorTools> } = {}
) {
  const configDir = await tempDir('roughbook-config-');
  await saveCredentials(configDir, {
    server: SERVER,
    installId: 'install-1',
    token: 'rbi_token',
    signedInAs: 'dana@example.test',
    savedAt: new Date(0).toISOString()
  });
  const fake = fakeFetch(request => {
    const url = new URL(request.url);
    const route = routes[`${request.method} ${url.pathname.replace('/v1/api/studio', '')}`];
    return route ? route(request) : refused('NOT_FOUND', 404);
  });
  const io = recordingIo(options.answers ?? []);
  const plans: TerminalPlan[] = [];
  const overrides: Partial<MainOptions> = {
    fetch: fake.fetch,
    platform: 'win32',
    home: await tempDir('roughbook-home-'),
    detect: async adapter => (adapter.id === 'claude-code' ? detection() : notFound(adapter)),
    launchTerminal: async plan => void plans.push(plan),
    launchEditor: async () => {},
    copyText: async () => true,
    ...(options.doctorTools ? { doctorTools: options.doctorTools } : {})
  };
  const run = (argv: string[], cwd = repo) =>
    main(argv, { cwd, env: { ROUGHBOOK_CONFIG_DIR: configDir }, io, ...overrides });
  return { io, plans, requests: fake.requests, run };
}

describe('roughbook map', () => {
  it('writes the map from the app’s own files, asks the server nothing, and keeps it up to date', async () => {
    const repo = await linkedApp();
    const { io, requests, run } = await studio(repo);
    assert.equal(await run(['map']), 0, io.errors.join('\n'));
    const map = parseMap(read(repo, 'rough/map.md'));
    assert.deepEqual(
      map.pages.map(page => [page.slug, page.sections]),
      [
        ['shared', ['site-header']],
        ['home', ['hero', 'pricing']],
        ['blog-slug', ['post']]
      ]
    );
    // The story's inputs are the hero's fixture, inside rough/.
    assert.equal(
      read(repo, 'rough/map/fixtures/hero/preview.json'),
      '{\n  "title": "Plan less"\n}\n'
    );
    assert.match(
      io.lines.join('\n'),
      /rough\/map\.md written: 2 pages, 4 sections and shared parts, 0 atoms, by the Next\.js discoverer in \d+\.\d s\./
    );
    assert.ok(io.lines.some(line => line === '  Home (/): Hero, Pricing'));
    assert.ok(io.lines.some(line => line.includes('rough/map/fixtures/hero/preview.json')));
    assert.deepEqual(requests, []);

    // Again with nothing changed: nothing to write.
    assert.equal(await run(['map']), 0);
    assert.ok(io.lines.some(line => line.startsWith('rough/map.md is up to date')));
    // A section added to the page shows up in its place.
    write(
      repo,
      'app/page.tsx',
      `import Hero from "@/components/hero";
import { Pricing } from "@/components/pricing";
import { Post } from "@/components/post";
export default function Home() { return <main><Hero /><Post /><Pricing /></main>; }
`
    );
    assert.equal(await run(['map', '--json']), 0);
    const json = JSON.parse(io.lines.at(-1)!) as {
      map: { pages: { slug: string; sections: string[] }[] };
    };
    assert.deepEqual(json.map.pages.find(page => page.slug === 'home')!.sections, [
      'hero',
      'post',
      'pricing'
    ]);
  });

  it('starts the map run with the stand-ins filled, and keeps its work the next time', async () => {
    const repo = await linkedApp();
    const { io, plans, requests, run } = await studio(repo, {
      [`GET /orgs/${ORG}/projects/site/map-prompt`]: () => ok(MAP_PROMPT)
    });
    assert.equal(await run(['map', '--agent', 'claude-code', '--yes']), 0, io.errors.join('\n'));
    assert.deepEqual(
      requests.map(request => `${request.method} ${new URL(request.url).pathname}`),
      [`GET /v1/api/studio/orgs/${ORG}/projects/site/map-prompt`]
    );
    const promptFile = io.lines
      .find(line => line.startsWith('Map run: '))!
      .slice('Map run: '.length);
    assert.match(promptFile, /^rough\/prompts\/map-[0-9a-f-]{36}\.md$/);
    const prompt = read(repo, promptFile);
    assert.doesNotMatch(prompt, /\{\{roughbook:/);
    assert.match(
      prompt,
      /The studio's discoverers \(next\) wrote rough\/map\.md: 2 pages, 4 sections and shared parts, 0 atoms;/
    );
    assert.match(prompt, /rough\/map\/fixtures\/<component>\/preview\.json/);
    assert.match(prompt, /roughbook doctor has not checked the map yet\./);
    assert.match(prompt, /Next\.js/);
    assert.match(prompt, /<finishing>[\s\S]*Roughbook map run: [0-9a-f-]{36}/);
    assert.equal(plans.length, 1);
    assert.ok(JSON.stringify(plans[0]).includes(`Follow the instructions in ${promptFile}`));
    assert.ok(await openMapRun(repo));

    // The agent's work: a better name, the home page's sections in the order it shows them, a
    // page the discoverers missed, and a stray edit.
    const text = read(repo, 'rough/map.md')
      .replace('name: Pricing\n', 'name: Plans and prices\n')
      .replace('    sections: hero, pricing\n', '    sections: pricing, hero\n')
      .replace('components:\n', 'components:\n')
      .replace(
        'pages:\n',
        'pages:\n  - slug: checkout\n    name: Checkout\n    address: /checkout\n    signIn: yes\n    files: none\n    sections: none\n    found: agent\n'
      );
    write(repo, 'rough/map.md', text);
    write(repo, 'app/page.tsx', `${read(repo, 'app/page.tsx')}// touched\n`);
    assert.equal(await run(['map']), 0);
    assert.ok(io.lines.some(line => /^The map run from .* is over; its map is kept\.$/.test(line)));
    assert.match(
      io.errors.join('\n'),
      /besides the map and its fixtures, which a map run must not: app\/page\.tsx/
    );
    const map = parseMap(read(repo, 'rough/map.md'));
    assert.equal(map.components.find(item => item.slug === 'pricing')!.name, 'Plans and prices');
    assert.deepEqual(map.pages.find(page => page.slug === 'home')!.sections, ['pricing', 'hero']);
    assert.ok(map.pages.some(page => page.slug === 'checkout' && page.byAgent));
    assert.equal(await openMapRun(repo), null);
  });

  it('starts no map run when nobody can say yes', async () => {
    const repo = await linkedApp();
    const { io, plans, requests, run } = await studio(repo, {
      [`GET /orgs/${ORG}/projects/site/map-prompt`]: () => ok(MAP_PROMPT)
    });
    assert.equal(await run(['map', '--agent', 'claude-code']), 1);
    assert.match(io.lines.join('\n'), /the map run did not start/);
    assert.deepEqual([plans.length, requests.length], [0, 0]);
    // The map itself was written all the same: it needs no agent.
    assert.ok(fs.existsSync(path.join(repo, 'rough', 'map.md')));
  });
});

describe('roughbook map on a stack no discoverer reads', () => {
  it('says the map run writes the map, and keeps one it wrote as it is', async () => {
    const repo = await linkedApp({ Gemfile: "source 'https://rubygems.org'\ngem 'rails'\n" });
    write(
      repo,
      'rough/environment.md',
      '---\ncontract: 1\nrecipe: none\nstack:\n  - rails-8\nentry: index.html.erb\nsources:\n  - .erb\nstart: bin/rails server @ http://localhost:3000\npreview: /rough-preview/{key}\ngate: runtime\n---\n'
    );
    const { io, run } = await studio(repo);
    assert.equal(await run(['map']), 0, io.errors.join('\n'));
    assert.match(io.lines.join('\n'), /is the map run's to write: roughbook map --agent <id>/);
    // The map run's map, its pages not marked found: agent, survives the next roughbook map.
    const text =
      '---\nmap: 1\nby: agent\npages:\n  - slug: home\n    name: Home\n    address: /\n    sections: hero\ncomponents:\n  - slug: hero\n    name: Hero\n    files: app/views/home/_hero.html.erb\n    export: view home/hero\n---\n\nNotes.\n';
    write(repo, 'rough/map.md', text);
    assert.equal(await run(['map']), 0, io.errors.join('\n'));
    assert.equal(read(repo, 'rough/map.md'), text);
  });
});

describe('roughbook init', () => {
  const routes: Record<string, Route> = {
    'GET /projects': () =>
      ok([{ id: ORG, name: 'Acme', role: 'owner', projects: [{ slug: 'site', name: 'Site' }] }]),
    [`POST /orgs/${ORG}/links`]: request =>
      ok(
        {
          linkId: 'link-1',
          org: { id: ORG, name: 'Acme' },
          project: { slug: (request.body as { project: string }).project, name: 'Site' }
        },
        201
      )
  };
  const appDown: Partial<DoctorTools> = {
    fetch: (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch
  };

  it('maps an app that has UI after preparing it, and writes no map for one that has none', async () => {
    const repo = path.join(await tempDir('roughbook-map-init-'), 'app');
    for (const [file, text] of Object.entries(APP)) write(repo, file, text);
    const { io, run } = await studio(repo, routes, { doctorTools: appDown });
    assert.equal(await run(['init', '--project', 'site', '--yes']), 0, io.errors.join('\n'));
    assert.ok(io.lines.some(line => line.startsWith('rough/map.md written: 2 pages')));
    assert.ok(parseMap(read(repo, 'rough/map.md')).pages.some(page => page.slug === 'home'));

    const bare = path.join(await tempDir('roughbook-map-init-'), 'app');
    write(bare, 'package.json', '{ "dependencies": { "next": "16.0.0" } }\n');
    fs.mkdirSync(path.join(bare, 'app'), { recursive: true });
    const second = await studio(bare, routes, { doctorTools: appDown });
    assert.equal(await second.run(['init', '--project', 'site', '--yes']), 0);
    assert.ok(!fs.existsSync(path.join(bare, 'rough', 'map.md')));
  });
});
