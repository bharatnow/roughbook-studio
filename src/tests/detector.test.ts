import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCheck } from '../mcp/tools.js';
import { applyChecks } from '../runs/checks.js';
import { DETECTED_TELLS, detectorFindings } from '../runs/detector.js';
import type { Check, RunRecord } from '../runs/types.js';

// The same cases as the backend's src/tests/compile/detector.test.ts: the backend sends the
// detector check, and both sides apply it the same way (ROUGHBOOK-METHODS-PLAN.md, D7).
const sloppy = `import { ArrowRight } from 'lucide-react';

const steps = ['Plan', 'Build', 'Ship'];

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-slate-950 transition-all">
      <div className="absolute -top-24 left-1/2 h-96 w-96 rounded-full bg-violet-600/30 blur-3xl" />
      <h1 className="bg-gradient-to-r from-purple-500 to-blue-500 bg-clip-text text-transparent">
        Ship faster
      </h1>
      <p className="text-sm text-slate-400">Pottery · Glazes · Workshops</p>
      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-2xl bg-white p-6 shadow-sm"><span>01</span><h3>Plan</h3></div>
        <div className="rounded-2xl bg-white p-6 shadow-sm"><span>02</span><h3>Build</h3></div>
        <div className="rounded-2xl bg-white p-6 shadow-sm"><span>03</span><h3>Ship</h3></div>
      </div>
    </section>
  );
}
`;
const sloppyCss = `@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap");
body { font-family: 'Inter', sans-serif; }
`;
const clean = `export default function Hero() {
  return (
    <section className="grid min-h-[80dvh] grid-cols-[1.2fr_1fr] bg-[#f6f1e7] transition-transform">
      <h1 className="font-[family-name:var(--display)] text-6xl text-[#1f1d1a]">A new batch is out of the kiln.</h1>
      <ul className="space-y-4">
        <li className="border-t border-[#d8cfbf] pt-4">Stoneware bowls, glazed in ash.</li>
        <li className="border-t border-[#d8cfbf] pt-4">Mugs thrown this week.</li>
      </ul>
    </section>
  );
}
`;
const cleanCss = `@import url("https://fonts.googleapis.com/css2?family=Fraunces:wght@600&display=swap");
:root { --display: 'Fraunces', serif; }
`;

const files = (tsx: string, css: string) =>
  new Map([
    ['index.tsx', tsx],
    ['fonts.css', css]
  ]);
const everyTell = { tells: DETECTED_TELLS, fonts: [] };

// A template is read as markup (decision 23 of the frameworks plan): its class="…" lists, the CSS
// in its <style> blocks, and the tag a loop repeats, as .map( is read in JSX.
const sloppyVue = `<template>
  <section class="relative overflow-hidden">
    <div class="absolute h-96 w-96 rounded-full bg-violet-600/30 blur-3xl"></div>
    <h1 class="bg-gradient-to-r from-purple-500 to-blue-500 bg-clip-text text-transparent">Ship faster</h1>
    <p>Pottery · Glazes · Workshops</p>
    <div v-for="step in steps" :key="step.id" class="rounded-2xl bg-white p-6 shadow-sm">
      <span>01</span><h3>{{ step.title }}</h3>
    </div>
    <span>02</span>
  </section>
</template>

<style scoped>
h1 { font-family: 'Inter', sans-serif; }
</style>
`;
const sloppyBlade = `<section class="hero">
  @foreach ($steps as $step)
    <article class="rounded-xl p-6 shadow-md">{{ $step->title }}</article>
  @endforeach
</section>
<style>
  .hero { background: linear-gradient(135deg, purple, blue); }
  .hero h1 { -webkit-background-clip: text; color: transparent; }
  .hero .glow { filter: blur(80px); }
</style>
`;
const sloppyLiquid = `<div class="grid">
  {%- for block in section.blocks -%}
    <div class="rounded-lg p-4 shadow" {{ block.shopify_attributes }}>{{ block.settings.title }}</div>
  {%- endfor -%}
</div>
`;
const sloppyPhp = `<?php foreach ( $cards as $card ) : ?>
  <article class="rounded-2xl shadow-lg"><?php echo esc_html( $card['title'] ); ?></article>
<?php endforeach; ?>
`;

describe('the detector', () => {
  it('names each model tell it finds, once per file', () => {
    const findings = detectorFindings(files(sloppy, sloppyCss), everyTell);
    assert.deepEqual(
      findings.map(finding => finding.code),
      [
        'TELL_PURPLE_GRADIENT',
        'TELL_IDENTICAL_CARDS',
        'TELL_DECORATIVE_NUMBERING',
        'TELL_MIDDLE_DOT_META',
        'TELL_GRADIENT_TEXT',
        'TELL_GLOW_BLOB',
        'TELL_DEFAULT_SANS'
      ]
    );
    assert.match(findings[1]!.message, /^index\.tsx repeats one rounded, shadowed card 3 times/);
    assert.match(findings[6]!.message, /^fonts\.css uses Inter/);
    assert.deepEqual(detectorFindings(files(clean, cleanCss), everyTell), []);
  });

  it('skips the tells a studio switched off, and a font the Design System chose', () => {
    const codes = (tells: string[], fonts: string[]) =>
      detectorFindings(files(sloppy, sloppyCss), { tells, fonts }).map(finding => finding.code);
    assert.deepEqual(
      codes(
        DETECTED_TELLS.filter(tell => tell !== 'gradient-text'),
        []
      ),
      codes(DETECTED_TELLS, []).filter(code => code !== 'TELL_GRADIENT_TEXT')
    );
    assert.ok(!codes(DETECTED_TELLS, ['Inter']).includes('TELL_DEFAULT_SANS'));
  });

  it('reads Blade, Vue, Liquid and PHP as markup', () => {
    const codes = (file: string, text: string) =>
      detectorFindings(new Map([[file, text]]), everyTell).map(finding => finding.code);
    assert.deepEqual(codes('Hero.vue', sloppyVue), [
      'TELL_PURPLE_GRADIENT',
      'TELL_IDENTICAL_CARDS',
      'TELL_DECORATIVE_NUMBERING',
      'TELL_MIDDLE_DOT_META',
      'TELL_GRADIENT_TEXT',
      'TELL_GLOW_BLOB',
      'TELL_DEFAULT_SANS'
    ]);
    assert.deepEqual(codes('hero.blade.php', sloppyBlade), [
      'TELL_PURPLE_GRADIENT',
      'TELL_IDENTICAL_CARDS',
      'TELL_GRADIENT_TEXT',
      'TELL_GLOW_BLOB'
    ]);
    assert.deepEqual(codes('cards.liquid', sloppyLiquid), ['TELL_IDENTICAL_CARDS']);
    assert.deepEqual(codes('cards.php', sloppyPhp), ['TELL_IDENTICAL_CARDS']);
    assert.match(
      detectorFindings(new Map([['cards.php', sloppyPhp]]), everyTell)[0]!.message,
      /^cards\.php renders one rounded, shadowed card for every item in a list/
    );
    // Vue's bound :class is an expression, not a class list; a React file reads only className=.
    assert.deepEqual(
      codes('Hero.vue', `<h1 :class="{ 'bg-clip-text text-transparent': on }">Hi</h1>`),
      []
    );
    assert.deepEqual(codes('index.tsx', '<h1 class="bg-clip-text text-transparent">Hi</h1>'), []);
  });

  it('runs as a check the backend sends, as warnings only, and an agent can read it', () => {
    const check: Check = {
      kind: 'detector',
      tells: DETECTED_TELLS.filter(tell => tell !== 'middle-dot-meta'),
      fonts: ['Fraunces']
    };
    const result = applyChecks([{ kind: 'craft-floor' }, check], {
      iterationId: 'iteration-01',
      files: files(sloppy, sloppyCss),
      parentFiles: null
    });
    assert.equal(result.failure, null);
    const said = result.warnings.map(warning => warning.message);
    assert.ok(said.some(message => message.includes('fills text with a gradient')));
    assert.ok(said.some(message => message.includes('transitions every property')));
    assert.ok(!said.some(message => message.includes('middle dots')));
    const run = { targetFolder: 'rough/home/hero/iteration-01' } as RunRecord;
    assert.match(describeCheck(check, run), /model tells.*gradient-text.*Warnings only/);
  });
});
