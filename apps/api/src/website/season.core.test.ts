import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEASON_PRESETS, type WebsiteSeasonInput } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { effectivelyEnabled, parseSeasonId } from './season.link.js';
import { parseSeasonFields, seasonStatus } from './season.core.js';

const input = (patch: Partial<WebsiteSeasonInput> = {}): WebsiteSeasonInput => ({
  presetKey: 'tet',
  label: 'Tết 2090',
  startsAt: '2090-01-01T00:00:00Z',
  endsAt: '2090-01-08T00:00:00+07:00',
  greetingVi: null,
  greetingEn: null,
  applyCustomer: true,
  applyAdmin: true,
  particlesEnabled: true,
  isEnabled: false,
  ...patch,
});

const refused = (patch: Partial<WebsiteSeasonInput>, field: string) =>
  assert.throws(
    () => parseSeasonFields(input(patch)),
    (error: unknown) =>
      error instanceof AuthError && error.code === 'VALIDATION_FAILED' && error.field === field,
  );

test('season status: Draft is "not enabled"; enabled is Scheduled, Active, then Ended at the end instant', () => {
  const start = new Date('2090-01-02T00:00:00Z');
  const end = new Date('2090-01-03T00:00:00Z');
  const status = (enabled: boolean, now: string) =>
    seasonStatus(enabled, start, end, new Date(now));
  assert.equal(status(false, '2090-01-02T12:00:00Z'), 'DRAFT');
  assert.equal(
    status(false, '2091-01-01T00:00:00Z'),
    'DRAFT',
    'a disabled season is a draft even when past',
  );
  assert.equal(status(true, '2090-01-01T23:59:59.999Z'), 'SCHEDULED');
  assert.equal(status(true, '2090-01-02T00:00:00Z'), 'ACTIVE', 'the start instant is inside');
  assert.equal(status(true, '2090-01-02T23:59:59.999Z'), 'ACTIVE');
  assert.equal(status(true, '2090-01-03T00:00:00Z'), 'ENDED', 'the end instant is outside');
});

test('season fields: every registry preset is accepted, anything else is not', () => {
  for (const preset of SEASON_PRESETS) {
    assert.equal(parseSeasonFields(input({ presetKey: preset.key })).presetKey, preset.key);
  }
  for (const presetKey of ['', 'unknown', 'TET', 'tet ', '__proto__', 'constructor']) {
    refused({ presetKey }, 'presetKey');
  }
  refused({ presetKey: 5 as unknown as string }, 'presetKey');
});

test('season fields: label and greetings are normalized plain text with the documented limits', () => {
  const fields = parseSeasonFields(
    input({ label: '  Tết   2090 ', greetingVi: '  Chúc   mừng năm mới ', greetingEn: '   ' }),
  );
  assert.equal(fields.label, 'Tết 2090');
  assert.equal(fields.greetingVi, 'Chúc mừng năm mới');
  assert.equal(fields.greetingEn, null, 'empty means the preset default');
  assert.equal(parseSeasonFields(input({ label: 'x'.repeat(80) })).label.length, 80);
  assert.equal(parseSeasonFields(input({ greetingVi: 'x'.repeat(80) })).greetingVi?.length, 80);
  refused({ label: '' }, 'label');
  refused({ label: '   ' }, 'label');
  refused({ label: null as unknown as string }, 'label');
  refused({ label: 'x'.repeat(81) }, 'label');
  refused({ label: 'a\u0007b' }, 'label');
  refused({ greetingVi: 'x'.repeat(81) }, 'greetingVi');
  refused({ greetingEn: 'x'.repeat(81) }, 'greetingEn');
  refused({ greetingEn: 7 as unknown as string }, 'greetingEn');
});

test('season fields: the window needs zone-aware instants and a positive length', () => {
  const fields = parseSeasonFields(input());
  assert.equal(fields.endsAt.toISOString(), '2090-01-07T17:00:00.000Z');
  refused({ startsAt: '2090-01-01T10:00:00' }, 'startsAt');
  refused({ startsAt: 'tomorrow' }, 'startsAt');
  refused({ startsAt: undefined as unknown as string }, 'startsAt');
  refused({ endsAt: '2090-01-01T00:00:00Z' }, 'endsAt');
  refused({ endsAt: '2089-12-31T00:00:00Z' }, 'endsAt');
  refused({ endsAt: '2090-13-45T00:00:00Z' }, 'endsAt');
});

test('season fields: the switches must be real booleans', () => {
  for (const field of ['applyCustomer', 'applyAdmin', 'particlesEnabled', 'isEnabled'] as const) {
    refused({ [field]: 'yes' } as Partial<WebsiteSeasonInput>, field);
    refused({ [field]: undefined } as Partial<WebsiteSeasonInput>, field);
  }
  assert.equal(parseSeasonFields(input({ applyAdmin: false })).applyAdmin, false);
});

test('season decoration: omitted means not sent; every value is checked; media ids are lower-cased UUIDs', () => {
  const none = parseSeasonFields(input());
  assert.deepEqual(none.decoration, {}, 'an older client sends none of it');
  assert.equal(
    none.slotMedia,
    undefined,
    'omitted images mean unchanged (update) or none (create)',
  );
  const id = '2F1B2D8E-5C3A-4B7A-9D2E-1A2B3C4D5E6F';
  const fields = parseSeasonFields(
    input({
      slotHeader: false,
      slotLogo: true,
      slotCorners: false,
      slotDividers: true,
      slotFooter: false,
      slotTint: true,
      greetingStrip: false,
      greetingFooter: true,
      particleDensity: 'low',
      slotMedia: { header: id, footer: id.toLowerCase() },
    }),
  );
  assert.deepEqual(fields.decoration, {
    slotHeader: false,
    slotLogo: true,
    slotCorners: false,
    slotDividers: true,
    slotFooter: false,
    slotTint: true,
    greetingStrip: false,
    greetingFooter: true,
    particleDensity: 'low',
  });
  assert.deepEqual(fields.slotMedia, { header: id.toLowerCase(), footer: id.toLowerCase() });
  assert.deepEqual(
    parseSeasonFields(input({ slotMedia: {} })).slotMedia,
    {},
    'an empty map clears',
  );
  for (const field of [
    'slotHeader',
    'slotLogo',
    'slotCorners',
    'slotDividers',
    'slotFooter',
    'slotTint',
    'greetingStrip',
    'greetingFooter',
  ] as const) {
    refused({ [field]: 'yes' } as Partial<WebsiteSeasonInput>, field);
    refused({ [field]: null } as unknown as Partial<WebsiteSeasonInput>, field);
  }
  for (const particleDensity of ['huge', '', 5, null]) {
    refused({ particleDensity } as unknown as Partial<WebsiteSeasonInput>, 'particleDensity');
  }
  for (const slotMedia of [
    null,
    'header',
    ['x'],
    { nowhere: id },
    { header: 'not-a-uuid' },
    { header: 5 },
    { header: null },
    { __proto__: id, header: id.slice(1) },
  ]) {
    refused({ slotMedia } as unknown as Partial<WebsiteSeasonInput>, 'slotMedia');
  }
});

test('season link: seasonId is a UUID or absent; a linked item is live only while its season is enabled', () => {
  const id = '3f0a4f0e-8f5e-4a52-9c1f-6c1f0e0c9b11';
  assert.equal(parseSeasonId(undefined), null);
  assert.equal(parseSeasonId(null), null);
  assert.equal(parseSeasonId(id.toUpperCase()), id);
  for (const bad of ['', 'nope', 5, {}, `${id}x`]) {
    assert.throws(
      () => parseSeasonId(bad),
      (error: unknown) => error instanceof AuthError && error.field === 'seasonId',
    );
  }
  assert.equal(
    effectivelyEnabled(true, null),
    true,
    'an independent item follows only its own switch',
  );
  assert.equal(effectivelyEnabled(false, null), false);
  assert.equal(effectivelyEnabled(true, { isEnabled: true }), true);
  assert.equal(effectivelyEnabled(true, { isEnabled: false }), false);
  assert.equal(effectivelyEnabled(false, { isEnabled: true }), false);
});
