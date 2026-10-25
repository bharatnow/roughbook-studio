// What a Next.js app has (B1 of the brownfield plan): its pages from the App Router's
// `app/**/page.*` and the Pages Router's `pages/**`, Shared from every `layout.*` (and `_app`),
// and each page's sections from the import graph, in the order the page shows them.
import { isDynamic } from '../../map/file.js';
import { discoverModules, type ModuleRoutes } from '../modules/discover.js';
import type { Discovered, DiscoverInput, Missed } from '../../map/types.js';
import { isFolder, listFiles, readText } from '../../map/walk.js';
import { previewRouteDir } from './preview.js';

const CODE = /\.(tsx|ts|jsx|js|mjs)$/;
const MARKDOWN = /\.(mdx|md)$/;
/** The App Router's files that render no page of their own, but are rendered: reached, not unplaced. */
const APP_OTHERS = new Set([
  'not-found',
  'error',
  'loading',
  'global-error',
  'default',
  'forbidden',
  'unauthorized'
]);
/** The App Router's files that are the router's: routes, metadata images, the instrumentation. */
const APP_OWN = new Set([
  'page',
  'layout',
  'template',
  'route',
  'opengraph-image',
  'twitter-image',
  'icon',
  'apple-icon',
  'sitemap',
  'robots',
  'manifest',
  ...APP_OTHERS
]);
const PAGES_SPECIAL = new Set(['_document', '_error', '404', '500']);

function baseName(file: string): string {
  return file
    .split('/')
    .at(-1)!
    .replace(/\.[^.]+$/, '');
}

/** The App Router's routes under one app folder. */
function appRoutes(input: DiscoverInput, appDir: string, routes: ModuleRoutes): void {
  for (const file of listFiles(input, appDir)) {
    const folders = file
      .slice(appDir.length + 1)
      .split('/')
      .slice(0, -1);
    const name = baseName(file);
    if (!APP_OWN.has(name) || folders.some(folder => folder.startsWith('_'))) continue;
    const isCode = CODE.test(file);
    if (name === 'layout' || name === 'template') {
      if (isCode) routes.layouts.push(file);
      continue;
    }
    if (APP_OTHERS.has(name)) {
      if (isCode) routes.others.push(file);
      continue;
    }
    if (name !== 'page') continue;
    if (folders.some(folder => /^\(\.{1,3}\)|^\(\.\.\)/.test(folder))) {
      routes.missed.push({
        what: file,
        why: 'an intercepting route, shown over the page whose address it takes; that page is mapped'
      });
      continue;
    }
    if (folders.some(folder => folder.startsWith('@'))) {
      routes.missed.push({
        what: file,
        why: "a parallel route's slot, shown inside its layout rather than at an address of its own"
      });
      continue;
    }
    const address = `/${folders.filter(folder => !/^\(.*\)$/.test(folder)).join('/')}`;
    if (MARKDOWN.test(file)) {
      routes.unread.push({
        file,
        address,
        why: 'an MDX page: its sections are in its markdown, which the map run reads'
      });
    } else if (isCode) {
      routes.pages.push({ file, address });
    }
  }
}

/** The Pages Router's routes under one pages folder. */
function pagesRoutes(input: DiscoverInput, pagesDir: string, routes: ModuleRoutes): void {
  for (const file of listFiles(input, pagesDir)) {
    const relative = file.slice(pagesDir.length + 1);
    if (relative.startsWith('api/') || !(CODE.test(file) || MARKDOWN.test(file))) continue;
    const name = baseName(file);
    if (name === '_app') {
      if (CODE.test(file)) routes.layouts.unshift(file);
      continue;
    }
    if (PAGES_SPECIAL.has(name)) {
      if (CODE.test(file)) routes.others.push(file);
      continue;
    }
    const segments = relative.replace(/\.[^.]+$/, '').split('/');
    if (segments.at(-1) === 'index') segments.pop();
    const address = `/${segments.join('/')}`;
    if (MARKDOWN.test(file)) {
      routes.unread.push({ file, address, why: 'an MDX page: its sections are in its markdown' });
    } else {
      routes.pages.push({ file, address });
    }
  }
}

/**
 * An example address for a dynamic page, from the first params its `generateStaticParams` writes
 * out (decision 14): `[{ slug: "hello-world" }]` makes /blog/[slug] /blog/hello-world.
 */
function exampleOf(repo: string, file: string, address: string): string | null {
  if (!isDynamic(address)) return null;
  const text = readText(repo, file) ?? '';
  const at = text.search(/\bgenerateStaticParams\b/);
  if (at === -1) return null;
  const params = /\{\s*([^{}]*)\}/.exec(text.slice(at, at + 2000))?.[1];
  if (!params) return null;
  const values = new Map<string, string>();
  for (const match of params.matchAll(/(\w+)\s*:\s*(?:"([^"]*)"|'([^']*)'|\[([^\]]*)\])/g)) {
    const list = match[4]?.match(/"[^"]*"|'[^']*'/g)?.map(item => item.slice(1, -1));
    values.set(match[1]!, match[2] ?? match[3] ?? list?.join('/') ?? '');
  }
  const example = address.replace(/\[\[?(?:\.\.\.)?(\w+)\]?\]/g, (whole, key: string) =>
    values.has(key) ? values.get(key)! : whole
  );
  return isDynamic(example) ? null : example;
}

/** The addresses the app's proxy (middleware before Next.js 16) sends to a sign-in page. */
function signedInPrefixes(repo: string): string[] {
  for (const base of ['', 'src/']) {
    for (const name of ['proxy', 'middleware']) {
      for (const ext of ['.ts', '.js', '.mjs']) {
        const text = readText(repo, `${base}${name}${ext}`);
        if (text === null) continue;
        if (!/\bredirect\s*\(/.test(text) || !/["'`]\/(log-?in|sign-?in|auth)\b/i.test(text)) {
          return [];
        }
        const matcher = /\bmatcher\s*:\s*(\[[^\]]*\]|["'][^"']+["'])/.exec(text)?.[1] ?? '';
        return [...matcher.matchAll(/["']([^"']+)["']/g)]
          .map(match => match[1]!)
          .filter(item => /^\/[\w\-/]*?(\/:path\*)?$/.test(item))
          .map(item => item.replace(/\/:path\*$/, ''));
      }
    }
  }
  return [];
}

export async function discoverNext(given: DiscoverInput): Promise<Discovered> {
  const appDirs = ['app', 'src/app'].filter(dir => isFolder(given.repo, dir));
  // The studio's own preview route is never one of the app's pages.
  const input = { ...given, own: [...given.own, ...appDirs.map(previewRouteDir)] };
  const pagesDirs = ['pages', 'src/pages'].filter(dir => isFolder(input.repo, dir));
  const missed: Missed[] = [];
  const routes: ModuleRoutes = {
    by: 'next',
    pages: [],
    layouts: [],
    others: [],
    unread: [],
    missed,
    isRoute: file => {
      for (const dir of appDirs) {
        if (file.startsWith(`${dir}/`)) {
          const folders = file
            .slice(dir.length + 1)
            .split('/')
            .slice(0, -1);
          return APP_OWN.has(baseName(file)) && !folders.some(folder => folder.startsWith('_'));
        }
      }
      return pagesDirs.some(dir => file.startsWith(`${dir}/`));
    }
  };
  for (const dir of appDirs) appRoutes(input, dir, routes);
  for (const dir of pagesDirs) pagesRoutes(input, dir, routes);
  // Outer layouts first: the root's parts lead Shared, a nested layout's follow.
  const fileOf = (layout: string | { file: string }) =>
    typeof layout === 'string' ? layout : layout.file;
  routes.layouts.sort((a, b) => {
    const [first, second] = [fileOf(a), fileOf(b)];
    return first.split('/').length - second.split('/').length || first.localeCompare(second);
  });
  const found = await discoverModules(input, routes);
  const behindSignIn = signedInPrefixes(input.repo);
  for (const page of found.pages) {
    if (page.address === null) continue;
    const file = page.files[0];
    if (file) page.example ??= exampleOf(input.repo, file, page.address);
    if (
      behindSignIn.some(prefix => page.address === prefix || page.address!.startsWith(`${prefix}/`))
    ) {
      page.signIn = 'yes';
    }
  }
  return found;
}
