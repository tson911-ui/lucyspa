import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_SEASON_SLOTS_ON, type PublicSeasonResponse } from '@lucy-spa/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeasonSiteFrame, SiteLogo } from '../components/season/site-frame';
import { siteDecorSpec } from './season-core';

// Site-wide season art on the web (docs/UXUI_REDESIGN_S6_PLAN.md): which seasons get it, what the Tet footer computes
// from the window, and what the decorated page contains.
const season = (patch: Partial<PublicSeasonResponse> = {}): PublicSeasonResponse => ({
  presetKey: 'tet',
  greeting: 'Chúc mừng năm mới',
  // Tet 2027 window ends 12 February (inclusive); the stored end is the next local midnight.
  endsAt: '2027-02-12T17:00:00.000Z',
  particles: true,
  customer: true,
  admin: true,
  slots: { ...ALL_SEASON_SLOTS_ON },
  density: 'medium',
  greetingStrip: true,
  greetingFooter: true,
  media: {},
  ...patch,
});

test('only a customer season whose preset has site art gets the decoration', () => {
  assert.equal(siteDecorSpec(null, 'vi'), null);
  assert.equal(siteDecorSpec(season({ customer: false }), 'vi'), null);
  assert.equal(
    siteDecorSpec(season({ presetKey: 'mid-autumn' }), 'vi'),
    null,
    'no art yet: the band',
  );
  assert.equal(siteDecorSpec(season({ presetKey: 'retired' }), 'vi'), null);
  assert.equal(siteDecorSpec(season(), 'vi')?.kit, 'tet');
  assert.equal(siteDecorSpec(season({ presetKey: 'christmas' }), 'en')?.kit, 'christmas');
});

test('Tet computes the year name and the animal from the end date, in both languages', () => {
  const vi = siteDecorSpec(season(), 'vi')!;
  assert.equal(vi.footer.line, 'Chúc mừng năm mới');
  assert.equal(vi.footer.sub, 'Xuân Đinh Mùi 2027');
  assert.equal(vi.zodiac, 'mui');
  assert.deepEqual(vi.lunar, { canChi: 'Đinh Mùi', year: 2027, animal: { vi: 'dê', en: 'Goat' } });
  const en = siteDecorSpec(season(), 'en')!;
  assert.equal(en.footer.line, 'Happy Lunar New Year');
  assert.equal(en.footer.sub, 'Đinh Mùi 2027, Year of the Goat');
  // 2028 is Mau Than, the monkey; no monkey art exists yet.
  const next = siteDecorSpec(season({ endsAt: '2028-02-01T17:00:00.000Z' }), 'vi')!;
  assert.equal(next.footer.sub, 'Xuân Mậu Thân 2028');
  assert.equal(next.zodiac, 'than');
  // Christmas has fixed footer lines and no zodiac.
  const xmas = siteDecorSpec(season({ presetKey: 'christmas' }), 'vi')!;
  assert.equal(xmas.zodiac, null);
  assert.equal(xmas.lunar, null);
  assert.equal(xmas.footer.line, 'Giáng sinh an lành');
});

test('particles only when the schedule allows them', () => {
  assert.equal(siteDecorSpec(season(), 'vi')?.particles, true);
  assert.equal(siteDecorSpec(season({ particles: false }), 'vi')?.particles, false);
  assert.equal(siteDecorSpec(season(), 'vi')?.density, 'medium');
});

const page = (patch: Partial<PublicSeasonResponse> = {}, locale: 'vi' | 'en' = 'vi') => {
  const decor = siteDecorSpec(season(patch), locale)!;
  return renderToStaticMarkup(
    <SeasonSiteFrame
      decor={decor}
      locale={locale}
      header={
        <header className="site-header">
          <SiteLogo decor={decor}>
            <span>Lucy Spa</span>
          </SiteLogo>
        </header>
      }
      footer={<footer className="site-footer">Lucy Spa</footer>}
    >
      <main id="main-content">Nội dung</main>
    </SeasonSiteFrame>,
  );
};

test('the decorated page has the slots in order, the content untouched and every drawing hidden', () => {
  const html = page();
  const order = [
    'ls-site-page',
    'ls-art-header',
    'site-header',
    'ls-art-divider',
    'ls-art-strip',
    'id="main-content"',
    'ls-art-footer',
    'site-footer',
  ].map((marker) => html.indexOf(marker));
  assert.ok(
    order.every((index) => index >= 0),
    `missing a slot: ${order.join(',')}`,
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    'slots are in page order',
  );
  assert.ok(html.includes('Nội dung'));
  assert.ok(html.includes('Chúc mừng năm mới'), 'greeting strip');
  assert.ok(html.includes('Xuân Đinh Mùi 2027'), 'computed year name in the footer');
  // Every svg is decoration: hidden from assistive technology and not focusable.
  const svgs = html.match(/<svg\b[^>]*>/g) ?? [];
  assert.ok(svgs.length > 30, 'a full composition');
  for (const svg of svgs) {
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
  }
  assert.doesNotMatch(html, /<img|<script|href="http|url\(http/, 'no image, script or request');
  assert.doesNotMatch(html, /tabindex/i, 'nothing focusable is added');
});

test('the Tet footer draws the goat for 2027 and no animal for a year without art', () => {
  assert.match(page(), /ls-art-animal/);
  assert.doesNotMatch(
    page({ endsAt: '2028-02-01T17:00:00.000Z' }),
    /ls-art-animal/,
    'never a wrong animal',
  );
  assert.doesNotMatch(page({ presetKey: 'christmas' }), /ls-art-animal/);
});

test('Christmas has lights, garlands, trees and gifts and no yellow art token', () => {
  const html = page({ presetKey: 'christmas' });
  for (const marker of [
    'ls-art-lights',
    'ls-art-tree',
    'ls-art-gifts',
    'ls-art-hills',
    'data-plaque="card"',
  ]) {
    assert.ok(html.includes(marker), marker);
  }
  assert.doesNotMatch(html, /--ls-art-(yellow|mai)/);
});

test('the effects switch lives inside the strip, only when effects exist', () => {
  assert.match(page(), /ls-art-strip-tools/);
  assert.doesNotMatch(page({ particles: false }), /ls-art-strip-tools/);
});

const slots = (patch: Partial<PublicSeasonResponse['slots']>) => ({
  slots: { ...ALL_SEASON_SLOTS_ON, ...patch },
});

test('Celebration (a custom event kit) has the bunting, balloons, cake and its own greeting lines', () => {
  const html = page({ presetKey: 'celebration' });
  for (const marker of [
    'ls-art-bunting',
    'ls-art-ball',
    'ls-art-cake',
    'ls-art-bunch',
    'ls-art-floor',
    'data-plaque="card"',
    'Một ngày đáng nhớ cùng Lucy Spa',
  ]) {
    assert.ok(html.includes(marker), marker);
  }
  assert.doesNotMatch(html, /ls-art-animal/);
  assert.equal(siteDecorSpec(season({ presetKey: 'celebration' }), 'vi')!.zodiac, null);
});

test('a slot the event switched off draws nothing, and the page keeps its rhythm', () => {
  const noHeader = page(slots({ header: false, corners: false }));
  assert.doesNotMatch(noHeader, /ls-art-header|ls-art-lanterns/, 'no header row, no height');
  const noDividers = page(slots({ dividers: false }));
  assert.equal([...noDividers.matchAll(/data-plain="true"/g)].length, 2, 'both rules stay, plain');
  assert.doesNotMatch(noDividers, /ls-art-divider-art/);
  const noTint = page(slots({ tint: false }));
  assert.match(noTint, /data-tint="off"/);
  assert.doesNotMatch(page(), /data-tint/);
  const noFooter = page(slots({ footer: false }));
  assert.match(noFooter, /data-compact="true"/, 'the greeting line stays, compact');
  assert.doesNotMatch(noFooter, /ls-art-footer-art/);
  const noLogo = page(slots({ logo: false }));
  assert.doesNotMatch(noLogo, /ls-art-logo/);
  assert.ok(noLogo.includes('<span>Lucy Spa</span>'));
  // Particles are their own slot: the switch also removes the effects switch from the strip.
  assert.doesNotMatch(
    page({ particles: true, ...slots({ particles: false }) }),
    /ls-art-strip-tools/,
  );
});

test('the two greetings are each switchable; the effects switch survives a hidden strip greeting', () => {
  const noStrip = page({ greetingStrip: false });
  assert.doesNotMatch(noStrip, /ls-art-strip"/);
  assert.doesNotMatch(noStrip, /ls-season-greeting/, 'the strip greeting is gone');
  assert.match(noStrip, /ls-art-strip-bare/, 'the visitor can still turn effects off');
  assert.match(noStrip, /Chúc mừng năm mới/, 'the footer line stays');
  const noFooter = page({ greetingFooter: false });
  assert.doesNotMatch(noFooter, /ls-art-plaque/);
  assert.match(noFooter, /ls-art-strip"/);
  const neither = page({ greetingStrip: false, greetingFooter: false, particles: false });
  assert.doesNotMatch(neither, /ls-art-strip|ls-art-plaque/);
});

test('slot images are decoration: aria-hidden, lazy, same-origin paths only', () => {
  const id = '2f1b2d8e-5c3a-4b7a-9d2e-1a2b3c4d5e6f';
  const url = (variant: string) => `/api/v1/public/media/${id}/${variant}`;
  const html = page({
    media: {
      header: url('lg'),
      logo: url('md'),
      corners: url('md'),
      footer: url('lg'),
      tint: url('lg'),
    },
  });
  assert.match(html, new RegExp(`background-image:url\\(&quot;${url('lg')}&quot;\\)`));
  const images = html.match(/<img\b[^>]*>/g) ?? [];
  assert.ok(images.length >= 4, 'logo, footer and the corner pictures');
  for (const image of images) {
    assert.match(image, /alt=""/);
    assert.match(image, /loading="lazy"/);
    assert.match(image, new RegExp(`src="${url('(md|lg)')}"`));
  }
  assert.doesNotMatch(html, /https?:\/\//);
});
