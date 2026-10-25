// The discoverers of the client-side app stacks (ROUGHBOOK-BROWNFIELD-PLAN.md, B1): Expo Router's
// app/ folder, a Vite app's router, and Nuxt's pages, layouts and auto-imported components. Each
// on a small app written here, reading only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Discovered } from '../map/types.js';
import { recipeFor } from '../recipes/index.js';
import { discoverExpo } from '../recipes/expo/discover.js';
import { discoverNuxt } from '../recipes/nuxt/discover.js';
import { discoverVite } from '../recipes/vite/discover.js';
import { tempDir } from './helpers.js';

function write(repo: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(repo, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
}

const input = (repo: string) => ({
  repo,
  ignore: ['node_modules', '.git', 'dist', '.nuxt'],
  own: []
});

function pageAt(found: Discovered, address: string | null) {
  const page = found.pages.find(item => item.address === address);
  assert.ok(page, `no page at ${address}: ${found.pages.map(item => item.address).join(', ')}`);
  return page;
}

function names(found: Discovered, keys: string[]): string[] {
  return keys.map(key => found.components.find(item => item.key === key)?.name ?? `?${key}`);
}

describe('the Expo discoverer', () => {
  it("reads Expo Router's routes, groups and layouts, and leaves the preview route out", async () => {
    const repo = await tempDir();
    write(repo, {
      'package.json': '{ "dependencies": { "expo": "54.0.0", "expo-router": "6.0.0" } }\n',
      'tsconfig.json':
        '{ "compilerOptions": { "jsx": "react-jsx", "paths": { "@/*": ["./src/*"] } } }\n',
      'src/app/_layout.tsx': `import { Stack } from "expo-router";
import { Banner } from "@/components/banner";
export default function Root() { return <><Banner /><Stack /></>; }
`,
      'src/app/(tabs)/_layout.tsx': `import { Tabs } from "expo-router";
export default function TabsLayout() { return <Tabs />; }
`,
      'src/app/(tabs)/index.tsx': `import { Hero } from "@/components/hero";
import { Feed } from "@/components/feed";
export default function Home() { return <><Hero /><Feed /></>; }
`,
      'src/app/(tabs)/explore.tsx': `import { Search } from "@/components/search";
export default function Explore() { return <Search />; }
`,
      'src/app/post/[id].tsx': `import { Post } from "@/components/post";
export default function PostScreen() { return <Post />; }
`,
      'src/app/+not-found.tsx': 'export default function Missing() { return null; }\n',
      'src/app/+html.tsx': 'export default function Html() { return null; }\n',
      'src/app/api/hello+api.ts': 'export function GET() { return Response.json({}); }\n',
      'src/app/rough-preview/[...key].tsx':
        'export default function RoughPreview() { return null; }\n',
      'src/components/banner.tsx': 'export function Banner() { return <></>; }\n'.replace(
        '<></>',
        '<div />'
      ),
      'src/components/hero.tsx': 'export function Hero() { return <div />; }\n',
      'src/components/feed.tsx': 'export function Feed() { return <div />; }\n',
      'src/components/search.tsx': 'export function Search() { return <div />; }\n',
      'src/components/post.tsx': 'export function Post() { return <div />; }\n'
    });
    const found = await discoverExpo(input(repo));
    assert.equal(found.by, 'expo');
    assert.deepEqual(
      found.pages.map(page => page.address),
      [null, '/', '/explore', '/post/[id]']
    );
    assert.deepEqual(names(found, pageAt(found, null).sections), ['Banner']);
    assert.deepEqual(names(found, pageAt(found, '/').sections), ['Hero', 'Feed']);
    assert.deepEqual(names(found, pageAt(found, '/post/[id]').sections), ['Post']);
  });
});

describe('the Vite discoverer', () => {
  it("reads React Router's routes from the app's own code, and Shared around them", async () => {
    const repo = await tempDir();
    write(repo, {
      'package.json':
        '{ "dependencies": { "react": "19.0.0", "react-router": "7.0.0" }, "devDependencies": { "vite": "7.0.0" } }\n',
      'index.html': '<div id="root"></div>\n<script type="module" src="/src/main.tsx"></script>\n',
      'src/main.tsx': `import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")!).render(<App />);
`,
      'src/App.tsx': `import { BrowserRouter, Routes, Route } from "react-router";
import { Header } from "./components/Header";
import Home from "./pages/Home";
import About from "./pages/About";
import { Product } from "./pages/Product";
export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/products/:id" element={<Product />} />
      </Routes>
    </BrowserRouter>
  );
}
`,
      'src/components/Header.tsx': 'export function Header() { return <header />; }\n',
      'src/components/Hero.tsx': 'export function Hero() { return <section />; }\n',
      'src/components/Team.tsx': 'export function Team() { return <section />; }\n',
      'src/pages/Home.tsx': `import { Hero } from "../components/Hero";
import { Team } from "../components/Team";
export default function Home() { return <main><Hero /><Team /></main>; }
`,
      'src/pages/About.tsx': `import { Team } from "../components/Team";
export default function About() { return <Team />; }
`,
      'src/pages/Product.tsx': 'export function Product() { return <article />; }\n'
    });
    const found = await discoverVite(input(repo));
    assert.equal(found.by, 'vite');
    assert.deepEqual(
      found.pages.map(page => page.address),
      [null, '/', '/about', '/products/:id']
    );
    assert.deepEqual(names(found, pageAt(found, null).sections), ['Header']);
    assert.deepEqual(names(found, pageAt(found, '/').sections), ['Hero', 'Team']);
    assert.deepEqual(names(found, pageAt(found, '/about').sections), ['Team']);
    // A route's element is the page itself: one written in HTML has no section of its own.
    assert.deepEqual(pageAt(found, '/products/:id').sections, []);
    assert.deepEqual(pageAt(found, '/products/:id').files, ['src/pages/Product.tsx']);
    assert.match(
      found.missed.find(item => item.what === 'src/pages/Product.tsx')!.why,
      /written inline/
    );
  });

  it('maps an app with no router as one page', async () => {
    const repo = await tempDir();
    write(repo, {
      'package.json': '{ "devDependencies": { "vite": "7.0.0" } }\n',
      'index.html': '<script type="module" src="/src/main.tsx"></script>\n',
      'src/main.tsx': `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
`,
      'src/App.tsx': `import { Hero } from "./Hero";
import { Counter } from "./Counter";
export default function App() { return <><Hero /><Counter /></>; }
`,
      'src/Hero.tsx': 'export function Hero() { return <h1 />; }\n',
      'src/Counter.tsx': 'export function Counter() { return <button />; }\n'
    });
    const found = await discoverVite(input(repo));
    assert.deepEqual(names(found, pageAt(found, '/').sections), ['Hero', 'Counter']);
  });
});

describe('the Nuxt discoverer', () => {
  it('reads pages, layouts and auto-imported components by their names, in order', async () => {
    const repo = await tempDir();
    write(repo, {
      'package.json': '{ "dependencies": { "nuxt": "4.0.0" } }\n',
      'app/app.vue':
        '<template>\n  <NuxtLayout>\n    <NuxtPage />\n  </NuxtLayout>\n  <CookieBanner />\n</template>\n',
      'app/layouts/default.vue':
        '<template>\n  <div>\n    <SiteHeader />\n    <slot />\n    <SiteFooter />\n  </div>\n</template>\n',
      'app/pages/index.vue': `<script setup lang="ts">
const plans = ['Free', 'Pro'];
</script>

<template>
  <main>
    <HomeHero title="Plan less" />
    <base-card>
      <p>Why us</p>
      <BaseButton>Start</BaseButton>
    </base-card>
    <PlanCard v-for="plan in plans" :key="plan" :plan="plan" />
    <LazyPricingTable />
  </main>
</template>
`,
      'app/pages/blog/[slug].vue': '<template>\n  <article><BlogPost /></article>\n</template>\n',
      'app/components/SiteHeader.vue': '<template><header /></template>\n',
      'app/components/SiteFooter.vue': '<template><footer /></template>\n',
      'app/components/CookieBanner.vue': '<template><aside /></template>\n',
      'app/components/home/Hero.vue': '<template><section /></template>\n',
      'app/components/base/Card.vue': '<template><div><slot /></div></template>\n',
      'app/components/base/BaseButton.vue': '<template><button><slot /></button></template>\n',
      'app/components/PlanCard.vue': '<template><li /></template>\n',
      'app/components/PricingTable.vue': '<template><table /></template>\n',
      'app/components/blog/Post.vue': '<template><div /></template>\n',
      'app/components/OldBanner.vue': '<template><aside /></template>\n'
    });
    const found = await discoverNuxt(input(repo));
    assert.equal(found.by, 'nuxt');
    assert.deepEqual(
      found.pages.map(page => page.address),
      [null, '/', '/blog/[slug]']
    );
    assert.deepEqual(names(found, pageAt(found, null).sections), [
      'CookieBanner',
      'SiteHeader',
      'SiteFooter'
    ]);
    assert.deepEqual(names(found, pageAt(found, '/').sections), ['HomeHero', 'PricingTable']);
    assert.deepEqual(names(found, pageAt(found, '/blog/[slug]').sections), ['BlogPost']);
    const byName = Object.fromEntries(found.components.map(item => [item.name, item]));
    assert.deepEqual(byName.HomeHero!.files, ['app/components/home/Hero.vue']);
    assert.equal(byName.PlanCard!.kind, 'atom');
    assert.equal(byName.BaseButton!.kind, 'atom');
    assert.deepEqual(found.unplaced, ['app/components/OldBanner.vue']);
  });

  it('points an iteration at a component, passing the fixture through', () => {
    const files = recipeFor('nuxt')!.pointer!(
      {
        slug: 'home-hero',
        name: 'Home hero',
        kind: 'section',
        files: ['app/components/home/Hero.vue'],
        export: 'default',
        fixture: null,
        alone: 'unknown',
        why: null,
        byAgent: false
      },
      { iterationDir: 'rough/x/home-hero/iteration-01', fixture: '{ "title": "Plan less" }' }
    )!;
    assert.match(
      files['index.vue']!,
      /import Target from "\.\.\/\.\.\/\.\.\/\.\.\/app\/components\/home\/Hero\.vue";/
    );
    assert.match(files['index.vue']!, /<Target v-bind="\$attrs" \/>/);
    assert.equal(files['preview.json'], '{ "title": "Plan less" }');
  });
});
