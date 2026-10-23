import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCheck } from '../mcp/tools.js';
import { applyChecks } from '../runs/checks.js';
import { craftFloorFindings } from '../runs/craftFloor.js';
import type { Check, RunRecord } from '../runs/types.js';

// The same cases as the backend's src/tests/compile/craftFloor.test.ts: the backend sends the
// craft-floor check, and both sides apply it the same way.
const rough = `export default function Hero() {
  return (
    <section className="transition-all">
      <h1>Lorem ipsum dolor sit amet</h1>
      <p>Signed, Jane Doe</p>
      <img src="/a.png" />
      <img
        src="/b.png"
        alt="Bowls on a shelf"
      />
      <button className="outline-none" onClick={() => {}}><ArrowRight /></button>
      <a className="outline-none focus-visible:ring-2" href="#">Read</a>
    </section>
  );
}
`;
const roughCss = `.card { transition: all 200ms; }
.card:focus { outline: none; }
`;
const clean = `export default function Hero() {
  return (
    <section className="transition-transform">
      <h1>A new batch is out of the kiln.</h1>
      <img src="/a.png" alt="" />
      <button aria-label="Next" className="outline-none focus-visible:ring-2"><ArrowRight aria-hidden /></button>
    </section>
  );
}
`;

// A template is read as markup (decision 23 of the frameworks plan): class="…", and its
// expressions stepped over as JSX's braces are, so a handler's => or PHP's -> stays in the tag.
const roughBlade = `<section class="transition-all">
  <h1>{{ $headline ?? 'Lorem ipsum dolor sit amet' }}</h1>
  <img src="{{ asset('images/bowls.jpg') }}">
  <img src="{{ $image->url }}" alt="{{ $image->alt }}">
  <button class="outline-none" wire:click="$set('open', {{ $index + 1 }})"><x-icon.arrow-right class="size-5" /></button>
  <a class="outline-none focus-visible:ring-2" href="{{ route('shop') }}">Read</a>
</section>
`;
const roughVue = `<template>
  <section class="transition-all">
    <img :src="hero.src">
    <img v-for="photo in photos" :key="photo.id" :src="photo.src" :alt="photo.alt">
    <button class="p-2" @click="() => (open = !open)"><ArrowRight /></button>
    <button :aria-label="t('next')" @click="next"><ArrowRight /></button>
  </section>
</template>

<style scoped>
button:focus { outline: none; }
</style>
`;
const roughLiquid = `<section class="hero">
  <p>{{ section.settings.signature | default: 'Jane Doe' }}</p>
  <img src="{{ section.settings.image | image_url: width: 1200 }}" width="1200">
  {% if section.settings.logo %}<img src="{{ section.settings.logo | image_url }}" alt="{{ section.settings.logo.alt | escape }}">{% endif %}
  <button class="{% if section.settings.round %}rounded-full {% endif %}p-2">{%- render 'icon-arrow' -%}</button>
  <button type="submit">{{ 'general.search' | t }}</button>
</section>
`;
const roughPhp = `<?php
/**
 * Title: Hero
 */
?>
<section class="hero" style="transition: all 200ms">
  <img src="<?php echo esc_url( get_theme_file_uri( 'assets/bowls.jpg' ) ); ?>">
  <img src="<?php echo esc_url( $image->src ); ?>" alt="<?php echo esc_attr( $image->alt ); ?>">
  <button class="menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16" /></svg></button>
  <button class="close"><svg viewBox="0 0 24 24"><title>Close</title><path d="M6 6l12 12" /></svg></button>
</section>
`;
const cleanVue = `<template>
  <section class="transition-transform">
    <h1>A new batch is out of the kiln.</h1>
    <img :src="hero.src" alt="">
    <button aria-label="Next" class="outline-none focus-visible:ring-2" @click="() => next()"><ArrowRight aria-hidden="true" /></button>
  </section>
</template>
`;

describe('the craft floor', () => {
  it('names each kind of slip once per file, with how often', () => {
    const findings = craftFloorFindings(
      new Map([
        ['index.tsx', rough],
        ['styles.css', roughCss]
      ])
    );
    assert.deepEqual(
      findings.map(finding => finding.code),
      [
        'PLACEHOLDER_COPY',
        'TRANSITION_ALL',
        'IMG_WITHOUT_ALT',
        'ICON_BUTTON_UNNAMED',
        'OUTLINE_WITHOUT_FOCUS',
        'TRANSITION_ALL',
        'OUTLINE_WITHOUT_FOCUS'
      ]
    );
    assert.match(findings[0]!.message, /^index\.tsx has placeholder copy/);
    assert.match(findings[2]!.message, /^index\.tsx has 1 img without alt text/);
    assert.match(findings[5]!.message, /^styles\.css transitions every property/);
  });

  it('finds nothing in a section that keeps to it', () => {
    assert.deepEqual(craftFloorFindings(new Map([['index.tsx', clean]])), []);
  });

  it('reads Blade, Vue, Liquid, PHP and HTML as markup', () => {
    const codes = (file: string, text: string) =>
      craftFloorFindings(new Map([[file, text]])).map(finding => finding.code);
    assert.deepEqual(codes('hero.blade.php', roughBlade), [
      'PLACEHOLDER_COPY',
      'TRANSITION_ALL',
      'IMG_WITHOUT_ALT',
      'ICON_BUTTON_UNNAMED',
      'OUTLINE_WITHOUT_FOCUS'
    ]);
    assert.deepEqual(codes('Hero.vue', roughVue), [
      'TRANSITION_ALL',
      'IMG_WITHOUT_ALT',
      'ICON_BUTTON_UNNAMED',
      'OUTLINE_WITHOUT_FOCUS'
    ]);
    assert.deepEqual(codes('hero.liquid', roughLiquid), [
      'PLACEHOLDER_COPY',
      'IMG_WITHOUT_ALT',
      'ICON_BUTTON_UNNAMED'
    ]);
    assert.deepEqual(codes('hero.php', roughPhp), [
      'TRANSITION_ALL',
      'IMG_WITHOUT_ALT',
      'ICON_BUTTON_UNNAMED'
    ]);
    assert.deepEqual(codes('hero.html', '<img src="/a.png">'), ['IMG_WITHOUT_ALT']);
    const templates: [string, string][] = [
      ['hero.blade.php', roughBlade],
      ['Hero.vue', roughVue],
      ['hero.liquid', roughLiquid],
      ['hero.php', roughPhp]
    ];
    for (const [file, text] of templates) {
      const finding = craftFloorFindings(new Map([[file, text]])).find(
        item => item.code === 'IMG_WITHOUT_ALT'
      );
      assert.equal(finding?.message, `${file} has 1 img without alt text.`);
    }
    assert.deepEqual(codes('Hero.vue', cleanVue), []);
    // A React file reads className= only, as before.
    assert.deepEqual(codes('index.tsx', '<a class="outline-none" href="#">Read</a>'), []);
  });

  it('runs as a check the backend sends, as warnings only, and an agent can read it', () => {
    const checks: Check[] = [{ kind: 'entry-file', file: 'index.tsx' }, { kind: 'craft-floor' }];
    const outcome = applyChecks(checks, {
      iterationId: 'iteration-03',
      files: new Map([['index.tsx', rough]])
    });
    assert.equal(outcome.failure, null);
    assert.ok(outcome.warnings.some(warning => warning.code === 'TRANSITION_ALL'));
    assert.equal(
      applyChecks([{ kind: 'entry-file', file: 'index.tsx' }], {
        iterationId: 'iteration-03',
        files: new Map([['index.tsx', rough]])
      }).warnings.length,
      0,
      'only when the backend asks for it'
    );
    const run = { targetFolder: 'rough/homepage/hero/iteration-03' } as RunRecord;
    assert.match(describeCheck({ kind: 'craft-floor' }, run), /lorem ipsum/);
    // A kind this studio does not know is still described, not printed as undefined.
    assert.match(describeCheck({ kind: 'later-kind' } as unknown as Check, run), /later-kind/);
  });
});
