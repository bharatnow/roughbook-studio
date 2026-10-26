// A linked Next.js app whose Home page is mapped and adopted, with a new section's iteration, and
// a command line against a fake backend: what B6's tests (pages as compositions) start from.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectTree } from '../api/types.js';
import { main, type MainOptions } from '../commands/index.js';
import { saveCredentials } from '../config/credentials.js';
import { readEnvironment } from '../environment/read.js';
import { writeBaselines } from '../map/adopt.js';
import { readMap } from '../map/file.js';
import { mapRepo } from '../map/run.js';
import { recipeFor } from '../recipes/index.js';
import type { RepoLink } from '../repo/link.js';
import { fakeFetch, ok, recordingIo, refused, tempDir, type RecordedRequest } from './helpers.js';

export const SERVER = 'http://localhost:4000';
export const ORG = '11111111-1111-4111-8111-111111111111';
export const LINK: RepoLink & Record<string, unknown> = {
  version: 1,
  orgId: ORG,
  project: 'site',
  roughCommitted: true,
  appDir: 'app',
  stack: ['next-16', 'react-19'],
  family: 'react-like'
};
export const PAGE = `/v1/api/studio/orgs/${ORG}/projects/site/pages/home`;

export const write = (repo: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, ...file.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(repo, ...file.split('/')), text);
};
export const read = (repo: string, file: string) =>
  fs.readFileSync(path.join(repo, ...file.split('/')), 'utf8');

export const HOME_SOURCE = `import { Hero } from "@/components/hero";
import { Features } from "@/components/features";
import { Testimonials } from "@/components/testimonials";

export default function Home() {
  return (
    <main className="home-page-layout">
      <Hero />
      <Features />
      <Testimonials />
    </main>
  );
}
`;

export const TREE = {
  slug: 'site',
  name: 'Site',
  delivery: { componentsDir: 'components', publicDir: 'public', devUrl: '' },
  pictures: true,
  pages: [{ slug: 'home', name: 'Home', inApp: true, components: [] }]
} as unknown as ProjectTree;

/** A linked Next.js app, mapped, with Home's sections adopted and a new section's iteration. */
export async function homeApp(root?: string): Promise<string> {
  // A `before` hook passes its own folder: tempDir's clean-up would run as soon as the hook ends.
  const repo = path.join(root ?? (await tempDir('roughbook-compose-')), 'app');
  write(repo, 'package.json', '{ "dependencies": { "next": "16.0.0", "react": "19.0.0" } }\n');
  write(repo, 'tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }\n');
  write(
    repo,
    'app/layout.tsx',
    'export default function Layout({ children }) { return children; }\n'
  );
  write(repo, 'app/page.tsx', HOME_SOURCE);
  for (const [slug, name] of [
    ['hero', 'Hero'],
    ['features', 'Features'],
    ['testimonials', 'Testimonials']
  ] as const) {
    write(
      repo,
      `components/${slug}.tsx`,
      `export function ${name}() {\n  return <section className="${slug}-section-block">${name} of the app</section>;\n}\n`
    );
  }
  write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
  execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'ignore' });
  const environment = await readEnvironment(repo, LINK);
  await mapRepo(repo, environment, LINK);
  const map = readMap(repo)!.map;
  writeBaselines(repo, map, recipeFor('next'), {
    pages: [
      {
        slug: 'home',
        created: true,
        components: map.pages
          .find(item => item.slug === 'home')!
          .sections.map(slug => ({ slug, created: true, baseline: 'iteration-00' }))
      }
    ]
  });
  write(
    repo,
    'rough/home/customer-logos/iteration-01/index.tsx',
    'export default function CustomerLogos() {\n  return <ul className="logo-wall">Logos we earned</ul>;\n}\n'
  );
  return repo;
}

export type Route = (request: RecordedRequest) => ReturnType<typeof ok>;

export async function studio(
  repo: string,
  routes: Record<string, Route>,
  overrides: Partial<MainOptions> = {}
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
    if (!url.pathname.startsWith('/v1/api/studio/')) return 'offline';
    const route = routes[`${request.method} ${url.pathname}`];
    return route ? route(request) : refused('NOT_FOUND', 404);
  });
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
      askPreview: async () => null,
      ...overrides
    });
  return { io, requests: fake.requests, run };
}
