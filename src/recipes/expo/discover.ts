// What an Expo app has (B1 of the brownfield plan): its screens from Expo Router's app/ folder,
// groups dropped from their addresses, every `_layout` for Shared, and each screen's sections from
// the import graph, as Next.js's are.
import { discoverModules, type ModuleRoutes } from '../modules/discover.js';
import type { Discovered, DiscoverInput } from '../../map/types.js';
import { isFolder, listFiles } from '../../map/walk.js';
import { PREVIEW_ROUTE } from './preview.js';

const CODE = /\.(tsx|ts|jsx|js)$/;

export async function discoverExpo(given: DiscoverInput): Promise<Discovered> {
  const appDirs = ['app', 'src/app'].filter(dir => isFolder(given.repo, dir));
  // The studio's own preview route is never one of the app's screens.
  const input = { ...given, own: [...given.own, ...appDirs.map(dir => `${dir}/${PREVIEW_ROUTE}`)] };
  const routes: ModuleRoutes = {
    by: 'expo',
    pages: [],
    layouts: [],
    others: [],
    unread: [],
    missed: [],
    isRoute: file => appDirs.some(dir => file.startsWith(`${dir}/`))
  };
  for (const dir of appDirs) {
    for (const file of listFiles(input, dir).filter(item => CODE.test(item))) {
      const segments = file
        .slice(dir.length + 1)
        .replace(CODE, '')
        .split('/');
      const name = segments.pop()!;
      if (name.endsWith('+api') || name === '+html' || name === '+native-intent') continue;
      if (name === '_layout') {
        routes.layouts.push(file);
        continue;
      }
      if (name.startsWith('+')) {
        routes.others.push(file);
        continue;
      }
      const address = `/${[...segments, ...(name === 'index' ? [] : [name])]
        .filter(segment => !/^\(.*\)$/.test(segment))
        .join('/')}`;
      routes.pages.push({ file, address });
    }
  }
  const depth = (file: string | { file: string }) =>
    (typeof file === 'string' ? file : file.file).split('/').length;
  routes.layouts.sort((a, b) => depth(a) - depth(b));
  return discoverModules(input, routes);
}
