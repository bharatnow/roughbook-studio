// What a Shopify theme has (B1 of the brownfield plan): its pages are templates/*.json, each
// listing its sections in order, and Shared is the layout's section groups and static sections.
// The theme states all of it outright, so nothing here is guessed; a section's fixture is its
// schema's defaults, which Shopify applies itself.
import { humanName } from '../../map/build.js';
import type {
  Discovered,
  DiscoverInput,
  FoundComponent,
  FoundPage,
  Known,
  Missed
} from '../../map/types.js';
import { listFiles, readText } from '../../map/walk.js';

type TemplateJson = {
  sections?: Record<string, { type?: string; disabled?: boolean }>;
  order?: string[];
};

/** Where each of Shopify's templates answers. */
const TEMPLATES: Record<string, { name: string; address: string; signIn?: Known } | string> = {
  index: { name: 'Home', address: '/' },
  product: { name: 'Product', address: '/products/[handle]' },
  collection: { name: 'Collection', address: '/collections/[handle]' },
  'list-collections': { name: 'Collections', address: '/collections' },
  page: { name: 'Page', address: '/pages/[handle]' },
  blog: { name: 'Blog', address: '/blogs/[blog]' },
  article: { name: 'Article', address: '/blogs/[blog]/[article]' },
  cart: { name: 'Cart', address: '/cart' },
  search: { name: 'Search', address: '/search' },
  'customers/account': { name: 'Account', address: '/account', signIn: 'yes' },
  'customers/order': { name: 'Order', address: '/account/orders/[id]', signIn: 'yes' },
  'customers/addresses': { name: 'Addresses', address: '/account/addresses', signIn: 'yes' },
  'customers/login': { name: 'Sign in', address: '/account/login', signIn: 'no' },
  'customers/register': { name: 'Register', address: '/account/register', signIn: 'no' },
  '404': 'the not-found page: it answers 404 by design, so doctor does not ask it',
  password: 'the password page, shown only while the store is locked',
  gift_card: "the gift card page, reached only through a gift card's own link",
  'customers/activate_account': 'reached only through the link in an email',
  'customers/reset_password': 'reached only through the link in an email'
};

function json<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    // Shopify writes a comment block above a template's JSON, and leaves trailing commas in it.
    return JSON.parse(text.replace(/^\s*\/\*[\s\S]*?\*\//, '').replace(/,(\s*[}\]])/g, '$1')) as T;
  } catch {
    return null;
  }
}

export async function discoverShopify(input: DiscoverInput): Promise<Discovered> {
  const files = listFiles(input);
  const missed: Missed[] = [];
  const components = new Map<string, FoundComponent>();
  const used = new Set<string>();
  const keep = (type: string, where: string): string | null => {
    const file = `sections/${type}.liquid`;
    if (!files.includes(file)) {
      missed.push({ what: where, why: `it lists the section ${type}, which is not in sections/` });
      return null;
    }
    used.add(file);
    const exported = `section ${type}`;
    const key = `${file}#${exported}`;
    if (!components.has(key)) {
      const schema = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(
        readText(input.repo, file) ?? ''
      )?.[1];
      const name = json<{ name?: string }>(schema ?? null)?.name;
      components.set(key, {
        key,
        name: name && !name.startsWith('t:') ? name : humanName(type),
        kind: 'section',
        files: [file],
        export: exported,
        fixture: null,
        fixtureFrom: null
      });
    }
    return key;
  };
  /** A template's or a group's sections, in their order, the turned-off and the apps' named. */
  const sectionsOf = (data: TemplateJson, where: string): string[] => {
    const keys: string[] = [];
    const order = data.order ?? Object.keys(data.sections ?? {});
    for (const id of order) {
      const section = data.sections?.[id];
      if (!section?.type) continue;
      if (section.type === 'apps' || section.type.startsWith('_') || section.type.includes('://')) {
        missed.push({ what: where, why: `its ${id} section is filled by the store's apps` });
        continue;
      }
      if (section.disabled) {
        missed.push({ what: where, why: `its ${id} section, ${section.type}, is turned off` });
        continue;
      }
      const key = keep(section.type, where);
      if (key && !keys.includes(key)) keys.push(key);
    }
    return keys;
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
  const layout = readText(input.repo, 'layout/theme.liquid');
  if (layout !== null) {
    shared.files.push('layout/theme.liquid');
    for (const match of layout.matchAll(/\{%-?\s*(sections|section)\s+['"]([^'"]+)['"]/g)) {
      if (match[1] === 'sections') {
        const group = `sections/${match[2]}.json`;
        const data = json<TemplateJson>(readText(input.repo, group));
        if (!data) continue;
        shared.files.push(group);
        for (const key of sectionsOf(data, group)) {
          if (!shared.sections.includes(key)) shared.sections.push(key);
        }
      } else {
        const key = keep(match[2]!, 'layout/theme.liquid');
        if (key && !shared.sections.includes(key)) shared.sections.push(key);
      }
    }
  }
  for (const key of shared.sections) components.get(key)!.kind = 'shared';
  if (shared.sections.length) pages.push(shared);

  for (const file of files.filter(item => /^templates\/.+\.(json|liquid)$/.test(item))) {
    const name = file.replace(/^templates\//, '').replace(/\.(json|liquid)$/, '');
    const [base, alternate] = name.includes('/')
      ? [name.split('.')[0]!, name.split('.').slice(1).join('.')]
      : [name.split('.')[0]!, name.split('.').slice(1).join('.')];
    const info = TEMPLATES[base];
    if (info === undefined) {
      missed.push({ what: file, why: 'a template whose address the theme does not say' });
      continue;
    }
    if (typeof info === 'string') {
      missed.push({ what: file, why: info });
      continue;
    }
    const sections = file.endsWith('.json')
      ? sectionsOf(json<TemplateJson>(readText(input.repo, file)) ?? {}, file)
      : [...(readText(input.repo, file) ?? '').matchAll(/\{%-?\s*section\s+['"]([^'"]+)['"]/g)]
          .map(match => keep(match[1]!, file))
          .filter((key): key is string => Boolean(key));
    pages.push({
      address: alternate ? `${info.address}?view=${alternate}` : info.address,
      name: alternate ? `${info.name} (${alternate})` : info.name,
      files: [file],
      sections: sections.filter(key => !shared.sections.includes(key)),
      signIn: info.signIn ?? 'unknown',
      example: null
    });
  }
  pages.sort((a, b) =>
    a.address === null ? -1 : b.address === null ? 1 : a.address.localeCompare(b.address)
  );
  const unplaced = files.filter(file => /^sections\/[^/]+\.liquid$/.test(file) && !used.has(file));
  return { by: 'shopify', pages, components: [...components.values()], missed, unplaced };
}
