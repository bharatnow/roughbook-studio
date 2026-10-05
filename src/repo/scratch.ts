// `roughbook init --scratch <dir>`: a minimal Next.js 16 app with Tailwind v4, for a project that
// has no repo yet, following Next.js's manual installation. Nothing is installed here; the
// designer runs npm install.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function scratchFiles(name: string): Record<string, string> {
  const pkg = PACKAGE_NAME.test(name) ? name : 'scratch-site';
  return {
    'package.json': `${JSON.stringify(
      {
        name: pkg,
        version: '0.1.0',
        private: true,
        scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
        dependencies: { next: '^16.3.8', react: '^19.3.0', 'react-dom': '^19.3.0' },
        devDependencies: {
          '@tailwindcss/postcss': '^4.3.3',
          '@types/node': '^24.19.1',
          '@types/react': '^19.3.0',
          '@types/react-dom': '^19.3.0',
          tailwindcss: '^4.3.3',
          typescript: '^5.9.3'
        }
      },
      null,
      2
    )}\n`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2017',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'react-jsx',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./src/*'] }
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules']
      },
      null,
      2
    )}\n`,
    'next.config.ts': `import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
`,
    'postcss.config.mjs': `const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
`,
    '.gitignore': `/node_modules
/.next/
/out/
next-env.d.ts
*.tsbuildinfo
.env*.local
`,
    'src/app/globals.css': `@import "tailwindcss";
`,
    'src/app/layout.tsx': `import type { ReactNode } from "react";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    'src/app/page.tsx': `export default function Page() {
  return <main className="p-8">Designs live in rough/. Run roughbook start to see them.</main>;
}
`
  };
}

/** Why a scratch app cannot be made in `dir`, or null. */
export function checkScratchDir(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  if (!fs.statSync(dir).isDirectory()) return `${dir} is a file.`;
  return fs.readdirSync(dir).length ? `${dir} is not empty.` : null;
}

export function writeScratch(dir: string): void {
  const problem = checkScratchDir(dir);
  if (problem) throw new Error(problem);
  for (const [file, content] of Object.entries(scratchFiles(path.basename(dir).toLowerCase()))) {
    const target = path.join(dir, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/** `git init`, so rough/ has a record from the start. False when git is not installed. */
export function gitInit(dir: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile('git', ['init', '--quiet'], { cwd: dir, windowsHide: true, timeout: 30_000 }, error =>
      resolve(!error)
    );
  });
}
