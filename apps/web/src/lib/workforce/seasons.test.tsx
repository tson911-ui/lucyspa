import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSeasonPreset, SEASON_PRESETS, type WebsiteSeasonResponse } from '@lucy-spa/contracts';
import { MediaLibraryScreen } from '../../components/workforce/screens/media-library';
import { SeasonFormScreen } from '../../components/workforce/screens/website-season-form';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, failure, owner, render, scriptedFetch } from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import { normalizeMediaList } from './media';
import { emptyPopupForm, formOfPopup, popupInputOf } from './popups';
import {
  emptySeasonForm,
  filterSeasons,
  formatDay,
  formOfSeason,
  nextDay,
  presetName,
  previewGreeting,
  problemField,
  seasonFormChanged,
  seasonInputOf,
  seasonOverlapId,
  seasonTone,
  seasonWindowText,
  seasonYears,
  suggestedDates,
  type SeasonForm,
  type SeasonProblem,
} from './seasons';
import { emptySlideForm, slideInputOf } from './slides';
import { errorMessage } from './workflows';

/** The S6b decoration of a season saved with everything on, medium density and no image. */
const DECORATION = {
  slotHeader: true,
  slotLogo: true,
  slotCorners: true,
  slotDividers: true,
  slotFooter: true,
  slotTint: true,
  greetingStrip: true,
  greetingFooter: true,
  particleDensity: 'medium' as const,
  slotMedia: {},
};

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

/** Noon in Vietnam on a given day, so "today" is unambiguous whatever the machine's zone is. */
const noon = (day: string) => new Date(`${day}T12:00:00+07:00`);

const filled = (patch: Partial<SeasonForm> = {}): SeasonForm => ({
  ...emptySeasonForm('tet', noon('2027-01-05')),
  label: 'Tết 2027',
  startDate: '2027-02-04',
  lastDate: '2027-02-10',
  ...patch,
});

const problemOf = (patch: Partial<SeasonForm>): SeasonProblem | null => {
  const result = seasonInputOf(filled(patch));
  return 'problem' in result ? result.problem : null;
};

test('days: the last day is inclusive, so the request ends at the start of the day after it (Vietnam time)', () => {
  const result = seasonInputOf(filled());
  assert.ok('body' in result);
  assert.equal(result.body.startsAt, '2027-02-03T17:00:00.000Z');
  assert.equal(
    result.body.endsAt,
    '2027-02-10T17:00:00.000Z',
    'the start of 11 February in Vietnam',
  );
  assert.equal(nextDay('2027-02-28'), '2027-03-01');
  assert.equal(nextDay('2028-02-28'), '2028-02-29');
  assert.equal(nextDay('2027-12-31'), '2028-01-01');
  assert.equal(nextDay('2027-02-30'), null);
  assert.equal(nextDay('nope'), null);
  // A one-day season is allowed: first day = last day.
  const single = seasonInputOf(filled({ startDate: '2027-03-08', lastDate: '2027-03-08' }));
  assert.ok('body' in single);
  assert.equal(Date.parse(single.body.endsAt) - Date.parse(single.body.startsAt), 86_400_000);
});

test('a saved season comes back as the same first and last day', () => {
  const season = seasonInputOf(filled());
  assert.ok('body' in season);
  const response: WebsiteSeasonResponse = {
    ...season.body,
    ...DECORATION,
    id: 's-1',
    status: 'DRAFT',
    popupIds: [],
    slideIds: [],
    rowVersion: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const form = formOfSeason(response);
  assert.equal(form.startDate, '2027-02-04');
  assert.equal(form.lastDate, '2027-02-10');
  assert.equal(seasonFormChanged(form, filled({ greetingVi: '', greetingEn: '' })), false);
  assert.equal(seasonWindowText(response, 'vi'), '04/02/2027 – 10/02/2027');
  assert.equal(seasonWindowText(response, 'en'), '2027-02-04 – 2027-02-10');
  assert.equal(formatDay('2027-02-04', 'vi'), '04/02/2027');
});

test('validation: preset, name, greetings and days, in the order the form shows them', () => {
  assert.equal(problemOf({}), null);
  assert.equal(problemOf({ presetKey: 'unknown' }), 'presetKey');
  assert.equal(problemOf({ label: '   ' }), 'label');
  assert.equal(problemOf({ label: 'x'.repeat(81) }), 'label');
  assert.equal(problemOf({ label: 'x'.repeat(80) }), null);
  assert.equal(problemOf({ greetingVi: 'x'.repeat(81) }), 'greetingVi');
  assert.equal(problemOf({ greetingEn: 'x'.repeat(81) }), 'greetingEn');
  assert.equal(problemOf({ greetingVi: 'x'.repeat(80), greetingEn: ' ' }), null);
  assert.equal(problemOf({ startDate: '' }), 'startDate');
  assert.equal(problemOf({ startDate: '2027-13-01' }), 'startDate');
  assert.equal(problemOf({ lastDate: '' }), 'lastDate');
  assert.equal(problemOf({ lastDate: '2027-02-31' }), 'lastDate');
  assert.equal(problemOf({ lastDate: '2027-02-03' }), 'window');
  assert.equal(problemField('window'), 'lastDate');
  assert.equal(problemField('label'), 'label');
});

test('the request carries trimmed text, empty greetings as null, and the switches as typed', () => {
  const result = seasonInputOf(
    filled({
      label: '  Tết   2027 ',
      greetingVi: ' Chúc  mừng ',
      greetingEn: '',
      applyCustomer: false,
      particlesEnabled: false,
      isEnabled: true,
    }),
  );
  assert.ok('body' in result);
  assert.equal(result.body.label, 'Tết 2027');
  assert.equal(result.body.greetingVi, 'Chúc  mừng'.trim());
  assert.equal(result.body.greetingEn, null);
  assert.deepEqual(
    [
      result.body.applyCustomer,
      result.body.applyAdmin,
      result.body.particlesEnabled,
      result.body.isEnabled,
    ],
    [false, true, false, true],
  );
});

test('suggested days (Q-S3): solar holidays prefill the next occurrence, lunar ones never', () => {
  const women = getSeasonPreset('womens-day');
  assert.deepEqual(suggestedDates(women, noon('2027-01-05')), {
    startDate: '2027-03-06',
    lastDate: '2027-03-09',
  });
  // Still running on its last day: this year. Past: next year.
  assert.equal(suggestedDates(women, noon('2027-03-09'))?.startDate, '2027-03-06');
  assert.equal(suggestedDates(women, noon('2027-03-10'))?.startDate, '2028-03-06');
  const christmas = getSeasonPreset('christmas');
  assert.deepEqual(suggestedDates(christmas, noon('2027-12-27')), {
    startDate: '2028-12-15',
    lastDate: '2028-12-26',
  });
  for (const preset of SEASON_PRESETS) {
    const dates = suggestedDates(preset, noon('2027-01-05'));
    if (preset.suggestedWindow === null) assert.equal(dates, null, preset.key);
    else assert.ok(dates && dates.startDate <= dates.lastDate, preset.key);
  }
  // A new form starts on the suggestion; a lunar preset starts on today.
  assert.equal(emptySeasonForm('womens-day', noon('2027-01-05')).startDate, '2027-03-06');
  const lunar = emptySeasonForm('tet', noon('2027-01-05'));
  assert.deepEqual([lunar.startDate, lunar.lastDate], ['2027-01-05', '2027-01-05']);
  assert.equal(lunar.isEnabled, false, 'a new season is a draft');
});

test('preview greeting: the Owner’s text in the language, else the preset default', () => {
  const tet = getSeasonPreset('tet');
  assert.equal(previewGreeting(filled(), 'vi'), tet.greeting.vi);
  assert.equal(previewGreeting(filled(), 'en'), tet.greeting.en);
  assert.equal(previewGreeting(filled({ greetingVi: ' Xuân mới ' }), 'vi'), 'Xuân mới');
  assert.equal(previewGreeting(filled({ greetingVi: 'Xuân mới' }), 'en'), tet.greeting.en);
  assert.equal(previewGreeting(filled({ presetKey: 'retired' }), 'vi'), '');
  assert.equal(presetName('tet', 'en'), tet.name.en);
  assert.equal(presetName('retired', 'vi'), 'retired');
});

const season = (patch: Partial<WebsiteSeasonResponse>): WebsiteSeasonResponse => ({
  ...DECORATION,
  presetKey: 'tet',
  label: 'x',
  startsAt: '2026-12-31T17:00:00.000Z',
  endsAt: '2027-01-07T17:00:00.000Z',
  greetingVi: null,
  greetingEn: null,
  applyCustomer: true,
  applyAdmin: true,
  particlesEnabled: true,
  isEnabled: false,
  id: 's',
  status: 'DRAFT',
  popupIds: [],
  slideIds: [],
  rowVersion: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...patch,
});

test('list: status and year filters, years newest first, tones', () => {
  const items = [
    season({ id: 'a', status: 'ACTIVE', startsAt: '2026-12-31T17:00:00.000Z' }),
    season({ id: 'b', status: 'DRAFT', startsAt: '2027-02-03T17:00:00.000Z' }),
    season({ id: 'c', status: 'ENDED', startsAt: '2025-09-01T00:00:00.000Z' }),
  ];
  // 2026-12-31 17:00 UTC is already 1 January 2027 in Vietnam.
  assert.deepEqual(seasonYears(items), [2027, 2025]);
  assert.deepEqual(
    filterSeasons(items, { status: '', year: '' }).map((item) => item.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    filterSeasons(items, { status: 'DRAFT', year: '' }).map((item) => item.id),
    ['b'],
  );
  assert.deepEqual(
    filterSeasons(items, { status: '', year: '2027' }).map((item) => item.id),
    ['a', 'b'],
  );
  assert.deepEqual(filterSeasons(items, { status: 'ENDED', year: '2027' }), []);
  assert.deepEqual((['ACTIVE', 'SCHEDULED', 'ENDED', 'DRAFT'] as const).map(seasonTone), [
    'success',
    'info',
    'neutral',
    'warning',
  ]);
});

test('the website page has the seasons tab; unknown tabs fall back to the library', () => {
  assert.equal(normalizeMediaList({ q: '', page: 1, tab: 'season' }).tab, 'season');
  assert.equal(normalizeMediaList({ q: '', page: 1, tab: 'nope' }).tab, 'media');
  const page = render(<MediaLibraryScreen />, employee([['MANAGE_WEBSITE_CONTENT']]), 'en');
  assert.ok(page.includes(en.website.season), 'the tab');
  assert.ok(page.includes(en.website.media) && page.includes(en.website.slider));
});

test('the season form: create page, access rules, loading frame for an existing season', () => {
  const create = render(<SeasonFormScreen id={null} />, owner, 'en');
  assert.ok(create.includes(en.seasons.createTitle));
  assert.ok(create.includes(en.seasons.form.label) && create.includes(en.seasons.form.startDate));
  assert.ok(create.includes(en.seasons.form.lastDate) && create.includes(en.seasons.form.save));
  // The picker offers every preset; the full-page preview is one frame with a device and a theme selector.
  for (const preset of SEASON_PRESETS)
    assert.ok(create.includes(`value="${preset.key}"`), preset.key);
  assert.equal([...create.matchAll(/<iframe\b/g)].length, 1, 'one preview frame at a time');
  assert.ok(create.includes('src="/en/season-preview"'));
  for (const label of [
    en.seasons.form.previewDesktop,
    en.seasons.form.previewPhone,
    en.seasons.form.previewLight,
    en.seasons.form.previewDark,
    en.seasons.form.previewOpen,
  ]) {
    assert.ok(create.includes(label), label);
  }
  // The Decoration section: seven slot rows, the density control and the two greeting switches.
  assert.ok(create.includes(en.seasons.form.decorationSection));
  for (const name of [
    en.seasons.form.slotParticles,
    en.seasons.form.slotHeader,
    en.seasons.form.slotLogo,
    en.seasons.form.slotCorners,
    en.seasons.form.slotDividers,
    en.seasons.form.slotFooter,
    en.seasons.form.slotTint,
  ]) {
    assert.ok(create.includes(name), name);
  }
  assert.equal([...create.matchAll(/class="ls-season-slot"/g)].length, 7);
  assert.ok(create.includes(en.seasons.form.density));
  assert.ok(create.includes(en.seasons.form.greetingStrip));
  assert.ok(create.includes(en.seasons.form.greetingFooter));
  assert.ok(
    !create.includes(en.seasons.holiday.section),
    'linked content waits for a saved season',
  );
  for (const account of [employee([['MANAGE_WEBSITE_CONTENT', 'A']]), employee([])]) {
    const denied = render(<SeasonFormScreen id={null} />, account);
    assert.ok(denied.includes(vi.seasons.noAccess));
    assert.ok(!denied.includes(vi.seasons.form.save));
  }
  const editing = render(<SeasonFormScreen id="s-1" />, owner);
  assert.ok(editing.includes(vi.seasons.editTitle) && editing.includes(vi.common.loading));
  assert.ok(!editing.includes(vi.seasons.form.save));
});

test('an overlap refusal names the other season by id; its message exists in both languages', async () => {
  const other = '2f1b2d8e-5c3a-4b7a-9d2e-1a2b3c4d5e6f';
  const refused = new ApiError(409, 'SEASON_OVERLAP', other);
  assert.equal(seasonOverlapId(refused), other);
  assert.equal(seasonOverlapId(new ApiError(409, 'POPUP_OVERLAP', other)), null);
  assert.equal(seasonOverlapId(new Error('x')), null);
  assert.equal(errorMessage(refused, vi), vi.errors.seasonOverlap);
  assert.equal(errorMessage(refused, en), en.errors.seasonOverlap);
  assert.ok(vi.seasons.overlap.includes('{name}') && en.seasons.overlap.includes('{name}'));
  const { fetcher } = scriptedFetch([
    failure(
      409,
      'SEASON_OVERLAP',
      `Another enabled season already covers part of this time: ${other}`,
    ),
  ]);
  await assert.rejects(
    new WorkforceApi({ fetch: fetcher }).get('/api/v1/website/seasons'),
    (error: unknown) => error instanceof ApiError && seasonOverlapId(error) === other,
  );
});

test('popups and slides always send seasonId: the chosen season, or null (an omitted one would unlink)', () => {
  const popup = popupInputOf({
    ...emptyPopupForm(new Date('2027-01-05T00:00:00Z')),
    titleVi: 'Tết',
  });
  assert.ok('body' in popup);
  assert.equal(popup.body.seasonId, null);
  const followed = popupInputOf({
    ...emptyPopupForm(new Date('2027-01-05T00:00:00Z'), 's-1'),
    titleVi: 'Tết',
  });
  assert.ok('body' in followed);
  assert.equal(followed.body.seasonId, 's-1');
  assert.equal(
    formOfPopup({
      ...(popup.body as object),
      id: 'p',
      seasonId: 's-1',
      media: null,
      status: 'DRAFT',
      rowVersion: 1,
      createdAt: '',
      updatedAt: '',
    } as never).seasonId,
    's-1',
  );
  const media = { id: 'm', filename: 'a.png', width: 1, height: 1, altVi: 'a', altEn: null };
  const slide = slideInputOf({ ...emptySlideForm(), media });
  assert.ok('body' in slide);
  assert.equal(slide.body.seasonId, null);
  const slideFollowed = slideInputOf({ ...emptySlideForm('s-2'), media });
  assert.ok('body' in slideFollowed);
  assert.equal(slideFollowed.body.seasonId, 's-2');
});

test('Vietnamese and English season texts have the same keys', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
      : [prefix];
  for (const group of ['seasons', 'website', 'errors'] as const) {
    assert.deepEqual(keys(vi[group]).sort(), keys(en[group]).sort(), group);
  }
  for (const dictionary of [vi, en]) {
    for (const group of ['popups', 'slides'] as const) {
      for (const key of ['seasonSection', 'seasonLabel', 'seasonNone', 'seasonHint'] as const) {
        assert.ok(dictionary[group].form[key].length > 0, `${group}.form.${key}`);
      }
    }
  }
});
