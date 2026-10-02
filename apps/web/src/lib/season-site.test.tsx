import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicSeasonResponse } from '@lucy-spa/contracts';
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
  ...patch,
});

test('only a customer season whose preset has site art gets the decoration', () => {
  assert.equal(siteDecorSpec(null, 'vi'), null);
  assert.equal(siteDecorSpec(season({ customer: false }), 'vi'), null);
  assert.equal(
    siteDecorSpec(season({ presetKey: 'valentine' }), 'vi'),
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
