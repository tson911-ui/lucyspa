import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALL_SEASON_SLOTS_ON,
  getSeasonPreset,
  SEASON_PRESETS,
  type PublicSeasonResponse,
} from '@lucy-spa/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeasonBand } from '../components/season/season-band';
import { seasonText } from '../i18n/season';
import {
  ADMIN_HIDE_COOKIE,
  parseAdminHidden,
  parsePublicSeason,
  publicSeasonUrl,
  seasonBandSpec,
  seasonRootAttributes,
  serializeAdminHidden,
} from './season-core';
import { fetchActiveSeason, SEASON_FETCH_TIMEOUT_MS } from './season-server';

// Seasonal themes on the web (docs/UXUI_REDESIGN_DESIGN.md 20.5, 20.9): the API answer is checked, every failure
// means "no season", the document root and the customer band follow the schedule, the admin touch has a per-device hide.
const body = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  presetKey: 'tet',
  greeting: 'Chúc mừng năm mới',
  endsAt: '2027-02-11T17:00:00.000Z',
  particles: true,
  customer: true,
  admin: true,
  slots: {
    particles: true,
    header: true,
    logo: true,
    corners: true,
    dividers: true,
    footer: true,
    tint: true,
  },
  density: 'medium',
  greetingStrip: true,
  greetingFooter: true,
  media: {},
  ...patch,
});
const season = (patch: Partial<PublicSeasonResponse> = {}): PublicSeasonResponse => ({
  ...(body() as unknown as PublicSeasonResponse),
  ...patch,
});

test('the public season answer is checked: a known preset, a short greeting, a real date, real booleans', () => {
  assert.deepEqual(parsePublicSeason(body()), body());
  for (const preset of SEASON_PRESETS) {
    assert.equal(parsePublicSeason(body({ presetKey: preset.key }))?.presetKey, preset.key);
  }
  for (const patch of [
    { presetKey: 'retired' },
    { presetKey: 5 },
    { greeting: '' },
    { greeting: 'x'.repeat(81) },
    { greeting: 7 },
    { endsAt: 'soon' },
    { endsAt: undefined },
    { particles: 'yes' },
    { customer: 1 },
    { admin: undefined },
    { customer: false, admin: false },
  ]) {
    assert.equal(parsePublicSeason(body(patch)), null, JSON.stringify(patch));
  }
  for (const value of [null, undefined, 'tet', 5, [], true]) {
    assert.equal(parsePublicSeason(value), null);
  }
  assert.equal(publicSeasonUrl('en'), '/api/v1/public/website/season?locale=en');
});

test('the S6b decoration is optional (an older API), and a present-but-odd value is no season', () => {
  const { slots, density, greetingStrip, greetingFooter, media, ...old } = body() as Record<
    string,
    unknown
  >;
  void [slots, density, greetingStrip, greetingFooter, media];
  const parsed = parsePublicSeason(old)!;
  assert.deepEqual(parsed.slots, ALL_SEASON_SLOTS_ON, 'an older API means everything on');
  assert.equal(parsed.density, 'medium');
  assert.equal(parsed.greetingStrip && parsed.greetingFooter, true);
  assert.deepEqual(parsed.media, {});
  // The particles slot follows the answer's own `particles` field.
  assert.equal(parsePublicSeason({ ...old, particles: false })!.slots.particles, false);
  const id = '2f1b2d8e-5c3a-4b7a-9d2e-1a2b3c4d5e6f';
  const url = `/api/v1/public/media/${id}/lg`;
  assert.deepEqual(parsePublicSeason(body({ media: { header: url } }))!.media, { header: url });
  for (const patch of [
    { slots: 'all' },
    { slots: { header: 'yes' } },
    { density: 'huge' },
    { greetingStrip: 'no' },
    { greetingFooter: 1 },
    { media: [] },
    { media: { header: 'https://evil.example/x.png' } },
    { media: { header: '//evil.example/x.png' } },
    { media: { header: `/api/v1/public/media/${id}/original` } },
    { media: { header: `/api/v1/website/media/${id}/lg` } },
    { media: { nowhere: url } },
    { media: { header: 5 } },
  ]) {
    assert.equal(parsePublicSeason(body(patch)), null, JSON.stringify(patch));
  }
});

test('the server read fails closed: a 204, an error status, a bad body, a network failure or a timeout is no season', async () => {
  const answer = (status: number, json: unknown = body()) =>
    (() =>
      Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(json), { status }),
      )) as typeof fetch;
  assert.deepEqual(await fetchActiveSeason('vi', answer(200)), body());
  assert.equal(await fetchActiveSeason('vi', answer(204)), null);
  assert.equal(await fetchActiveSeason('vi', answer(500)), null);
  assert.equal(await fetchActiveSeason('vi', answer(200, { presetKey: 'nope' })), null);
  assert.equal(await fetchActiveSeason('vi', answer(200, 'not an object')), null);
  assert.equal(
    await fetchActiveSeason('vi', (() => Promise.reject(new Error('down'))) as typeof fetch),
    null,
  );
  assert.equal(
    await fetchActiveSeason('vi', (() =>
      Promise.resolve(new Response('{oops', { status: 200 }))) as typeof fetch),
    null,
  );
  // The request is anonymous, asks the API for the visitor's language, and is bounded in time and cached for a minute.
  type Init = { credentials?: string; signal?: unknown; next?: { revalidate?: number } };
  const calls: { url: string; init: Init }[] = [];
  await fetchActiveSeason('en', ((url: string, init: Init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as unknown as typeof fetch);
  const request = calls[0]!;
  assert.match(request.url, /\/api\/v1\/public\/website\/season\?locale=en$/);
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.next?.revalidate, 60);
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.ok(SEASON_FETCH_TIMEOUT_MS <= 2_000);
});

test('document root: the preset when a season applies; the admin switch and this device can turn the touch off', () => {
  assert.deepEqual(seasonRootAttributes(null, false), {});
  assert.deepEqual(seasonRootAttributes(null, true), {});
  assert.deepEqual(seasonRootAttributes(season(), false), { 'data-season': 'tet' });
  assert.deepEqual(seasonRootAttributes(season({ admin: false }), false), {
    'data-season': 'tet',
    'data-season-admin': 'off',
  });
  assert.deepEqual(seasonRootAttributes(season(), true), {
    'data-season': 'tet',
    'data-season-admin': 'off',
  });
});

test('the per-device hide is a one-year Lax cookie that the server can read', () => {
  assert.equal(parseAdminHidden(`a=1; ${ADMIN_HIDE_COOKIE}=off; b=2`), true);
  assert.equal(parseAdminHidden(`${ADMIN_HIDE_COOKIE}=on`), false);
  assert.equal(parseAdminHidden(`x-${ADMIN_HIDE_COOKIE}=off`), false);
  assert.equal(parseAdminHidden(''), false);
  assert.equal(parseAdminHidden(undefined), false);
  const set = serializeAdminHidden(true);
  assert.match(set, /^ls-season-admin=off; Path=\/; Max-Age=31536000; SameSite=Lax$/);
  assert.equal(parseAdminHidden(set), true);
  assert.match(serializeAdminHidden(false), /Max-Age=0/);
});

test('the customer band: only when the schedule is for customers; particles only when asked and the preset has them', () => {
  assert.equal(seasonBandSpec(null), null);
  assert.equal(seasonBandSpec(season({ customer: false })), null);
  // Valentine has no site-wide art yet, so it keeps the S5 band; Tet and Christmas draw the S6 decoration instead.
  const valentine = seasonBandSpec(season({ presetKey: 'valentine' }));
  assert.equal(valentine?.ornamentId, getSeasonPreset('valentine').ornament.id);
  assert.equal(valentine?.greeting, 'Chúc mừng năm mới');
  assert.equal(valentine?.particle, getSeasonPreset('valentine').ornament.particle);
  assert.equal(
    seasonBandSpec(season({ presetKey: 'valentine', particles: false }))?.particle,
    'none',
  );
  assert.equal(seasonBandSpec(season({ presetKey: 'retired' })), null);
  assert.equal(seasonBandSpec(season()), null, 'Tet has site art, no band');
  assert.equal(seasonBandSpec(season({ presetKey: 'christmas' })), null, 'Christmas too');
});

test('the band renders on the server with the greeting, hidden ornaments, and the effects button only when effects exist', async () => {
  const live = (patch: Record<string, unknown>) => {
    const original = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response(JSON.stringify(body(patch)), { status: 200 }))) as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  };
  let restore = live({ presetKey: 'valentine', greeting: 'Giáng sinh an lành' });
  try {
    const html = renderToStaticMarkup(await SeasonBand({ locale: 'vi' }));
    assert.match(html, /<section class="ls-season-band" aria-label="Lời chúc theo mùa lễ">/);
    assert.ok(html.includes('Giáng sinh an lành'));
    assert.ok(html.includes('aria-hidden="true"'), 'ornaments are decorative');
    assert.doesNotMatch(html, /data-season=/, 'the page carries the preset, the band inherits it');
    assert.ok(html.includes(seasonText('vi').fxOff), 'the per-device effects switch');
    assert.doesNotMatch(html, /ls-fx-particle/, 'particles never render on the server');
    restore();
    restore = live({ presetKey: 'valentine', particles: false });
    const still = renderToStaticMarkup(await SeasonBand({ locale: 'en' }));
    assert.ok(still.includes('Chúc mừng năm mới'));
    assert.ok(!still.includes(seasonText('en').fxOff), 'nothing to switch off');
    restore();
    restore = live({ customer: false });
    assert.equal(await SeasonBand({ locale: 'vi' }), null);
    restore();
    globalThis.fetch = (() => Promise.reject(new Error('down'))) as typeof fetch;
    assert.equal(await SeasonBand({ locale: 'vi' }), null, 'a failing API changes nothing');
  } finally {
    restore();
  }
});

test('the band and admin texts exist in both languages', () => {
  for (const locale of ['vi', 'en'] as const) {
    for (const value of Object.values(seasonText(locale))) assert.ok(value.length > 0);
  }
  assert.notEqual(seasonText('vi').fxOff, seasonText('en').fxOff);
});
