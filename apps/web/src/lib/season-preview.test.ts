import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_SEASON_SLOTS_ON } from '@lucy-spa/contracts';
import { siteDecorSpec } from './season-core';
import {
  PREVIEW_MAX_HEIGHT,
  PREVIEW_MIN_HEIGHT,
  PREVIEW_SOURCE,
  parsePreviewMessage,
  previewMediaUrl,
  seasonOfDraft,
  type SeasonPreviewDraft,
} from './season-preview';
import { canPreviewSeasons } from './season-preview-server';
import { draftOfForm, emptySeasonForm } from './workforce/seasons';

// The full-page season preview (docs/UXUI_REDESIGN_S6_PLAN.md section 6, Owner decision 7): what the form sends, what the
// page accepts, what it draws, and who may open it.
const id = '2f1b2d8e-5c3a-4b7a-9d2e-1a2b3c4d5e6f';
const draft = (patch: Partial<SeasonPreviewDraft> = {}): SeasonPreviewDraft => ({
  presetKey: 'celebration',
  greeting: 'Chúc mừng',
  endsAt: '2027-02-12T17:00:00.000Z',
  customer: true,
  particles: true,
  slots: { ...ALL_SEASON_SLOTS_ON },
  density: 'medium',
  greetingStrip: true,
  greetingFooter: true,
  mediaIds: {},
  ...patch,
});
const message = (patch: Record<string, unknown> = {}) => ({
  source: PREVIEW_SOURCE,
  type: 'draft',
  draft: draft(),
  theme: 'dark',
  ...patch,
});

test('the form state becomes a draft: slots, density, greeting switches, images and the exclusive end', () => {
  const form = {
    ...emptySeasonForm('celebration', new Date('2026-10-02T05:00:00Z')),
    label: 'Khai trương',
    startDate: '2026-10-05',
    lastDate: '2026-10-07',
    greetingVi: 'Mừng khai trương',
    slotHeader: false,
    slotTint: false,
    greetingFooter: false,
    particleDensity: 'high' as const,
    particlesEnabled: false,
    slotMedia: { footer: id },
  };
  const result = draftOfForm(form, 'vi');
  assert.equal(result.presetKey, 'celebration');
  assert.equal(result.greeting, 'Mừng khai trương');
  assert.equal(
    result.endsAt,
    '2026-10-07T17:00:00.000Z',
    'the day after the last day, Vietnam midnight',
  );
  assert.deepEqual(result.slots, {
    particles: false,
    header: false,
    logo: true,
    corners: true,
    dividers: true,
    footer: true,
    tint: false,
  });
  assert.equal(result.density, 'high');
  assert.equal(result.greetingFooter, false);
  assert.deepEqual(result.mediaIds, { footer: id });
  // An unreadable day never throws: the preview still draws.
  assert.ok(Number.isFinite(Date.parse(draftOfForm({ ...form, lastDate: '' }, 'vi').endsAt)));
});

test('the page accepts only well-formed messages: a draft, ready, and a clamped height', () => {
  assert.deepEqual(parsePreviewMessage({ source: PREVIEW_SOURCE, type: 'ready' }), {
    source: PREVIEW_SOURCE,
    type: 'ready',
  });
  assert.equal(parsePreviewMessage(message())?.type, 'draft');
  assert.equal(
    (
      parsePreviewMessage({ source: PREVIEW_SOURCE, type: 'height', value: 10 }) as {
        value: number;
      }
    ).value,
    PREVIEW_MIN_HEIGHT,
  );
  assert.equal(
    (
      parsePreviewMessage({ source: PREVIEW_SOURCE, type: 'height', value: 1e9 }) as {
        value: number;
      }
    ).value,
    PREVIEW_MAX_HEIGHT,
  );
  for (const bad of [
    null,
    'draft',
    42,
    [],
    {},
    { type: 'draft', draft: draft(), theme: 'dark' },
    { ...message(), source: 'someone-else' },
    message({ type: 'run' }),
    message({ theme: 'sepia' }),
    message({ draft: null }),
    message({ draft: draft({ presetKey: 'nope' }) }),
    message({ draft: draft({ greeting: 'x'.repeat(81) }) }),
    message({ draft: draft({ endsAt: 'soon' }) }),
    message({ draft: { ...draft(), density: 'huge' } }),
    message({ draft: { ...draft(), customer: 'yes' } }),
    message({ draft: { ...draft(), slots: { ...ALL_SEASON_SLOTS_ON, header: 1 } } }),
    message({ draft: { ...draft(), slots: 'all' } }),
    message({ draft: { ...draft(), mediaIds: { header: 'https://evil.example/x.png' } } }),
    message({ draft: { ...draft(), mediaIds: { nowhere: id } } }),
    message({ draft: { ...draft(), mediaIds: [] } }),
    { source: PREVIEW_SOURCE, type: 'height', value: Number.NaN },
    { source: PREVIEW_SOURCE, type: 'height', value: '900' },
  ]) {
    assert.equal(parsePreviewMessage(bad), null, JSON.stringify(bad));
  }
});

test('a draft stands for the public answer the live site would parse; images use the admin library, never a free address', () => {
  const season = seasonOfDraft(draft({ mediaIds: { footer: id, header: id } }))!;
  assert.equal(season.presetKey, 'celebration');
  assert.equal(season.slots.footer, true);
  assert.deepEqual(season.media, {
    footer: `/api/v1/website/media/${id}/lg`,
    header: `/api/v1/website/media/${id}/lg`,
  });
  assert.equal(previewMediaUrl(id, 'logo'), `/api/v1/website/media/${id}/md`);
  const spec = siteDecorSpec(season, 'vi')!;
  assert.equal(spec.kit, 'celebration');
  assert.equal(spec.images.footer, `/api/v1/website/media/${id}/lg`);
  // Particles follow both the switch and the customer side.
  assert.equal(siteDecorSpec(seasonOfDraft(draft({ particles: false }))!, 'vi')!.particles, false);
  assert.equal(siteDecorSpec(seasonOfDraft(draft({ density: 'high' }))!, 'vi')!.density, 'high');
  // Not for the customer side: the preview is the plain site (no decoration).
  assert.equal(siteDecorSpec(seasonOfDraft(draft({ customer: false }))!, 'vi'), null);
  // The Tet year name follows the end date, as on the live site.
  const tet = siteDecorSpec(seasonOfDraft(draft({ presetKey: 'tet' }))!, 'vi')!;
  assert.equal(tet.footer.sub, 'Xuân Đinh Mùi 2027');
  assert.equal(tet.zodiac, 'mui');
});

test('who may open the preview: only a session the API answers 200 for; anything else is "no"', async () => {
  const answer = (status: number) =>
    (() => Promise.resolve(new Response('{}', { status }))) as typeof fetch;
  assert.equal(await canPreviewSeasons('ls_session=abc', answer(200)), true);
  for (const status of [401, 403, 404, 500, 204]) {
    assert.equal(await canPreviewSeasons('ls_session=abc', answer(status)), false, String(status));
  }
  assert.equal(await canPreviewSeasons('', answer(200)), false, 'no cookie, no call');
  assert.equal(await canPreviewSeasons('   ', answer(200)), false);
  assert.equal(
    await canPreviewSeasons('ls_session=abc', (() =>
      Promise.reject(new Error('down'))) as typeof fetch),
    false,
  );
  // The session cookie is forwarded to the permission-checked list, never cached.
  type Init = { headers?: Record<string, string>; cache?: string; signal?: unknown };
  const calls: { url: string; init: Init }[] = [];
  await canPreviewSeasons('ls_session=abc', ((url: string, init: Init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as unknown as typeof fetch);
  assert.match(calls[0]!.url, /\/api\/v1\/website\/seasons$/);
  assert.equal(calls[0]!.init.headers?.['cookie'], 'ls_session=abc');
  assert.equal(calls[0]!.init.cache, 'no-store');
  assert.ok(calls[0]!.init.signal instanceof AbortSignal);
});
