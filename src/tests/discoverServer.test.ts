// The discoverers of the stacks that declare their pages on the server or in a theme
// (ROUGHBOOK-BROWNFIELD-PLAN.md, B1): Laravel's routes and Blade views, WordPress's template
// hierarchy, Shopify's templates. Each on a small app written here, reading only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Discovered } from '../map/types.js';
import { recipeFor } from '../recipes/index.js';
import { discoverLaravel } from '../recipes/laravel/discover.js';
import { discoverShopify } from '../recipes/shopify/discover.js';
import { discoverWordpress } from '../recipes/wordpress/discover.js';
import { tempDir } from './helpers.js';

function write(repo: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(repo, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
}

const laravel = recipeFor('laravel')!;
const wordpress = recipeFor('wordpress')!;

const input = (repo: string, own: string[] = []) => ({
  repo,
  ignore: ['vendor', 'node_modules', '.git', 'storage'],
  own
});

function pageAt(found: Discovered, address: string | null) {
  const page = found.pages.find(item => item.address === address);
  assert.ok(page, `no page at ${address}: ${found.pages.map(item => item.address).join(', ')}`);
  return page;
}

function names(found: Discovered, keys: string[]): string[] {
  return keys.map(key => found.components.find(item => item.key === key)?.name ?? `?${key}`);
}

const LARAVEL_APP: Record<string, string> = {
  'composer.json': '{ "require": { "laravel/framework": "^13.0" } }\n',
  'routes/web.php': `<?php

use App\\Http\\Controllers\\PricingController;
use Illuminate\\Support\\Facades\\Route;

// The home page.
Route::get('/', function () {
    return view('home');
})->name('home');

Route::view('/about', 'pages.about')->name('about');
Route::get('/pricing', [PricingController::class, 'index'])->name('pricing');
Route::get('/blog/{post}', [PricingController::class, 'post']);
Route::redirect('/old', '/');
Route::post('/contact', [PricingController::class, 'store']);

Route::middleware(['auth', 'verified'])->prefix('account')->group(function () {
    Route::get('/', fn () => view('account.dashboard'))->name('account');
});

require __DIR__.'/auth.php';

// Roughbook: the development-only preview route (roughbook init), never loaded outside the local environment.
if (app()->environment('local') && is_file(__DIR__.'/rough-preview.php')) {
    require __DIR__.'/rough-preview.php';
}
`,
  'routes/auth.php': `<?php
use Illuminate\\Support\\Facades\\Route;
Route::middleware('guest')->group(function () {
    Route::get('/login', fn () => view('auth.login'));
});
`,
  'routes/rough-preview.php':
    "<?php\nRoute::get('/rough-preview/{key}', fn () => view('rough::x'))->where('key', '.*');\n",
  'app/Http/Controllers/PricingController.php': `<?php
namespace App\\Http\\Controllers;

class PricingController extends Controller
{
    public function index()
    {
        $plans = ['Free', 'Pro'];
        return view('pricing', ['plans' => $plans]);
    }

    public function post(string $post)
    {
        return view('blog.post', compact('post'));
    }

    public function store() { return back(); }
}
`,
  'resources/views/layouts/app.blade.php': `<!DOCTYPE html>
<html>
<head>@vite(['resources/css/app.css'])</head>
<body>
    @include('partials.header')
    <main>@yield('content')</main>
    <x-site-footer />
</body>
</html>
`,
  'resources/views/home.blade.php': `@extends('layouts.app')

@section('title', 'Home')

@section('content')
    @include('sections.hero', ['title' => 'Plan less'])
    <x-features />
    <x-card>
        <h2>Why us</h2>
        <x-button>Start</x-button>
    </x-card>
    @each('partials.plan', $plans ?? [], 'plan')
    @include('sections.pricing')
@endsection
`,
  'resources/views/pages/about.blade.php': `<x-layouts.marketing>
    @include('sections.team')
</x-layouts.marketing>
`,
  'resources/views/pricing.blade.php': `@extends('layouts.app')
@section('content')
    @include('sections.pricing')
@endsection
`,
  'resources/views/blog/post.blade.php': `@extends('layouts.app')
@section('content')
    <article>{{ $post }}</article>
@endsection
`,
  'resources/views/account/dashboard.blade.php': `@extends('layouts.app')
@section('content')
    <livewire:stats />
@endsection
`,
  'resources/views/auth/login.blade.php': '<form><x-input name="email" /></form>\n',
  'resources/views/partials/header.blade.php': '<header><x-logo /></header>\n',
  'resources/views/partials/plan.blade.php': '<li>{{ $plan }}</li>\n',
  'resources/views/sections/hero.blade.php': '<section><h1>{{ $title }}</h1></section>\n',
  'resources/views/sections/pricing.blade.php': '<section>Pricing</section>\n',
  'resources/views/sections/team.blade.php': '<section>Team</section>\n',
  'resources/views/sections/old-banner.blade.php': '<aside>Sale</aside>\n',
  'resources/views/components/site-footer.blade.php': '<footer>Footer</footer>\n',
  'resources/views/components/features.blade.php': "@props(['items' => []])\n<ul></ul>\n",
  'resources/views/components/card.blade.php': '<div class="card">{{ $slot }}</div>\n',
  'resources/views/components/button.blade.php': '<button>{{ $slot }}</button>\n',
  'resources/views/components/input.blade.php': '<input {{ $attributes }}>\n',
  'resources/views/components/logo.blade.php': '<svg></svg>\n',
  'resources/views/components/layouts/marketing.blade.php': `<html><body>
    <x-marketing-nav />
    {{ $slot }}
</body></html>
`,
  'resources/views/components/marketing-nav.blade.php': '<nav></nav>\n',
  'resources/views/welcome.blade.php': '<h1>Welcome</h1>\n'
};

describe('the Laravel discoverer', () => {
  it("finds the routes' pages, their views and their sections in order, and Shared from the layouts", async () => {
    const repo = await tempDir();
    write(repo, LARAVEL_APP);
    const found = await discoverLaravel(input(repo, ['routes/rough-preview.php']));
    assert.equal(found.by, 'laravel');
    assert.deepEqual(
      found.pages.map(page => page.address),
      [null, '/', '/about', '/account', '/blog/{post}', '/login', '/pricing']
    );
    const home = pageAt(found, '/');
    assert.equal(home.name, 'Home');
    assert.deepEqual(home.files, ['resources/views/home.blade.php']);
    // The card wraps content written inline; a list's items are no sections.
    assert.deepEqual(names(found, home.sections), ['hero', 'features', 'pricing']);
    assert.deepEqual(names(found, pageAt(found, '/pricing').sections), ['pricing']);
    assert.deepEqual(names(found, pageAt(found, '/about').sections), ['team']);
    assert.deepEqual(names(found, pageAt(found, null).sections), [
      'header',
      'site-footer',
      'marketing-nav'
    ]);
    // The sign-in is the routes' own: auth middleware, through a group with a prefix.
    assert.equal(pageAt(found, '/account').signIn, 'yes');
    assert.equal(pageAt(found, '/login').signIn, 'no');
    assert.equal(pageAt(found, '/').signIn, 'unknown');
  });

  it('names components by how Blade renders them, and tells atoms apart', async () => {
    const repo = await tempDir();
    write(repo, LARAVEL_APP);
    const found = await discoverLaravel(input(repo, ['routes/rough-preview.php']));
    const byName = Object.fromEntries(found.components.map(item => [item.name, item]));
    assert.equal(byName.hero!.export, 'view sections.hero');
    assert.deepEqual(byName.hero!.files, ['resources/views/sections/hero.blade.php']);
    assert.equal(byName['site-footer']!.export, 'x-site-footer');
    assert.equal(byName['site-footer']!.kind, 'shared');
    for (const atom of ['button', 'input', 'logo', 'plan'])
      assert.equal(byName[atom]?.kind, 'atom', atom);
    const missed = Object.fromEntries(found.missed.map(item => [item.what, item.why]));
    assert.match(missed['resources/views/blog/post.blade.php']!, /written inline/);
    // A Livewire component is a section, rendered by its tag.
    assert.deepEqual(names(found, pageAt(found, '/account').sections), ['stats']);
    assert.equal(byName.stats!.export, 'livewire stats');
    assert.deepEqual(found.unplaced, [
      'resources/views/sections/old-banner.blade.php',
      'resources/views/welcome.blade.php'
    ]);
  });

  it('points an iteration at a view or a component, with the fixture as its variables', () => {
    const pointer = laravel.pointer!;
    const view = pointer(
      {
        slug: 'hero',
        name: 'Hero',
        kind: 'section',
        files: ['resources/views/sections/hero.blade.php'],
        export: 'view sections.hero',
        fixture: null,
        alone: 'unknown',
        why: null,
        byAgent: false
      },
      { iterationDir: 'rough/x/hero/iteration-01', fixture: '{ "title": "Plan less" }\n' }
    )!;
    assert.equal(
      view['index.blade.php'],
      "{{-- Hero, as the app has it: a pointer, never a copy. --}}\n@include('sections.hero')\n"
    );
    assert.equal(view['preview.json'], '{ "title": "Plan less" }\n');
    const component = pointer(
      {
        slug: 'site-footer',
        name: 'Site footer',
        kind: 'shared',
        files: ['resources/views/components/site-footer.blade.php'],
        export: 'x-site-footer',
        fixture: null,
        alone: 'unknown',
        why: null,
        byAgent: false
      },
      {
        iterationDir: 'rough/x/site-footer/iteration-01',
        fixture: '{ "year": 2026, "menuItems": [] }'
      }
    )!;
    assert.match(
      component['index.blade.php']!,
      /<x-dynamic-component component="site-footer" :year="\$year" :menu-items="\$menuItems" \/>/
    );
  });
});

const BLOCK_THEME: Record<string, string> = {
  'style.css': '/*\nTheme Name: Harbor\nText Domain: harbor\n*/\n',
  'theme.json': JSON.stringify({
    version: 3,
    templateParts: [
      { name: 'header', title: 'Header', area: 'header' },
      { name: 'footer', title: 'Footer', area: 'footer' }
    ]
  }),
  'templates/index.html':
    '<!-- wp:template-part {"slug":"header","tagName":"header"} /-->\n<!-- wp:query --><!-- /wp:query -->\n<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->\n',
  'templates/front-page.html': `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->
<!-- wp:group {"tagName":"main"} -->
<main class="wp-block-group"><!-- wp:pattern {"slug":"harbor/hero"} /-->
<!-- wp:pattern {"slug":"harbor/features"} /-->
<!-- wp:template-part {"slug":"newsletter"} /--></main>
<!-- /wp:group -->
<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
`,
  'templates/page.html':
    '<!-- wp:template-part {"slug":"header"} /-->\n<!-- wp:post-content /-->\n<!-- wp:template-part {"slug":"footer"} /-->\n',
  'templates/single.html':
    '<!-- wp:template-part {"slug":"header"} /-->\n<!-- wp:post-title /-->\n<!-- wp:post-content /-->\n<!-- wp:template-part {"slug":"footer"} /-->\n',
  'templates/404.html':
    '<!-- wp:template-part {"slug":"header"} /-->\n<!-- wp:heading --><h2>Not found</h2><!-- /wp:heading -->\n',
  'parts/header.html': '<!-- wp:site-title /-->\n',
  'parts/footer.html': '<!-- wp:paragraph --><p>Footer</p><!-- /wp:paragraph -->\n',
  'parts/newsletter.html': '<!-- wp:paragraph --><p>Sign up</p><!-- /wp:paragraph -->\n',
  'parts/unused.html': '<!-- wp:paragraph --><p>?</p><!-- /wp:paragraph -->\n',
  'patterns/hero.php':
    '<?php\n/**\n * Title: Hero\n * Slug: harbor/hero\n */\n?>\n<!-- wp:heading --><h1>Hello</h1><!-- /wp:heading -->\n',
  'patterns/features.php':
    '<?php\n/**\n * Title: Features\n * Slug: harbor/features\n */\n?>\n<!-- wp:list --><ul><li>Fast</li></ul><!-- /wp:list -->\n'
};

describe('the WordPress discoverer', () => {
  it("reads a block theme's template hierarchy, its parts and its patterns, in order", async () => {
    const repo = await tempDir();
    write(repo, BLOCK_THEME);
    const found = await discoverWordpress(input(repo));
    assert.equal(found.by, 'wordpress');
    assert.deepEqual(
      found.pages.map(page => [page.address, page.name, page.example]),
      [
        [null, null, null],
        ['/', 'Front page', null],
        ['/?p=[id]', 'Single post', '/?p=1'],
        ['/?page_id=[id]', 'Page', '/?page_id=2']
      ]
    );
    assert.deepEqual(names(found, pageAt(found, null).sections), ['Header', 'Footer']);
    assert.deepEqual(names(found, pageAt(found, '/').sections), ['Hero', 'Features', 'Newsletter']);
    const byName = Object.fromEntries(found.components.map(item => [item.name, item]));
    assert.equal(byName.Hero!.export, 'pattern harbor/hero');
    assert.deepEqual(byName.Hero!.files, ['patterns/hero.php']);
    assert.equal(byName.Newsletter!.export, 'part newsletter');
    const missed = Object.fromEntries(found.missed.map(item => [item.what, item.why]));
    assert.match(missed['templates/index.html']!, /fallback/);
    assert.match(missed['templates/404.html']!, /answers 404/);
    assert.deepEqual(found.unplaced, ['parts/unused.html']);
  });

  it('reads a classic theme too', async () => {
    const repo = await tempDir();
    write(repo, {
      'style.css': '/*\nTheme Name: Old\nText Domain: old\n*/\n',
      'index.php': '<?php get_header(); ?>\n<?php get_footer();\n',
      'front-page.php': `<?php get_header(); ?>
<?php get_template_part( 'template-parts/hero' ); ?>
<?php get_template_part( 'template-parts/content', 'home' ); ?>
<?php get_sidebar(); ?>
<?php get_footer();
`,
      'header.php': '<!DOCTYPE html><html><head><?php wp_head(); ?></head><body>\n',
      'footer.php': '<?php wp_footer(); ?></body></html>\n',
      'sidebar.php': '<aside></aside>\n',
      'template-parts/hero.php': '<section>Hero</section>\n',
      'template-parts/content-home.php': '<section>Home</section>\n'
    });
    const found = await discoverWordpress(input(repo));
    assert.deepEqual(names(found, pageAt(found, null).sections), ['Header', 'Footer']);
    assert.deepEqual(names(found, pageAt(found, '/').sections), [
      'Hero',
      'Content home',
      'Sidebar'
    ]);
    assert.equal(
      found.components.find(item => item.name === 'Hero')!.export,
      'part template-parts/hero'
    );
  });

  it('points an iteration at a pattern or a part', () => {
    const pointer = wordpress.pointer!;
    const base = {
      slug: 'hero',
      name: 'Hero',
      kind: 'section' as const,
      files: ['patterns/hero.php'],
      export: 'pattern harbor/hero',
      fixture: null,
      alone: 'unknown' as const,
      why: null,
      byAgent: false
    };
    const pattern = pointer(base, { iterationDir: 'rough/x/hero/iteration-01', fixture: null })!;
    assert.match(pattern['index.php']!, /^<\?php defined\( 'ABSPATH' \) \|\| exit; \?>\n/);
    assert.match(pattern['index.php']!, /<!-- wp:pattern \{"slug":"harbor\/hero"\} \/-->/);
    const part = pointer(
      { ...base, export: 'part header', files: ['parts/header.html'] },
      { iterationDir: 'rough/x/header/iteration-01', fixture: null }
    )!;
    assert.match(part['index.php']!, /<!-- wp:template-part \{"slug":"header"\} \/-->/);
  });
});

describe('the Shopify discoverer', () => {
  it("reads each template's sections in their order, and Shared from the layout's groups", async () => {
    const repo = await tempDir();
    write(repo, {
      'layout/theme.liquid':
        "<html><body>{% sections 'header-group' %}{{ content_for_layout }}{% section 'newsletter' %}{% sections 'footer-group' %}</body></html>\n",
      // As Shopify writes a section group: a comment block above it, and a trailing comma.
      'sections/header-group.json': `/*
 * IMPORTANT: The contents of this file are auto-generated.
 */
{
  "type": "header",
  "sections": { "announcement": { "type": "announcement-bar" }, "header": { "type": "header" } },
  "order": ["announcement", "header"],
}
`,
      'sections/footer-group.json': JSON.stringify({
        type: 'footer',
        sections: { footer: { type: 'footer' } },
        order: ['footer']
      }),
      'templates/index.json': JSON.stringify({
        sections: {
          hero: { type: 'image-banner' },
          featured: { type: 'featured-collection' },
          gone: { type: 'rich-text', disabled: true },
          app: { type: 'apps' }
        },
        order: ['hero', 'featured', 'gone', 'app']
      }),
      'templates/product.json': JSON.stringify({
        sections: { main: { type: 'main-product' } },
        order: ['main']
      }),
      'templates/product.special.json': JSON.stringify({
        sections: { main: { type: 'main-product' } },
        order: ['main']
      }),
      'templates/customers/account.json': JSON.stringify({
        sections: { main: { type: 'main-account' } },
        order: ['main']
      }),
      'templates/gift_card.liquid': '{{ gift_card.code }}\n',
      'sections/image-banner.liquid': '{% schema %}{ "name": "Image banner" }{% endschema %}\n',
      'sections/featured-collection.liquid':
        '{% schema %}{ "name": "Featured collection" }{% endschema %}\n',
      'sections/main-product.liquid': '{% schema %}{ "name": "Product" }{% endschema %}\n',
      'sections/main-account.liquid': '{% schema %}{ "name": "Account" }{% endschema %}\n',
      'sections/announcement-bar.liquid':
        '{% schema %}{ "name": "Announcement bar" }{% endschema %}\n',
      'sections/header.liquid': '{% schema %}{ "name": "Header" }{% endschema %}\n',
      'sections/footer.liquid': '{% schema %}{ "name": "Footer" }{% endschema %}\n',
      'sections/newsletter.liquid': '{% schema %}{ "name": "Newsletter" }{% endschema %}\n',
      'sections/rich-text.liquid': '{% schema %}{ "name": "Rich text" }{% endschema %}\n',
      'sections/unused.liquid': '{% schema %}{ "name": "Unused" }{% endschema %}\n'
    });
    const found = await discoverShopify(input(repo));
    assert.deepEqual(
      found.pages.map(page => [page.address, page.name, page.signIn]),
      [
        [null, null, 'unknown'],
        ['/', 'Home', 'unknown'],
        ['/account', 'Account', 'yes'],
        ['/products/[handle]', 'Product', 'unknown'],
        ['/products/[handle]?view=special', 'Product (special)', 'unknown']
      ]
    );
    assert.deepEqual(names(found, pageAt(found, null).sections), [
      'Announcement bar',
      'Header',
      'Newsletter',
      'Footer'
    ]);
    assert.deepEqual(names(found, pageAt(found, '/').sections), [
      'Image banner',
      'Featured collection'
    ]);
    assert.equal(
      found.components.find(item => item.name === 'Image banner')!.export,
      'section image-banner'
    );
    const missed = found.missed.map(item => `${item.what}: ${item.why}`).join('\n');
    assert.match(missed, /templates\/index\.json: its gone section, rich-text, is turned off/);
    assert.match(missed, /templates\/index\.json: .*apps/);
    assert.deepEqual(found.unplaced, ['sections/rich-text.liquid', 'sections/unused.liquid']);
  });
});
