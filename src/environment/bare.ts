// The environment of a repo no recipe set up (`recipe: none`): the setup run's agent wrote its
// header, so what a recipe would supply has to be in the file (entry, sources, start, preview, the
// gate), and the rest takes these neutral values. Nothing here names a stack.
import type { RepoLink } from '../repo/link.js';
import type { RepoEnvironment } from './types.js';

export function bareEnvironment(link: RepoLink | null): RepoEnvironment {
  return {
    contract: 1,
    recipe: null,
    recipeVersion: null,
    stack: link?.stack ?? [],
    family: link?.family ?? 'unknown',
    mode: 'live',
    entry: '',
    sources: [],
    code: [],
    placement: { kind: 'rough' },
    wrapper: null,
    runtime: { kind: 'local' },
    shell: 'none',
    start: { command: null, url: 'http://localhost:3000' },
    preview: '/rough-preview/{key}',
    snapshot: null,
    device: null,
    viewports: [
      { name: 'desktop', width: 1440, height: 900, mobile: false },
      { name: 'mobile', width: 390, height: 844, mobile: true }
    ],
    variants: ['light'],
    // With no recipe to say the stack reloads its own pages, the studio reloads the frame.
    reload: 'studio',
    stylesheets: [],
    public: null,
    ignore: ['.git', 'node_modules'],
    overlays: [],
    fixture: 'preview.json',
    build: { command: null, output: [] },
    gate: 'runtime',
    production: null,
    checks: [],
    timeouts: { start: 60, preview: 150, build: 600 },
    promote: { dir: null, extensions: [] },
    assets: { dir: null, url: '/', copy: false },
    copy: { kind: 'inline' },
    // A sketch renders as it is only where the setup says so (F7 of the frameworks plan).
    sketches: 'port',
    terms: { page: 'page', component: 'component' },
    workshop: null,
    setupFiles: [],
    devDependencies: []
  };
}
