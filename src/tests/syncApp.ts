// A generated Next.js app for the map's sync tests (B7 of ROUGHBOOK-BROWNFIELD-PLAN.md): `pages`
// pages of `perPage` sections each, from `components` section files, a shared header and footer
// in the layout. Reproducible: the same sizes give the same files.
import { execFileSync } from 'node:child_process';
import { LINK, write } from './homeApp.js';

export type SyncAppSize = { pages: number; components: number; perPage: number };

export function pascal(index: number): string {
  return `Section${String(index).padStart(4, '0')}`;
}

export function sectionFile(index: number): string {
  return `components/s${Math.floor(index / 100)}/section-${String(index).padStart(4, '0')}.tsx`;
}

export function sectionSource(index: number, extra = ''): string {
  const name = pascal(index);
  return `export function ${name}({ title = "${name}" }: { title?: string }) {\n  return (\n    <section className="${name.toLowerCase()}-block">\n      <h2>{title}</h2>\n      <p>Section ${index} of the generated app, with copy long enough to tell apart.</p>${extra}\n    </section>\n  );\n}\n`;
}

export function pageFile(page: number): string {
  return page === 0 ? 'app/page.tsx' : `app/p${page}/page.tsx`;
}

/** Which sections page `page` shows, in order. */
export function pageSections(page: number, size: SyncAppSize): number[] {
  return Array.from(
    { length: size.perPage },
    (_, at) => (page * size.perPage + at) % size.components
  );
}

export function pageSource(sections: number[]): string {
  const imports = sections
    .map(
      index => `import { ${pascal(index)} } from "@/${sectionFile(index).replace(/\.tsx$/, '')}";`
    )
    .join('\n');
  const body = sections.map(index => `      <${pascal(index)} />`).join('\n');
  return `${imports}\n\nexport default function Page() {\n  return (\n    <main>\n${body}\n    </main>\n  );\n}\n`;
}

/** Writes the app into `repo` and links it, unmapped. */
export function syncApp(repo: string, size: SyncAppSize): void {
  write(repo, 'package.json', '{ "dependencies": { "next": "16.0.0", "react": "19.0.0" } }\n');
  write(repo, 'tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }\n');
  write(
    repo,
    'app/layout.tsx',
    'import { SiteHeader } from "@/components/site-header";\nimport { SiteFooter } from "@/components/site-footer";\n\nexport default function Layout({ children }) {\n  return (\n    <html>\n      <body>\n        <SiteHeader />\n        {children}\n        <SiteFooter />\n      </body>\n    </html>\n  );\n}\n'
  );
  write(
    repo,
    'components/site-header.tsx',
    'export function SiteHeader() {\n  return <header className="site-header">The site</header>;\n}\n'
  );
  write(
    repo,
    'components/site-footer.tsx',
    'export function SiteFooter() {\n  return <footer className="site-footer">The end</footer>;\n}\n'
  );
  for (let index = 0; index < size.components; index += 1) {
    write(repo, sectionFile(index), sectionSource(index));
  }
  for (let page = 0; page < size.pages; page += 1) {
    write(repo, pageFile(page), pageSource(pageSections(page, size)));
  }
  write(repo, 'rough/roughbook.json', JSON.stringify(LINK));
  execFileSync('git', ['init', '--quiet'], { cwd: repo, stdio: 'ignore' });
}
