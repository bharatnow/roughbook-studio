// What a Nuxt app has (B1 of the brownfield plan): its pages from pages/**, Shared from app.vue and
// the layouts its pages use, and each page's sections from its template, where Nuxt's components
// are used by the names their folders give them (components/home/Hero.vue is <HomeHero>), in the
// order the template shows them. Read from the files alone: nothing is installed or built.
import path from 'node:path';
import { isAtom } from '../../map/kinds.js';
import type {
  Discovered,
  DiscoverInput,
  FoundComponent,
  FoundPage,
  Missed
} from '../../map/types.js';
import { isFolder, listFiles, readText } from '../../map/walk.js';
import { MODULE_FILE } from './preview.js';

type Node = {
  /** The component's file, when the tag is one of the app's components. */
  file: string | null;
  name: string;
  repeated: boolean;
  /** Something between its opening and closing tags: other elements, or text. */
  content: boolean;
  children: Node[];
};

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

function pascal(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** A component's name as Nuxt registers it: its folders' names before its own, once. */
export function nuxtName(relative: string): string {
  const segments = relative.replace(/\.vue$/, '').split('/');
  let base = segments.pop()!;
  if (base === 'index' && segments.length) base = segments.pop()!;
  const prefix = segments.map(pascal).join('');
  const own = pascal(base);
  return own.toLowerCase().startsWith(prefix.toLowerCase()) ? own : `${prefix}${own}`;
}

/** The SFC's template: between its first <template> and its last </template>. */
function templateOf(text: string): string {
  const start = text.search(/<template(\s[^>]*)?>/);
  const end = text.lastIndexOf('</template>');
  if (start === -1 || end <= start) return '';
  return text.slice(text.indexOf('>', start) + 1, end);
}

/** A template's elements, with their nesting; `resolve` names the app's components. */
function readTemplate(template: string, resolve: (tag: string) => string | null): Node[] {
  const roots: Node[] = [];
  const open: { node: Node; tag: string; loops: boolean }[] = [];
  const place = (node: Node) => (open.length ? open.at(-1)!.node.children : roots).push(node);
  let i = 0;
  while (i < template.length) {
    const lt = template.indexOf('<', i);
    const text = template.slice(i, lt === -1 ? template.length : lt);
    if (text.trim() && open.length) open.at(-1)!.node.content = true;
    if (lt === -1) break;
    if (template.startsWith('<!--', lt)) {
      const end = template.indexOf('-->', lt);
      i = end === -1 ? template.length : end + 3;
      continue;
    }
    const closing = /^<\/([A-Za-z][\w.-]*)\s*>/.exec(template.slice(lt, lt + 200));
    if (closing) {
      const at = open.map(item => item.tag).lastIndexOf(closing[1]!);
      if (at !== -1) open.splice(at);
      i = lt + closing[0].length;
      continue;
    }
    const opening = /^<([A-Za-z][\w.-]*)/.exec(template.slice(lt, lt + 200));
    if (!opening) {
      i = lt + 1;
      continue;
    }
    let end = lt + opening[0].length;
    for (; end < template.length && template[end] !== '>'; end++) {
      const char = template[end]!;
      if (char === '"' || char === "'") {
        const quote = template.indexOf(char, end + 1);
        end = quote === -1 ? template.length : quote;
      }
    }
    const tag = opening[1]!;
    const attributes = template.slice(lt + opening[0].length, end);
    const selfClosing = template[end - 1] === '/' || VOID.has(tag.toLowerCase());
    const loops = /(^|\s)v-for\s*=/.test(attributes);
    if (open.length) open.at(-1)!.node.content = true;
    const node: Node = {
      file: resolve(tag),
      name: tag,
      repeated: loops || open.some(item => item.loops),
      content: false,
      children: []
    };
    place(node);
    if (!selfClosing) open.push({ node, tag, loops });
    i = end + 1;
  }
  return roots;
}

const VIEW_NAME = /(Page|View|Screen|Content|Main|Body|Container|Wrapper|Index)$/;

export async function discoverNuxt(given: DiscoverInput): Promise<Discovered> {
  const input = { ...given, own: [...given.own, MODULE_FILE] };
  const { repo } = input;
  const src = ['app/pages', 'app/layouts', 'app/components', 'app/app.vue'].some(
    item => isFolder(repo, item) || readText(repo, item) !== null
  )
    ? 'app'
    : '';
  const at = (folder: string) => (src ? `${src}/${folder}` : folder);
  const missed: Missed[] = [];

  // The components Nuxt imports by name, from every components folder.
  const byName = new Map<string, string>();
  const componentFiles: string[] = [];
  for (const dir of [...new Set([at('components'), 'components'])]) {
    for (const file of listFiles(input, dir).filter(item => item.endsWith('.vue'))) {
      componentFiles.push(file);
      const name = nuxtName(file.slice(dir.length + 1));
      if (!byName.has(name)) byName.set(name, file);
    }
  }
  const resolverFor = (file: string, text: string) => {
    const imports = new Map<string, string>();
    for (const match of text.matchAll(
      /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.vue)['"]/g
    )) {
      const spec = match[2]!;
      const resolved = /^[~@]{1,2}\//.test(spec)
        ? path.posix.join(src, spec.replace(/^[~@]{1,2}\//, ''))
        : path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      imports.set(match[1]!, resolved);
    }
    return (tag: string): string | null => {
      const name = /[-]/.test(tag) || /^[a-z]/.test(tag) ? pascal(tag) : tag;
      if (imports.has(name)) return imports.get(name)!;
      if (byName.has(name)) return byName.get(name)!;
      if (name.startsWith('Lazy') && byName.has(name.slice(4))) return byName.get(name.slice(4))!;
      return null;
    };
  };
  const trees = new Map<string, { nodes: Node[]; layout: string | null } | null>();
  const treeOf = (file: string) => {
    if (!trees.has(file)) {
      const text = readText(repo, file);
      if (text === null) trees.set(file, null);
      else {
        const layout = /definePageMeta\(\s*\{[\s\S]*?\blayout:\s*(?:['"]([\w-]+)['"]|(false))/.exec(
          text
        );
        trees.set(file, {
          nodes: readTemplate(templateOf(text), resolverFor(file, text)),
          layout: layout ? (layout[1] ?? null) : 'default'
        });
      }
    }
    return trees.get(file)!;
  };

  const components = new Map<string, FoundComponent>();
  const nameOf = (file: string) =>
    [...byName.entries()].find(([, item]) => item === file)?.[0] ??
    pascal(path.posix.basename(file, '.vue'));
  const keep = (file: string, kind: FoundComponent['kind']): string => {
    const key = `${file}#default`;
    if (!components.has(key)) {
      const name = nameOf(file);
      components.set(key, {
        key,
        name,
        kind: kind === 'atom' || isAtom(file, name) ? 'atom' : kind,
        files: [file],
        export: 'default',
        fixture: null,
        fixtureFrom: null
      });
    }
    return key;
  };
  type Made = { sections: string[]; files: string[]; blocks: string[] };
  const partsOf = (nodes: Node[], kind: 'section' | 'shared', made: Made) => {
    for (const node of nodes) {
      if (!node.file) {
        partsOf(node.children, kind, made);
        continue;
      }
      if (node.repeated || isAtom(node.file, nameOf(node.file))) {
        keep(node.file, 'atom');
        partsOf(node.children, kind, made);
        continue;
      }
      if (node.content || node.children.length) {
        const before = made.sections.length;
        partsOf(node.children, kind, made);
        if (made.sections.length === before && node.content) made.blocks.push(nameOf(node.file));
        continue;
      }
      const key = keep(node.file, kind);
      if (!made.sections.includes(key)) made.sections.push(key);
    }
  };
  const viewOf = (file: string, kind: 'section' | 'shared', depth = 0): Made => {
    const made: Made = { sections: [], files: [file], blocks: [] };
    const tree = treeOf(file);
    if (!tree) return made;
    partsOf(tree.nodes, kind, made);
    if (kind === 'section' && made.sections.length === 1 && depth < 3) {
      const only = components.get(made.sections[0]!)!;
      const inner = viewOf(only.files[0]!, kind, depth + 1);
      if (inner.sections.length >= 2 || (inner.sections.length && VIEW_NAME.test(only.name))) {
        return { ...inner, files: [file, ...inner.files] };
      }
    }
    return made;
  };

  const pages: FoundPage[] = [];
  const shared: FoundPage = {
    address: null,
    name: null,
    files: [],
    sections: [],
    signIn: 'unknown',
    example: null
  };
  const usedLayouts = new Set<string>();
  const pagesDir = at('pages');
  for (const file of listFiles(input, pagesDir).filter(item => item.endsWith('.vue'))) {
    const segments = file
      .slice(pagesDir.length + 1)
      .replace(/\.vue$/, '')
      .split('/');
    if (segments.at(-1) === 'index') segments.pop();
    const address = `/${segments.filter(segment => !/^\(.*\)$/.test(segment)).join('/')}`;
    const made = viewOf(file, 'section');
    const layout = treeOf(file)?.layout;
    if (layout) usedLayouts.add(layout);
    if (made.blocks.length || !made.sections.length) {
      missed.push({
        what: file,
        why: made.blocks.length
          ? `${made.blocks.length} block${made.blocks.length === 1 ? '' : 's'} of its content ${made.blocks.length === 1 ? 'is' : 'are'} written inline inside ${[...new Set(made.blocks)].join(', ')}, part of the page rather than sections of their own`
          : 'its content is written inline in the page, so it has no section of its own to show alone'
      });
    }
    pages.push({
      address,
      name: null,
      files: made.files,
      sections: made.sections,
      signIn: 'unknown',
      example: null
    });
  }
  const sharedFrom = [
    at('app.vue'),
    ...['default', ...[...usedLayouts].filter(name => name !== 'default')].map(
      name => `${at('layouts')}/${name}.vue`
    )
  ].filter(file => readText(repo, file) !== null);
  for (const file of sharedFrom) {
    shared.files.push(file);
    const made = viewOf(file, 'shared');
    for (const key of made.sections) if (!shared.sections.includes(key)) shared.sections.push(key);
  }
  for (const key of shared.sections) components.get(key)!.kind = 'shared';
  for (const page of pages)
    page.sections = page.sections.filter(key => !shared.sections.includes(key));
  if (shared.sections.length) pages.unshift(shared);

  // The components nothing reaches, through every template the pages and layouts render.
  const reached = new Set<string>();
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.file && !reached.has(node.file)) {
        reached.add(node.file);
        visit(treeOf(node.file)?.nodes ?? []);
      }
      visit(node.children);
    }
  };
  for (const page of pages) for (const file of page.files) visit(treeOf(file)?.nodes ?? []);
  const unplaced = componentFiles.filter(file => !reached.has(file)).sort();
  pages.sort((a, b) =>
    a.address === null ? -1 : b.address === null ? 1 : a.address.localeCompare(b.address)
  );
  return { by: 'nuxt', pages, components: [...components.values()], missed, unplaced };
}
