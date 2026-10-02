import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  KEEPOUT_MAX_RECTS,
  KEEPOUT_PADDING,
  SITE_PARTICLES,
  SITE_PARTICLE_MAX_SCREENS,
  keepoutMaskImage,
  keepoutMaskSvg,
  normalizeKeepouts,
  siteParticleCount,
  siteParticleLayout,
} from './season-fx-core';

// Site-wide particles (docs/UXUI_REDESIGN_S6_PLAN.md section 3, rules 1 and 7): density pools, the layout over the
// whole page, and the keep-out mask that keeps petals off every line of text.

test('density pools are 12 / 24 / 40 on desktop and 6 / 12 / 20 on a phone', () => {
  assert.deepEqual(SITE_PARTICLES, {
    low: { desktop: 12, phone: 6 },
    medium: { desktop: 24, phone: 12 },
    high: { desktop: 40, phone: 20 },
  });
  assert.equal(siteParticleCount('medium', false, 900, 900), 24);
  assert.equal(siteParticleCount('medium', true, 900, 900), 12);
  assert.equal(siteParticleCount('low', false, 0, 0), 12, 'unmeasured: one screen');
});

test('a taller page gets a bigger pool, never more than three screens worth', () => {
  assert.equal(siteParticleCount('medium', false, 1800, 900), 48);
  assert.equal(siteParticleCount('medium', false, 450, 900), 24, 'a short page is one screen');
  assert.equal(
    siteParticleCount('high', false, 90_000, 900),
    SITE_PARTICLES.high.desktop * SITE_PARTICLE_MAX_SCREENS,
  );
});

test('the layout spreads across the whole width, is deterministic and a smaller pool is a prefix', () => {
  const small = siteParticleLayout(12);
  const large = siteParticleLayout(40);
  assert.deepEqual(large.slice(0, 12), small);
  assert.deepEqual(siteParticleLayout(40), large);
  for (const spec of large) {
    assert.ok(spec.left >= 0 && spec.left <= 100);
    assert.ok(spec.speed >= 0.75 && spec.speed <= 1.25);
    assert.ok(spec.scale >= 0.7 && spec.scale <= 1.2);
  }
  assert.ok(large.some((spec) => spec.left > 60) && large.some((spec) => spec.left < 40));
  assert.deepEqual(siteParticleLayout(0), []);
  assert.deepEqual(siteParticleLayout(-3), []);
});

test('keep-out rectangles are padded, filtered and merged per line', () => {
  const rects = normalizeKeepouts(
    [
      { x: 100, y: 200, width: 60, height: 20 },
      { x: 164, y: 200, width: 60, height: 20 },
      { x: 100, y: 240, width: 80, height: 20 },
      { x: 0, y: 0, width: 0, height: 20 },
      { x: 5000, y: 10, width: 40, height: 20 },
    ],
    1440,
    3000,
  );
  assert.equal(rects.length, 2, 'two words on a line merge; the empty and the off-page ones drop');
  const [line, next] = rects as [(typeof rects)[number], (typeof rects)[number]];
  assert.equal(line.x, 100 - KEEPOUT_PADDING);
  assert.equal(line.width, 124 + KEEPOUT_PADDING * 2);
  assert.equal(line.height, 20 + KEEPOUT_PADDING * 2);
  assert.equal(next.y, 240 - KEEPOUT_PADDING);
});

test('the number of keep-out rectangles is capped', () => {
  const many = Array.from({ length: 2000 }, (_, index) => ({
    x: 10,
    y: index * 40,
    width: 50,
    height: 20,
  }));
  assert.equal(normalizeKeepouts(many, 1440, 90_000).length, KEEPOUT_MAX_RECTS);
});

test('the mask is opaque with holes: an even-odd path, blurred, and none when there is nothing to keep clear', () => {
  const rects = [{ x: 10, y: 20, width: 100, height: 30 }];
  const svg = keepoutMaskSvg(400, 300, rects);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="400" height="300"/);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /feGaussianBlur/);
  assert.match(svg, /M10 20h100v30h-100Z/, 'the hole is a sub-path of the same shape');
  const image = keepoutMaskImage(400, 300, rects);
  assert.match(image, /^url\("data:image\/svg\+xml,%3Csvg/);
  assert.equal(keepoutMaskImage(400, 300, []), 'none');
  assert.equal(keepoutMaskImage(0, 300, rects), 'none');
});
