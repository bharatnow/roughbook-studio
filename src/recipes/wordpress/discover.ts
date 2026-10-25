// What a WordPress theme has (B1 of the brownfield plan), from its template hierarchy: a block
// theme's templates/*.html with the template parts and patterns each places, in order; a classic
// theme's templates with the header, footer, sidebar and template parts each loads. Shared is the
// parts every page has (the header and footer areas). Addresses use WordPress's plain links, which
// answer whatever the site's permalinks are, with the examples a fresh install has (the sample
// page and the first post).
import { humanName } from '../../map/build.js';
import type {
  Discovered,
  DiscoverInput,
  FoundComponent,
  FoundPage,
  Missed
} from '../../map/types.js';
import { listFiles, readText } from '../../map/walk.js';

type Template = { name: string; address: string; example: string | null } | { skip: string };

/** What a template of the hierarchy is: the page it shows and where, or why it is no page. */
function hierarchy(base: string, has: (name: string) => boolean): Template {
  const fallback = {
    skip: 'the fallback for any view without its own template, not a page of its own'
  };
  switch (base) {
    case 'front-page':
      return { name: 'Front page', address: '/', example: null };
    case 'home':
      return has('front-page')
        ? { name: 'Blog home', address: '/?page_id=[posts-page]', example: null }
        : { name: 'Home', address: '/', example: null };
    case 'index':
      return has('front-page') || has('home')
        ? fallback
        : { name: 'Home', address: '/', example: null };
    case 'page':
      return { name: 'Page', address: '/?page_id=[id]', example: '/?page_id=2' };
    case 'single':
      return { name: 'Single post', address: '/?p=[id]', example: '/?p=1' };
    case 'singular':
      return has('single') && has('page')
        ? fallback
        : { name: 'Singular', address: '/?p=[id]', example: '/?p=1' };
    case 'archive':
      return { name: 'Archive', address: '/?cat=[id]', example: '/?cat=1' };
    case 'category':
      return { name: 'Category', address: '/?cat=[id]', example: '/?cat=1' };
    case 'tag':
      return { name: 'Tag', address: '/?tag=[slug]', example: null };
    case 'author':
      return { name: 'Author', address: '/?author=[id]', example: '/?author=1' };
    case 'date':
      return { name: 'Date archive', address: '/?m=[month]', example: null };
    case 'search':
      return { name: 'Search results', address: '/?s=[query]', example: '/?s=hello' };
    case '404':
      return { skip: 'the not-found page: it answers 404 by design, so doctor does not ask it' };
    case 'privacy-policy':
      return { name: 'Privacy policy', address: '/?page_id=[privacy-page]', example: null };
  }
  const page = /^page-(.+)$/.exec(base);
  if (page)
    return {
      name: `Page: ${humanName(page[1]!)}`,
      address: `/?pagename=${page[1]}`,
      example: null
    };
  const single = /^single-(.+)$/.exec(base);
  if (single) {
    return {
      name: `Single ${humanName(single[1]!).toLowerCase()}`,
      address: `/?post_type=${single[1]}&p=[id]`,
      example: null
    };
  }
  const archive = /^archive-(.+)$/.exec(base);
  if (archive) {
    return {
      name: `${humanName(archive[1]!)} archive`,
      address: `/?post_type=${archive[1]}`,
      example: null
    };
  }
  return { name: humanName(base), address: `/?template=[${base}]`, example: null };
}

const PART_AREAS = new Set(['header', 'footer']);

function blockRefs(text: string): { kind: 'part' | 'pattern' | 'synced'; slug: string }[] {
  const refs: { kind: 'part' | 'pattern' | 'synced'; slug: string }[] = [];
  for (const match of text.matchAll(
    /<!--\s*wp:(template-part|pattern|block)\s+(\{[\s\S]*?\})\s*\/?-->/g
  )) {
    let attrs: { slug?: string; ref?: number };
    try {
      attrs = JSON.parse(match[2]!) as { slug?: string; ref?: number };
    } catch {
      continue;
    }
    if (match[1] === 'block') {
      if (attrs.ref !== undefined) refs.push({ kind: 'synced', slug: String(attrs.ref) });
    } else if (attrs.slug) {
      refs.push({ kind: match[1] === 'pattern' ? 'pattern' : 'part', slug: attrs.slug });
    }
  }
  return refs;
}

/** A block theme's pattern files, by the slug their header names. */
function patternsOf(input: DiscoverInput, files: string[]) {
  const patterns = new Map<string, { file: string; title: string | null }>();
  for (const file of files.filter(item => /^patterns\/[^/]+\.php$/.test(item))) {
    const text = readText(input.repo, file) ?? '';
    const slug = /^\s*\*?\s*Slug:\s*(\S+)/m.exec(text)?.[1];
    const title = /^\s*\*?\s*Title:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
    if (slug) patterns.set(slug, { file, title });
  }
  return patterns;
}

function sortPages(pages: FoundPage[]): FoundPage[] {
  return pages.sort((a, b) =>
    a.address === null ? -1 : b.address === null ? 1 : a.address.localeCompare(b.address)
  );
}

function blockTheme(input: DiscoverInput, files: string[]): Discovered {
  const missed: Missed[] = [];
  const components = new Map<string, FoundComponent>();
  const theme = (() => {
    try {
      return JSON.parse(readText(input.repo, 'theme.json') ?? '{}') as {
        templateParts?: { name: string; title?: string; area?: string }[];
      };
    } catch {
      return {};
    }
  })();
  const partInfo = new Map((theme.templateParts ?? []).map(part => [part.name, part]));
  const patterns = patternsOf(input, files);
  const templates = files.filter(file => /^(templates|block-templates)\/[^/]+\.html$/.test(file));
  const bases = new Set(
    templates.map(file =>
      file
        .split('/')
        .at(-1)!
        .replace(/\.html$/, '')
    )
  );
  const keep = (ref: { kind: 'part' | 'pattern'; slug: string }, where: string): string | null => {
    const file =
      ref.kind === 'part'
        ? [`parts/${ref.slug}.html`, `block-template-parts/${ref.slug}.html`].find(item =>
            files.includes(item)
          )
        : patterns.get(ref.slug)?.file;
    if (!file) {
      missed.push({
        what: where,
        why: `it places the ${ref.kind === 'part' ? 'template part' : 'pattern'} ${ref.slug}, which is not in the theme`
      });
      return null;
    }
    const exported = `${ref.kind} ${ref.slug}`;
    const key = `${file}#${exported}`;
    if (!components.has(key)) {
      const name =
        ref.kind === 'part'
          ? (partInfo.get(ref.slug)?.title ?? humanName(ref.slug))
          : (patterns.get(ref.slug)?.title ?? humanName(ref.slug.split('/').at(-1)!));
      components.set(key, {
        key,
        name,
        kind: 'section',
        files: [file],
        export: exported,
        fixture: null,
        fixtureFrom: null
      });
    }
    return key;
  };
  const used = new Set<string>();
  const visit = (text: string, where: string, depth = 0) => {
    for (const ref of blockRefs(text)) {
      if (ref.kind === 'synced') continue;
      const file =
        ref.kind === 'part' ? `parts/${ref.slug}.html` : (patterns.get(ref.slug)?.file ?? null);
      if (!file || used.has(file)) continue;
      used.add(file);
      if (depth < 4) visit(readText(input.repo, file) ?? '', file, depth + 1);
    }
  };
  const pages: FoundPage[] = [];
  const placements: { page: FoundPage; keys: { key: string; part: string | null }[] }[] = [];
  for (const file of templates) {
    const text = readText(input.repo, file) ?? '';
    visit(text, file);
    const base = file
      .split('/')
      .at(-1)!
      .replace(/\.html$/, '');
    const info = hierarchy(base, name => bases.has(name));
    if ('skip' in info) {
      missed.push({ what: file, why: info.skip });
      continue;
    }
    const page: FoundPage = {
      address: info.address,
      name: info.name,
      files: [file],
      sections: [],
      signIn: 'unknown',
      example: info.example
    };
    const keys: { key: string; part: string | null }[] = [];
    for (const ref of blockRefs(text)) {
      if (ref.kind === 'synced') {
        missed.push({
          what: file,
          why: `it places a synced pattern (${ref.slug}) kept in the site's database, which only the running site has`
        });
        continue;
      }
      const key = keep({ kind: ref.kind, slug: ref.slug }, file);
      if (key) keys.push({ key, part: ref.kind === 'part' ? ref.slug : null });
    }
    pages.push(page);
    placements.push({ page, keys });
  }
  // Shared: the header and footer areas, and any part every page places.
  const withParts = placements.filter(item => item.keys.some(key => key.part));
  const isShared = (part: string, key: string) =>
    PART_AREAS.has(partInfo.get(part)?.area ?? '') ||
    PART_AREAS.has(part) ||
    (withParts.length > 1 && withParts.every(item => item.keys.some(other => other.key === key)));
  const shared: FoundPage = {
    address: null,
    name: null,
    files: [],
    sections: [],
    signIn: 'unknown',
    example: null
  };
  for (const { page, keys } of placements) {
    for (const { key, part } of keys) {
      if (part && isShared(part, key)) {
        if (!shared.sections.includes(key)) shared.sections.push(key);
        components.get(key)!.kind = 'shared';
      } else if (!page.sections.includes(key)) {
        page.sections.push(key);
      }
    }
    if (!page.sections.length) {
      missed.push({
        what: page.files[0]!,
        why: "it shows the post's or page's own blocks between the shared parts, with no part or pattern of its own"
      });
    }
  }
  for (const key of shared.sections) shared.files.push(components.get(key)!.files[0]!);
  if (shared.sections.length) pages.unshift(shared);
  const unplaced = files.filter(
    file =>
      (/^(parts|block-template-parts)\/[^/]+\.html$/.test(file) ||
        /^patterns\/[^/]+\.php$/.test(file)) &&
      !used.has(file)
  );
  return {
    by: 'wordpress',
    pages: sortPages(pages),
    components: [...components.values()],
    missed,
    unplaced
  };
}

/** The classic theme's own template names, at its root. */
const CLASSIC_TEMPLATE =
  /^(front-page|home|index|page|single|singular|archive|category|tag|author|date|search|404|privacy-policy|attachment|(?:page|single|archive|taxonomy|category|tag|author)-[\w-]+)\.php$/;

function classicTheme(input: DiscoverInput, files: string[]): Discovered {
  const missed: Missed[] = [];
  const components = new Map<string, FoundComponent>();
  const templates = files.filter(file => CLASSIC_TEMPLATE.test(file));
  const bases = new Set(templates.map(file => file.replace(/\.php$/, '')));
  const used = new Set<string>();
  const keep = (file: string, exported: string, kind: FoundComponent['kind']) => {
    const key = `${file}#${exported}`;
    used.add(file);
    if (!components.has(key)) {
      components.set(key, {
        key,
        name: humanName(
          file
            .split('/')
            .at(-1)!
            .replace(/\.php$/, '')
        ),
        kind,
        files: [file],
        export: exported,
        fixture: null,
        fixtureFrom: null
      });
    }
    return key;
  };
  /** The files a template loads, in order: [file, export, shared]. */
  const loads = (text: string): [string, string, boolean][] => {
    const found: [string, string, boolean][] = [];
    for (const match of text.matchAll(
      /\b(get_header|get_footer|get_sidebar|get_template_part)\s*\(\s*(?:(['"])([^'"]*)\2)?\s*(?:,\s*(['"])([^'"]*)\4)?/g
    )) {
      const [, call, , first, , second] = match;
      if (call === 'get_template_part') {
        if (!first) continue;
        const file = [second ? `${first}-${second}.php` : null, `${first}.php`].find(
          item => item && files.includes(item)
        );
        if (file) found.push([file, `part ${file.replace(/\.php$/, '')}`, false]);
        continue;
      }
      const base = call!.slice(4);
      const file = [first ? `${base}-${first}.php` : null, `${base}.php`].find(
        item => item && files.includes(item)
      );
      if (file) found.push([file, `${base}${first ? ` ${first}` : ''}`, base !== 'sidebar']);
    }
    return found;
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
  for (const file of templates) {
    const base = file.replace(/\.php$/, '');
    const info = hierarchy(base, name => bases.has(name));
    const text = readText(input.repo, file) ?? '';
    const loaded = loads(text);
    for (const [part] of loaded) {
      used.add(part);
      for (const [deeper] of loads(readText(input.repo, part) ?? '')) used.add(deeper);
    }
    if ('skip' in info) {
      missed.push({ what: file, why: info.skip });
      continue;
    }
    const page: FoundPage = {
      address: info.address,
      name: info.name,
      files: [file],
      sections: [],
      signIn: 'unknown',
      example: info.example
    };
    for (const [part, exported, isShared] of loaded) {
      const key = keep(part, exported, isShared ? 'shared' : 'section');
      const list = isShared ? shared.sections : page.sections;
      if (!list.includes(key)) list.push(key);
      if (isShared && !shared.files.includes(part)) shared.files.push(part);
    }
    pages.push(page);
  }
  if (shared.sections.length) pages.unshift(shared);
  const unplaced = files.filter(file => /^template-parts\/.+\.php$/.test(file) && !used.has(file));
  return {
    by: 'wordpress',
    pages: sortPages(pages),
    components: [...components.values()],
    missed,
    unplaced
  };
}

export async function discoverWordpress(input: DiscoverInput): Promise<Discovered> {
  const files = listFiles(input);
  const block = files.some(file => /^(templates|block-templates)\/[^/]+\.html$/.test(file));
  return block ? blockTheme(input, files) : classicTheme(input, files);
}
