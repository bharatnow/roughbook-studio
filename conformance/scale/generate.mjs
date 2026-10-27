// The scale app of ROUGHBOOK-BROWNFIELD-PLAN.md's B7 (decision 60): a Next.js app of 1,000
// components and 100 pages, written from a seed, so every run measures the same app. Each page
// imports about ten sections of its own, now and then one of another page's, and every page
// shares the layout's header and footer; the sections use the app's atoms. It is laid over the
// `next` fixture's scaffold (create-next-app 16.4.2), so it builds and runs with `next dev` as
// `next-brownfield` does.
//
//   node conformance/scale/generate.mjs [--out <folder>] [--seed <n>] [--components <n>]
//     [--pages <n>] [--install] [--force]
//
// Without --out it writes into the system's temporary folder, as roughbook-scale-<seed>. It writes
// only into a folder that is empty or that it wrote before (--force clears that one first).
// --install runs npm ci there. It prints the folder.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The scaffold the app is laid over. */
export const SCAFFOLD = path.join(here, '..', 'fixtures', 'next');
/** The file that says a folder is a scale app, so --force clears nothing else. */
export const MARKER = 'ROUGHBOOK-SCALE.md';
export const DEFAULTS = { seed: 1, components: 1000, pages: 100 };
/** The parts every page shares, in the layout. */
const SHARED = 2;

/** A small, fast, seeded generator (mulberry32): the same seed gives the same app on every OS. */
export function random(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  const pick = list => list[Math.floor(next() * list.length)];
  return { next, int, pick };
}

const AREAS = [
  'solutions',
  'product',
  'company',
  'resources',
  'customers',
  'pricing',
  'learn',
  'partners',
  'industries',
  'support',
  'events',
  'careers'
];
const TOPICS = [
  'billing',
  'reports',
  'teams',
  'security',
  'mobile',
  'analytics',
  'automation',
  'integrations',
  'onboarding',
  'planning',
  'roadmaps',
  'feedback',
  'hiring',
  'finance',
  'retail',
  'health',
  'education',
  'agencies',
  'startups',
  'enterprise',
  'nonprofits',
  'webinars',
  'guides',
  'stories',
  'press',
  'legal',
  'status',
  'community',
  'templates',
  'docs',
  'api',
  'changelog',
  'trust',
  'accessibility',
  'design',
  'engineering',
  'marketing',
  'sales',
  'operations',
  'research'
];
const QUALITIES = [
  'Feature',
  'Pricing',
  'Customer',
  'Team',
  'Story',
  'Plan',
  'Metric',
  'Partner',
  'Product',
  'Launch',
  'Press',
  'Event',
  'Guide',
  'Trust',
  'Roadmap',
  'Integration',
  'Review',
  'Contact'
];
const SHAPES = [
  'Hero',
  'Grid',
  'List',
  'Banner',
  'Quotes',
  'Strip',
  'Wall',
  'Cards',
  'Table',
  'Timeline',
  'Callout',
  'Gallery',
  'Steps',
  'Stats',
  'Spotlight',
  'Panel',
  'Showcase',
  'Highlights'
];
const ATOMS = [
  'Button',
  'Badge',
  'Card',
  'Heading',
  'Eyebrow',
  'Lead',
  'Stat',
  'Avatar',
  'Divider',
  'Pill',
  'Icon',
  'Quote',
  'Tag',
  'Notice',
  'LinkArrow',
  'Price',
  'Rating',
  'Logo',
  'Chip',
  'Kicker',
  'Caption',
  'Meter',
  'Dot',
  'Label',
  'Frame',
  'Stack',
  'Row',
  'Media',
  'Figure',
  'Hint'
];
const WORDS = [
  'plans',
  'teams',
  'ship',
  'quiet',
  'clear',
  'every',
  'week',
  'review',
  'boards',
  'notes',
  'faster',
  'together',
  'calm',
  'focus',
  'simple',
  'growth',
  'trusted',
  'daily',
  'launch',
  'craft'
];

const kebab = name => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const title = slug =>
  slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
const sentence = (rng, count) => {
  const words = Array.from({ length: count }, () => rng.pick(WORDS));
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return `${words.join(' ')}.`;
};

/**
 * The app's plan, from its seed: its atoms, pages (the first is Home, at /) and each page's
 * sections in order. Pure; `files` writes it out.
 */
export function plan(options = {}) {
  const { seed, components, pages: pageCount } = { ...DEFAULTS, ...options };
  const rng = random(seed);
  const atomCount = Math.min(ATOMS.length, Math.max(1, Math.round(components * 0.03)));
  const sectionCount = components - SHARED - atomCount;
  if (sectionCount < pageCount) {
    throw new Error(`${components} components are too few for ${pageCount} pages.`);
  }
  const atoms = ATOMS.slice(0, atomCount);

  // Pages: Home, then <area>/<topic>, each address once.
  const pages = [{ slug: 'home', address: '/', folder: 'home', route: 'app/page.tsx' }];
  const used = new Set(['/']);
  while (pages.length < pageCount) {
    const area = rng.pick(AREAS);
    const topic = rng.pick(TOPICS);
    let address = `/${area}/${topic}`;
    for (let n = 2; used.has(address); n += 1) address = `/${area}/${topic}-${n}`;
    used.add(address);
    const folder = address.slice(1).replace('/', '-');
    pages.push({ slug: folder, address, folder, route: `app${address}/page.tsx` });
  }

  // Each page's own sections: as even as the count allows, a few more or fewer on some pages.
  const counts = pages.map(() => Math.floor(sectionCount / pageCount));
  for (let left = sectionCount - counts.reduce((a, b) => a + b, 0); left > 0; left -= 1) {
    counts[rng.int(0, pageCount - 1)] += 1;
  }
  for (let swap = 0; swap < pageCount; swap += 1) {
    const from = rng.int(0, pageCount - 1);
    const to = rng.int(0, pageCount - 1);
    if (counts[from] > 6 && counts[to] < 14) {
      counts[from] -= 1;
      counts[to] += 1;
    }
  }
  const sections = [];
  for (const [index, page] of pages.entries()) {
    const names = new Set();
    page.sections = [];
    for (let n = 0; n < counts[index]; n += 1) {
      let name = n === 0 ? 'Hero' : `${rng.pick(QUALITIES)}${rng.pick(SHAPES)}`;
      for (let k = 2; names.has(name); k += 1) name = `${name.replace(/\d+$/, '')}${k}`;
      names.add(name);
      const section = {
        name,
        file: `components/${page.folder}/${kebab(name)}.tsx`,
        exportDefault: rng.next() < 0.25,
        atoms: [...new Set(Array.from({ length: rng.int(1, 3) }, () => rng.pick(atoms)))],
        copy: sentence(rng, rng.int(4, 9))
      };
      sections.push(section);
      page.sections.push(section);
    }
  }
  // About one page in five also shows a section of another page's, as real apps reuse them.
  for (const page of pages) {
    if (rng.next() >= 0.2) continue;
    const other = rng.pick(pages);
    if (other === page) continue;
    const borrowed = rng.pick(other.sections);
    if (page.sections.some(section => section.name === borrowed.name)) continue;
    page.sections.splice(rng.int(1, page.sections.length), 0, borrowed);
  }
  return { seed, components, atoms, pages, sections };
}

function atomFile(name, index) {
  const tag = ['span', 'div', 'p', 'strong'][index % 4];
  return `import type { ReactNode } from "react";

export function ${name}({ children }: { children?: ReactNode }) {
  return <${tag} className="scale-${kebab(name)}">{children}</${tag}>;
}
`;
}

function sectionFile(section) {
  const imports = section.atoms
    .map(atom => `import { ${atom} } from "@/components/ui/${kebab(atom)}";`)
    .join('\n');
  const body = section.atoms.map(atom => `      <${atom}>${section.copy}</${atom}>`).join('\n');
  return `${imports}

export ${section.exportDefault ? 'default ' : ''}function ${section.name}() {
  return (
    <section className="px-6 py-12" data-scale="${kebab(section.name)}">
      <h2 className="text-2xl font-semibold">${title(kebab(section.name))}</h2>
${body}
    </section>
  );
}
`;
}

function pageFile(page) {
  const local = new Map();
  const imports = [];
  for (const section of page.sections) {
    // Two pages' sections may share a name: the borrowed one is imported under another.
    let as = section.name;
    for (let n = 2; local.has(as) && local.get(as) !== section; n += 1) as = `${section.name}${n}`;
    if (local.get(as) === section) continue;
    local.set(as, section);
    const from = `@/${section.file.replace(/\.tsx$/, '')}`;
    if (section.exportDefault) imports.push(`import ${as} from "${from}";`);
    else if (as === section.name) imports.push(`import { ${as} } from "${from}";`);
    else imports.push(`import { ${section.name} as ${as} } from "${from}";`);
  }
  const name = `${page.folder
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
    .replace(/^\d/, 'P$&')}Page`;
  const shown = [...local.keys()].map(as => `      <${as} />`).join('\n');
  return `${imports.join('\n')}

export default function ${name}() {
  return (
    <>
${shown}
    </>
  );
}
`;
}

const LAYOUT = `import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export const metadata: Metadata = {
  title: "Scale",
  description: "Roughbook's scale app: 1,000 components and 100 pages, generated.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
`;

function headerFile(pages) {
  const links = pages
    .slice(1, 6)
    .map(page => `  { href: "${page.address}", label: "${title(page.folder)}" },`)
    .join('\n');
  return `import Link from "next/link";

const LINKS = [
${links}
];

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
      <Link href="/">Scale</Link>
      <nav className="flex gap-6 text-sm">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
`;
}

const FOOTER = `export function SiteFooter() {
  return (
    <footer className="px-6 py-8 border-t border-zinc-200 text-sm text-zinc-600">
      Scale, a generated app.
    </footer>
  );
}
`;

/** The app's own files, by repo-relative path, over the scaffold's. */
export function files(options = {}) {
  const app = plan(options);
  const out = {
    'app/layout.tsx': LAYOUT,
    'components/layout/site-header.tsx': headerFile(app.pages),
    'components/layout/site-footer.tsx': FOOTER,
    [MARKER]: `# Scale app (seed ${app.seed})

Written by roughbook-studio's conformance/scale/generate.mjs for B7 of
ROUGHBOOK-BROWNFIELD-PLAN.md: ${app.components} components (${app.sections.length} sections, ${SHARED} shared parts and
${app.atoms.length} atoms) on ${app.pages.length} pages, over the \`next\` fixture's scaffold. Generate it again
rather than editing it.
`
  };
  for (const [index, atom] of app.atoms.entries()) {
    out[`components/ui/${kebab(atom)}.tsx`] = atomFile(atom, index);
  }
  for (const section of app.sections) out[section.file] = sectionFile(section);
  for (const page of app.pages) out[page.route] = pageFile(page);
  return out;
}

/** Writes the app into `dir`: the scaffold, then its own files. Returns the plan. */
export function writeApp(dir, options = {}) {
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  if (existing.length) {
    if (!existing.includes(MARKER)) {
      throw new Error(`${dir} is not empty and is not a scale app; choose another --out.`);
    }
    if (!options.force)
      throw new Error(`${dir} already holds a scale app; add --force to replace it.`);
    for (const entry of existing) {
      if (entry === 'node_modules') continue;
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(SCAFFOLD)) {
    if (['node_modules', '.next', 'README.md', 'ROUGHBOOK-FIXTURE.md'].includes(entry)) continue;
    fs.cpSync(path.join(SCAFFOLD, entry), path.join(dir, entry), { recursive: true });
  }
  fs.rmSync(path.join(dir, 'app', 'page.tsx'), { force: true });
  for (const [file, text] of Object.entries(files(options))) {
    const target = path.join(dir, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return plan(options);
}

function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      seed: { type: 'string' },
      components: { type: 'string' },
      pages: { type: 'string' },
      install: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false }
    }
  });
  const number = (value, fallback) => {
    if (value === undefined) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${value} is not a whole number above 0.`);
    return n;
  };
  const options = {
    seed: number(values.seed, DEFAULTS.seed),
    components: number(values.components, DEFAULTS.components),
    pages: number(values.pages, DEFAULTS.pages),
    force: values.force
  };
  const dir = path.resolve(values.out ?? path.join(os.tmpdir(), `roughbook-scale-${options.seed}`));
  const started = performance.now();
  const app = writeApp(dir, options);
  const count = app.atoms.length + SHARED + app.sections.length;
  console.error(
    `Wrote ${count} components on ${app.pages.length} pages in ${Math.round(performance.now() - started)} ms.`
  );
  if (values.install) {
    const ran = spawnSync('npm ci --no-audit --no-fund', {
      cwd: dir,
      stdio: 'inherit',
      shell: true,
      windowsHide: true
    });
    if (ran.status !== 0) process.exit(ran.status ?? 1);
  }
  console.log(dir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
