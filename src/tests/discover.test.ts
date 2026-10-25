// The discoverers (ROUGHBOOK-BROWNFIELD-PLAN.md, B1): each reads what its stack declares, on a
// small app written here, and finds its pages (routes, dynamic routes, layouts), the sections of
// each in the order the page shows them, the parts every page shares, the atoms told apart, and
// says what it could not place and why. Reading only: nothing is installed, built or run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { discoverNext } from '../recipes/next/discover.js';
import type { Discovered } from '../map/types.js';
import { tempDir } from './helpers.js';

function write(repo: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(repo, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
}

const INPUT = (repo: string) => ({
  repo,
  ignore: ['node_modules', '.git', '.next'],
  own: ['app/rough-preview']
});

function pageAt(found: Discovered, address: string | null) {
  const page = found.pages.find(item => item.address === address);
  assert.ok(page, `no page at ${address}: ${found.pages.map(item => item.address).join(', ')}`);
  return page;
}

function names(found: Discovered, keys: string[]): string[] {
  return keys.map(key => found.components.find(item => item.key === key)?.name ?? `?${key}`);
}

/** A Next.js app as agencies write them: a shell, sections, barrels, a view per page, a dashboard. */
const NEXT_APP: Record<string, string> = {
  'package.json': '{ "dependencies": { "next": "16.0.0", "react": "19.0.0" } }\n',
  'tsconfig.json': '{ "compilerOptions": { "jsx": "preserve", "paths": { "@/*": ["./*"] } } }\n',
  'app/layout.tsx': `import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/layout/site-header";
import SiteFooter from "@/components/layout/site-footer";
import { Toaster } from "@/components/ui/toaster";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteHeader />
          {children}
          <SiteFooter />
        </Providers>
        <Toaster />
      </body>
    </html>
  );
}
`,
  'app/globals.css': 'body { margin: 0; }\n',
  'app/page.tsx': `import Hero from "@/components/home/hero";
import { Features, Pricing } from "@/components/home";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";

const Testimonials = dynamic(() => import("@/components/home/testimonials"));

function Faq() {
  return <div><Button>Ask</Button></div>;
}

export default function HomePage() {
  return (
    <main>
      <Hero title="Plan less" />
      <Section title="What you get">
        <Features />
      </Section>
      <Testimonials />
      <Pricing />
      <Faq />
    </main>
  );
}
`,
  'app/about/page.tsx': `import AboutView from "@/components/about/about-view";

export const metadata = { title: "About" };

export default function Page() {
  return <AboutView />;
}
`,
  'app/blog/page.tsx': `import { PostList } from "@/components/blog/post-list";
export default async function Blog() {
  return <PostList />;
}
`,
  'app/blog/[slug]/page.tsx': `import { PostBody } from "@/components/blog/post-body";
import { PostHeader } from "@/components/blog/post-header";
export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (<article><PostHeader slug={slug} /><PostBody slug={slug} /></article>);
}
`,
  'app/(app)/layout.tsx': `import { Sidebar } from "@/components/dashboard/sidebar";
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex"><Sidebar />{children}</div>;
}
`,
  'app/(app)/dashboard/page.tsx': `"use client";
import { Stats } from "@/components/dashboard/stats";
export default function Dashboard() { return <Stats />; }
`,
  'app/docs/[...path]/page.mdx': '# Docs\n',
  'app/@modal/(.)photo/page.tsx': 'export default function Modal() { return null; }\n',
  'app/_private/helper.tsx': 'export function Helper() { return null; }\n',
  'app/api/health/route.ts': 'export function GET() { return Response.json({ ok: true }); }\n',
  'app/rough-preview/[...slug]/page.tsx':
    'export default function RoughPreview() { return null; }\n',
  'app/not-found.tsx': `import { Button } from "@/components/ui/button";
export default function NotFound() { return <Button>Home</Button>; }
`,
  'components/providers.tsx': `"use client";
import { ThemeProvider } from "next-themes";
export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
`,
  'components/layout/site-header.tsx': `import Link from "next/link";
import { Logo } from "@/components/ui/logo";
export function SiteHeader() { return <header><Logo /><Link href="/">Home</Link></header>; }
`,
  'components/layout/site-footer.tsx':
    'export default function SiteFooter() { return <footer>Footer</footer>; }\n',
  'components/home/index.ts': `export { Features } from "./features";
export * from "./pricing";
`,
  'components/home/hero.tsx': `import { Button } from "@/components/ui/button";
export default function Hero({ title }: { title: string }) {
  return <section><h1>{title}</h1><Button>Start</Button></section>;
}
`,
  'components/home/hero.stories.tsx': `import Hero from "./hero";
const meta = { title: "Home/Hero", component: Hero, args: { title: "Plan less" } };
export default meta;
export const Default = { args: { title: 'Ship more', cta: { label: "Start", href: "/start" }, tags: ["a", 'b'], count: 3, open: true, } };
export const Long = { args: { title: "A much longer title" } };
`,
  'components/home/features.tsx': 'export function Features() { return <ul><li>Fast</li></ul>; }\n',
  'components/home/pricing.tsx': `import { getPlans } from "@/lib/plans";
export async function Pricing() {
  const plans = await getPlans();
  return <section>{plans.map((plan) => <p key={plan}>{plan}</p>)}</section>;
}
`,
  'components/home/testimonials.tsx':
    'export default function Testimonials() { return <blockquote>Good</blockquote>; }\n',
  'components/about/about-view.tsx': `import { Team } from "./team";
import { Mission } from "./mission";
export default function AboutView() {
  return <><Mission /><Team /></>;
}
`,
  'components/about/team.tsx': 'export function Team() { return <p>Team</p>; }\n',
  'components/about/mission.tsx': 'export function Mission() { return <p>Mission</p>; }\n',
  'components/blog/post-list.tsx': 'export function PostList() { return <ol></ol>; }\n',
  'components/blog/post-header.tsx':
    'export function PostHeader({ slug }: { slug: string }) { return <h1>{slug}</h1>; }\n',
  'components/blog/post-body.tsx':
    'export function PostBody({ slug }: { slug: string }) { return <div>{slug}</div>; }\n',
  'components/dashboard/sidebar.tsx': 'export function Sidebar() { return <nav />; }\n',
  'components/dashboard/stats.tsx': 'export function Stats() { return <dl />; }\n',
  'components/ui/button.tsx':
    'export function Button(props: { children: React.ReactNode }) { return <button>{props.children}</button>; }\n',
  'components/ui/section.tsx':
    'export function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section><h2>{title}</h2>{children}</section>; }\n',
  'components/ui/logo.tsx': 'export function Logo() { return <svg />; }\n',
  'components/ui/toaster.tsx': 'export function Toaster() { return null; }\n',
  'components/old-banner.tsx': 'export function OldBanner() { return <aside>Sale</aside>; }\n',
  'lib/plans.ts': 'export async function getPlans() { return ["Free", "Pro"]; }\n'
};

describe('the Next.js discoverer', () => {
  it('finds every route, dynamic ones and layouts, and what it cannot place', async () => {
    const repo = await tempDir();
    write(repo, NEXT_APP);
    const found = await discoverNext(INPUT(repo));
    assert.equal(found.by, 'next');
    assert.deepEqual(
      found.pages.map(page => page.address),
      [null, '/', '/about', '/blog', '/blog/[slug]', '/dashboard', '/docs/[...path]']
    );
    assert.deepEqual(pageAt(found, '/').files, ['app/page.tsx']);
    assert.deepEqual(pageAt(found, '/dashboard').files, ['app/(app)/dashboard/page.tsx']);
    // Shared is made of every layout's parts.
    assert.deepEqual(pageAt(found, null).files, ['app/layout.tsx', 'app/(app)/layout.tsx']);
    const missed = Object.fromEntries(found.missed.map(item => [item.what, item.why]));
    assert.match(missed['app/@modal/(.)photo/page.tsx']!, /intercepting route/);
    assert.match(missed['app/docs/[...path]/page.mdx']!, /MDX/);
    assert.match(missed['app/page.tsx']!, /Faq is defined inside the page file/);
    assert.ok(!found.pages.some(page => page.files.some(file => file.includes('rough-preview'))));
    assert.ok(!found.pages.some(page => page.files.some(file => file.includes('_private'))));
  });

  it('lists each page’s sections in the order the page shows them, through barrels and views', async () => {
    const repo = await tempDir();
    write(repo, NEXT_APP);
    const found = await discoverNext(INPUT(repo));
    assert.deepEqual(names(found, pageAt(found, '/').sections), [
      'Hero',
      'Features',
      'Testimonials',
      'Pricing'
    ]);
    // A page that renders one view: the view's sections, and the view among the page's files.
    const about = pageAt(found, '/about');
    assert.deepEqual(names(found, about.sections), ['Mission', 'Team']);
    assert.deepEqual(about.files, ['app/about/page.tsx', 'components/about/about-view.tsx']);
    // A page that renders one component, which renders none: that component is its one section.
    assert.deepEqual(names(found, pageAt(found, '/blog').sections), ['PostList']);
    assert.deepEqual(names(found, pageAt(found, '/blog/[slug]').sections), [
      'PostHeader',
      'PostBody'
    ]);
    // The barrel is followed to the file that defines the component.
    const features = found.components.find(item => item.name === 'Features')!;
    assert.equal(features.key, 'components/home/features.tsx#Features');
    const pricing = found.components.find(item => item.name === 'Pricing')!;
    assert.deepEqual(pricing.files, ['components/home/pricing.tsx']);
    assert.equal(found.components.find(item => item.name === 'Hero')!.export, 'default');
  });

  it('tells shared parts, sections and atoms apart, and lists what nothing renders', async () => {
    const repo = await tempDir();
    write(repo, NEXT_APP);
    const found = await discoverNext(INPUT(repo));
    // The providers wrap the page and are no part; the toaster is an atom by its folder.
    assert.deepEqual(names(found, pageAt(found, null).sections), [
      'SiteHeader',
      'SiteFooter',
      'Sidebar'
    ]);
    const kinds = Object.fromEntries(found.components.map(item => [item.name, item.kind]));
    assert.equal(kinds.Hero, 'section');
    assert.equal(kinds.SiteHeader, 'shared');
    for (const atom of ['Button', 'Section', 'Logo', 'Toaster']) assert.equal(kinds[atom], 'atom');
    assert.equal(kinds.Providers, undefined);
    // A private folder's file is no route, and nothing renders this one either.
    assert.deepEqual(found.unplaced, ['app/_private/helper.tsx', 'components/old-banner.tsx']);
  });

  it("takes a component's fixture from its story's inputs", async () => {
    const repo = await tempDir();
    write(repo, NEXT_APP);
    const hero = (await discoverNext(INPUT(repo))).components.find(item => item.name === 'Hero')!;
    assert.deepEqual(hero.fixture, {
      title: 'Ship more',
      cta: { label: 'Start', href: '/start' },
      tags: ['a', 'b'],
      count: 3,
      open: true
    });
    assert.equal(hero.fixtureFrom, 'components/home/hero.stories.tsx Default');
  });

  it('reads the Pages Router too, with _app as Shared', async () => {
    const repo = await tempDir();
    write(repo, {
      'package.json': '{ "dependencies": { "next": "14.0.0" } }\n',
      'pages/_app.tsx': `import Layout from "../components/Layout";
export default function App({ Component, pageProps }) {
  return <Layout><Component {...pageProps} /></Layout>;
}
`,
      'pages/_document.tsx': 'export default function Document() { return null; }\n',
      'pages/index.jsx': `import Hero from "../components/Hero";
export default function Home() { return <Hero />; }
`,
      'pages/posts/[id].js': `import Post from "../../components/Post";
export default function PostPage() { return <Post />; }
`,
      'pages/api/hello.ts': 'export default function handler() {}\n',
      'pages/404.tsx': 'export default function Missing() { return null; }\n',
      'components/Layout.jsx': `import Nav from "./Nav";
export default function Layout({ children }) { return <><Nav />{children}</>; }
`,
      'components/Nav.jsx': 'export default function Nav() { return <nav />; }\n',
      'components/Hero.jsx': 'export default function Hero() { return <h1 />; }\n',
      'components/Post.jsx': 'export default function Post() { return <article />; }\n'
    });
    const found = await discoverNext(INPUT(repo));
    assert.deepEqual(
      found.pages.map(page => page.address),
      [null, '/', '/posts/[id]']
    );
    assert.deepEqual(names(found, pageAt(found, null).sections), ['Nav']);
    assert.deepEqual(names(found, pageAt(found, '/').sections), ['Hero']);
    assert.deepEqual(names(found, pageAt(found, '/posts/[id]').sections), ['Post']);
  });

  it('leaves out what shows nothing, and says why a page has no section of its own', async () => {
    const repo = await tempDir();
    write(repo, {
      ...NEXT_APP,
      'app/layout.tsx': `import Script from "next/script";
import { SiteHeader } from "@/components/layout/site-header";
import { JsonLd } from "@/components/seo/json-ld";
import { Analytics } from "@/components/analytics";
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body><JsonLd /><SiteHeader />{children}<Analytics /></body></html>;
}
`,
      'components/seo/json-ld.tsx':
        'export function JsonLd() { return <script type="application/ld+json">{"{}"}</script>; }\n',
      'components/analytics.tsx': `import Script from "next/script";
export function Analytics() { return <Script src="https://example.test/a.js" />; }
`,
      'app/settings/page.tsx': `"use client";
import { Button } from "@/components/ui/button";
export default function Settings() {
  return <form><label>Name<input /></label><Button>Save</Button></form>;
}
`,
      'app/start/page.tsx': `import { redirect } from "next/navigation";
export default function Start() { redirect("/"); }
`
    });
    const found = await discoverNext({ ...INPUT(repo), own: [] });
    assert.deepEqual(names(found, pageAt(found, null).sections), ['SiteHeader', 'Sidebar']);
    const missed = Object.fromEntries(found.missed.map(item => [item.what, item.why]));
    assert.match(missed['components/seo/json-ld.tsx']!, /JsonLd shows nothing on the page/);
    assert.match(missed['components/analytics.tsx']!, /Analytics shows nothing/);
    assert.match(missed['app/settings/page.tsx']!, /content is written inline in the page/);
    assert.match(missed['app/start/page.tsx']!, /it redirects/);
    // The studio's own preview route is left out even when nothing names it.
    assert.ok(!found.pages.some(page => page.address?.startsWith('/rough-preview')));
  });

  it("takes a dynamic page's example from its static params, and a sign-in from the proxy", async () => {
    const repo = await tempDir();
    write(repo, {
      ...NEXT_APP,
      'app/blog/[slug]/page.tsx': `import { PostBody } from "@/components/blog/post-body";
export function generateStaticParams() {
  return [{ slug: "hello-world" }, { slug: "second-post" }];
}
export default async function Post() { return <PostBody slug="x" />; }
`,
      'proxy.ts': `import { NextResponse, type NextRequest } from "next/server";
export function proxy(request: NextRequest) {
  if (!request.cookies.has("session")) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}
export const config = { matcher: ["/dashboard/:path*", "/account"] };
`
    });
    const found = await discoverNext(INPUT(repo));
    assert.equal(pageAt(found, '/blog/[slug]').example, '/blog/hello-world');
    assert.equal(pageAt(found, '/dashboard').signIn, 'yes');
    assert.equal(pageAt(found, '/').signIn, 'unknown');
  });

  it('counts a shell that draws its own chrome, follows a view beside its route and a loader', async () => {
    const repo = await tempDir();
    write(repo, {
      ...NEXT_APP,
      'app/(app)/layout.tsx': `import { DashboardShell } from "@/components/dashboard/shell";
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
`,
      'components/dashboard/shell.tsx': `import { Sidebar } from "./sidebar";
export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      <Sidebar />
      <main>
        <header className="top-bar"><h2>Dashboard</h2></header>
        {children}
      </main>
    </div>
  );
}
`,
      'app/(app)/dashboard/page.tsx': `import { DashboardBody } from "./dashboard-body";
export default function Dashboard() { return <DashboardBody />; }
`,
      'app/(app)/dashboard/dashboard-body.tsx': `import { Stats } from "@/components/dashboard/stats";
import { FullScreenLoader } from "@/components/full-screen-loader";
export function DashboardBody() { return <section><FullScreenLoader /><Stats /></section>; }
`,
      'components/full-screen-loader.tsx':
        'export function FullScreenLoader() { return <div />; }\n',
      'app/kiosk/page.tsx': `import { KioskLoader } from "./kiosk-loader";
export default function KioskPage() { return <KioskLoader />; }
`,
      'app/kiosk/kiosk-loader.tsx': `"use client";
import dynamic from "next/dynamic";
export const KioskLoader = dynamic(() => import("@/components/kiosk"), { ssr: false });
`,
      'components/kiosk.tsx': `import { Camera } from "./camera";
import { Countdown } from "./countdown";
export default function Kiosk() { return <><Camera /><Countdown /></>; }
`,
      'components/camera.tsx': 'export function Camera() { return <video />; }\n',
      'components/countdown.tsx': 'export function Countdown() { return <p />; }\n'
    });
    const found = await discoverNext(INPUT(repo));
    // The shell's own top bar makes it a part, beside the sidebar it renders.
    assert.deepEqual(names(found, pageAt(found, null).sections), [
      'SiteHeader',
      'SiteFooter',
      'DashboardShell',
      'Sidebar'
    ]);
    // A view beside its route is the page's body; a loader is an atom, never a section.
    assert.deepEqual(names(found, pageAt(found, '/dashboard').sections), ['Stats']);
    assert.ok(pageAt(found, '/dashboard').files.includes('app/(app)/dashboard/dashboard-body.tsx'));
    assert.equal(found.components.find(item => item.name === 'FullScreenLoader')?.kind, 'atom');
    // A component that is a dynamic import is the module it imports.
    assert.deepEqual(names(found, pageAt(found, '/kiosk').sections), ['Camera', 'Countdown']);
  });

  it('keeps a section that is handed small JSX through a prop', async () => {
    const repo = await tempDir();
    write(repo, {
      ...NEXT_APP,
      'app/reports/page.tsx': `import Link from "next/link";
import { PageHeader } from "@/components/reports/page-header";
import { ReportTable } from "@/components/reports/report-table";
export default function Reports() {
  return (
    <div>
      <PageHeader title="Reports" actions={<Link href="/new">New</Link>} />
      <ReportTable empty={<p>No reports yet</p>} />
    </div>
  );
}
`,
      'components/reports/page-header.tsx': `export function PageHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return <header><h1>{title}</h1>{actions}</header>;
}
`,
      'components/reports/report-table.tsx': `export function ReportTable({ empty }: { empty: React.ReactNode }) {
  return <table><tbody><tr><td>{empty}</td></tr></tbody></table>;
}
`
    });
    const found = await discoverNext(INPUT(repo));
    assert.deepEqual(names(found, pageAt(found, '/reports').sections), [
      'PageHeader',
      'ReportTable'
    ]);
  });

  it("reads a page whose server code uses TypeScript's legacy decorators", async () => {
    const repo = await tempDir();
    write(repo, {
      ...NEXT_APP,
      'app/settings/page.tsx': `import { SettingsForm } from "@/components/settings-form";
import { getSettings } from "@/lib/settings-service";
export default async function Settings() { await getSettings(); return <SettingsForm />; }
`,
      'components/settings-form.tsx': 'export function SettingsForm() { return <form />; }\n',
      'lib/settings-service.ts': `function Inject(): ParameterDecorator { return () => {}; }
class Store {}
class SettingsService { constructor(@Inject() private store: Store) {} }
export async function getSettings() { return new SettingsService(new Store()); }
`
    });
    const found = await discoverNext(INPUT(repo));
    assert.deepEqual(names(found, pageAt(found, '/settings').sections), ['SettingsForm']);
    assert.ok(
      !found.missed.some(item => /could not be read/.test(item.why)),
      JSON.stringify(found.missed)
    );
  });

  it('says why when a file does not read, and still maps the rest', async () => {
    const repo = await tempDir();
    write(repo, {
      ...NEXT_APP,
      'app/broken/page.tsx': 'export default function Broken() { return <div>; }\n'
    });
    const found = await discoverNext(INPUT(repo));
    assert.ok(found.pages.some(page => page.address === '/'));
    const broken = found.missed.find(item => item.what === 'app/broken/page.tsx');
    assert.ok(broken, JSON.stringify(found.missed));
    assert.match(broken.why, /could not be read/);
  });

  it('finds nothing, and says so, in a repo with no App Router or Pages Router', async () => {
    const repo = await tempDir();
    write(repo, { 'package.json': '{}\n' });
    const found = await discoverNext(INPUT(repo));
    assert.deepEqual([found.pages, found.components], [[], []]);
  });
});
