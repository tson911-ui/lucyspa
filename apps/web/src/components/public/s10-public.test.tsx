import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { RichBlock } from '@lucy-spa/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeHero } from './home-hero';
import { isServiceList } from './home-slider';
import { promoteSubheads } from './info-view';
import { linkContacts } from './rich-text';

const css = readFileSync(
  fileURLToPath(new URL('../../../../../packages/ui/src/s10-public.css', import.meta.url)),
  'utf8',
);
// Comments may name a colour or a pixel size; the rules may not.
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('s10-public.css: tokens only (no hex, rgb, shadow, gradient, transition: all, pointer-events none, px/rem spacing)', () => {
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(rules, /\brgba?\(/);
  assert.doesNotMatch(rules, /box-shadow:\s*(?!none)/);
  assert.doesNotMatch(rules, /gradient\(/);
  assert.doesNotMatch(rules, /transition:\s*all/);
  assert.doesNotMatch(rules, /pointer-events:\s*none/);
  for (const line of rules.split('\n')) {
    const spacing = /^\s*(margin|padding|gap|row-gap|column-gap)[\w-]*\s*:([^;]*);/.exec(line);
    if (!spacing) continue;
    const value = (spacing[2] ?? '').replace(/var\([^)]*\)/g, 'var');
    assert.doesNotMatch(value, /\d(px|rem|em)\b/, `spacing literal: ${line.trim()}`);
  }
});

test('s10-public.css: no rule on the accent for a hover (R11), the brand band is light (R16), names are never clamped (answer 7)', () => {
  assert.doesNotMatch(rules, /:hover[^{]*\{[^}]*var\(--ls-hover-bg\)[^}]*var\(--ls-on-brand\)/);
  assert.match(rules, /\.ls-brand-band \{[^}]*background: var\(--ls-band-base\)/);
  assert.match(rules, /\.ls-brand-logo \{[^}]*filter: var\(--ls-s10-logo-filter\)/);
  assert.match(rules, /\.ls-pcard-name a \{[^}]*line-clamp: none/);
  // The hero's CSS keyframes are off: its opening runs through useMotion (home-hero.tsx).
  assert.match(
    rules,
    /\.ls-home-hero-img,\s*\[data-ui='v2'\] \.ls-home-hero-copy > \* \{\s*animation: none;/,
  );
  // The services chips row continues the title band (B8).
  assert.match(rules, /\.ls-svc-chips \{\s*background: var\(--ls-band-alt\);/);
});

test('home hero: the section the opening sequence runs on, server-rendered words in it, nothing hidden before the motion', () => {
  const html = renderToStaticMarkup(
    <HomeHero media="flat">
      <h1 id="home-title">Lucy Spa</h1>
    </HomeHero>,
  );
  assert.equal(
    html,
    '<section class="ls-home-hero ls-band--alt" data-media="flat" aria-labelledby="home-title"><h1 id="home-title">Lucy Spa</h1></section>',
  );
});

test('home slider: only a slide button to the service list itself is left out (the band links there already)', () => {
  assert.equal(isServiceList('/vi/services', 'vi'), true);
  assert.equal(isServiceList('/services/', 'vi'), true);
  assert.equal(isServiceList('https://lucyspa.vn/vi/services', 'vi'), true);
  assert.equal(isServiceList('/vi/services?group=NAIL', 'vi'), false);
  assert.equal(isServiceList('/vi/services/GOI', 'vi'), false);
  assert.equal(isServiceList('/vi/products', 'vi'), false);
});

const strongParagraph = (text: string): RichBlock => ({
  type: 'p',
  inlines: [{ type: 'strong', children: [{ type: 'text', text }] }],
});
const paragraph = (text: string): RichBlock => ({ type: 'p', inlines: [{ type: 'text', text }] });

test('policies: bold-only numbered parts become sections (a table of contents), only when the text has no ## heading', () => {
  const blocks = [
    paragraph('Mở đầu.'),
    strongParagraph('1. Điều kiện đổi trả'),
    paragraph('Nội dung một.'),
    strongParagraph('2. Hoàn tiền'),
    paragraph('Nội dung hai.'),
  ];
  const promoted = promoteSubheads(blocks);
  assert.deepEqual(
    promoted.flatMap((block) => (block.type === 'h2' ? [[block.id, block.text]] : [])),
    [
      ['muc-1', '1. Điều kiện đổi trả'],
      ['muc-2', '2. Hoàn tiền'],
    ],
  );
  // The words are unchanged; one bold part alone, or a text that has its own ## headings, is left as written.
  assert.deepEqual(promoteSubheads(blocks.slice(0, 3)), blocks.slice(0, 3));
  const own: RichBlock = { type: 'h2', id: 'a', text: 'A', inlines: [{ type: 'text', text: 'A' }] };
  assert.deepEqual(promoteSubheads([own, ...blocks]), [own, ...blocks]);
});

test('policies: an email and a Vietnamese phone number in the text become mailto: and tel: links with the same words', () => {
  const html = renderToStaticMarkup(
    <p>
      {linkContacts('Gửi thư tới hotro@lucyspa.vn hoặc gọi 0934 936 101, trước ngày 04/10/2026.')}
    </p>,
  );
  assert.equal(
    html,
    '<p>Gửi thư tới <a class="ls-info-contact" href="mailto:hotro@lucyspa.vn" translate="no">hotro@lucyspa.vn</a> hoặc gọi <a class="ls-info-contact" href="tel:0934936101" translate="no">0934 936 101</a>, trước ngày 04/10/2026.</p>',
  );
  // Prices and dates are not phone numbers.
  assert.equal(
    renderToStaticMarkup(<p>{linkContacts('Mỗi 1.000.000 ₫ ngày 14/10/2026')}</p>),
    '<p>Mỗi 1.000.000 ₫ ngày 14/10/2026</p>',
  );
});
