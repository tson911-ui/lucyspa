import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FX_COOKIE_MAX_AGE,
  PARTICLE_END_ZONE,
  PARTICLE_START_ZONE,
  PARTICLES_DESKTOP,
  PARTICLES_PHONE,
  parseFxCookie,
  particleCount,
  particleLayout,
  serializeFxCookie,
} from './season-fx-core';

test('effects are on unless the ls-fx cookie says off', () => {
  assert.equal(parseFxCookie(''), true);
  assert.equal(parseFxCookie('ls-fx=off'), false);
  assert.equal(parseFxCookie('a=1; ls-fx=off; b=2'), false);
  assert.equal(parseFxCookie('ls-fx=on'), true);
  assert.equal(parseFxCookie('ls-fx=maybe'), true);
  assert.equal(parseFxCookie('xls-fx=off'), true, 'only the exact cookie name counts');
});

test('the switch cookie lasts a year, is Lax, and turning effects back on clears it', () => {
  const off = serializeFxCookie(false);
  assert.match(off, /^ls-fx=off; Max-Age=31536000; Path=\/; SameSite=Lax$/);
  assert.equal(FX_COOKIE_MAX_AGE, 31536000);
  assert.match(serializeFxCookie(true), /^ls-fx=; Max-Age=0; Path=\/; SameSite=Lax$/);
});

test('the pool is at most 24, and 12 on phones', () => {
  assert.equal(PARTICLES_DESKTOP, 24);
  assert.equal(particleCount(false), 24);
  assert.equal(particleCount(true), 12);
  assert.equal(particleLayout(100).length, 24, 'never more than 24');
  assert.equal(particleLayout(-3).length, 0);
});

test('the layout is deterministic, a smaller pool is a prefix, and every factor stays in range', () => {
  const all = particleLayout(PARTICLES_DESKTOP);
  assert.deepEqual(all, particleLayout(PARTICLES_DESKTOP));
  assert.deepEqual(particleLayout(PARTICLES_PHONE), all.slice(0, PARTICLES_PHONE));
  for (const spec of all) {
    const inStart = spec.left >= PARTICLE_START_ZONE.from && spec.left <= PARTICLE_START_ZONE.to;
    const inEnd = spec.left >= PARTICLE_END_ZONE.from && spec.left <= PARTICLE_END_ZONE.to;
    assert.ok(inStart || inEnd, `left ${spec.left} is in a gutter zone, never over the text`);
    assert.ok(spec.speed >= 0.75 && spec.speed <= 1.25, `speed ${spec.speed}`);
    assert.ok(spec.delay >= 0 && spec.delay <= 1, `delay ${spec.delay}`);
    assert.ok(spec.sway >= -1 && spec.sway <= 1, `sway ${spec.sway}`);
    assert.ok(spec.scale >= 0.7 && spec.scale <= 1.2, `scale ${spec.scale}`);
  }
});

test('particles are spread over both gutters, not clumped, on desktop and on a phone', () => {
  for (const count of [PARTICLES_DESKTOP, PARTICLES_PHONE]) {
    const lefts = particleLayout(count)
      .map((spec) => spec.left)
      .sort((a, b) => a - b);
    assert.ok(
      lefts.some((left) => left <= PARTICLE_START_ZONE.to),
      `${count}: start gutter used`,
    );
    assert.ok(
      lefts.some((left) => left >= PARTICLE_END_ZONE.from),
      `${count}: end gutter used`,
    );
    assert.ok(new Set(lefts).size >= count - 3, `${count}: positions are mostly distinct`);
  }
});
