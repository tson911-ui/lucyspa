import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebsitePopupResponse } from '@lucy-spa/contracts';
import { PopupFormScreen } from '../../components/workforce/screens/website-popup-form';
import { MediaLibraryScreen } from '../../components/workforce/screens/media-library';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, failure, owner, render, scriptedFetch } from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import {
  emptyPopupForm,
  formOfPopup,
  overlapId,
  popupFormChanged,
  popupInputOf,
  popupName,
  popupTone,
  previewContent,
  previewImageOf,
  problemField,
  type PopupForm,
  type PopupProblem,
} from './popups';
import { errorMessage } from './workflows';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

const media = {
  id: 'm-1',
  filename: 'tet.png',
  width: 1920,
  height: 800,
  altVi: 'Ảnh Tết',
  altEn: null,
};

const filled = (patch: Partial<PopupForm> = {}): PopupForm => ({
  ...emptyPopupForm(new Date('2090-01-01T00:00:00Z')),
  titleVi: 'Khuyến mãi Tết',
  ...patch,
});

const problemOf = (patch: Partial<PopupForm>): PopupProblem | null => {
  const result = popupInputOf(filled(patch));
  return 'problem' in result ? result.problem : null;
};

const response: WebsitePopupResponse = {
  id: 'p-1',
  seasonId: null,
  mediaId: 'm-1',
  media,
  titleVi: 'Khuyến mãi Tết',
  titleEn: null,
  bodyVi: 'Giảm 20%',
  bodyEn: null,
  ctaLabelVi: 'Đặt lịch',
  ctaLabelEn: null,
  ctaUrl: '/{locale}/account/book',
  startsAt: '2090-01-01T00:00:00.000Z',
  endsAt: '2090-01-08T10:30:00.000Z',
  isEnabled: true,
  status: 'SCHEDULED',
  rowVersion: 4,
  createdAt: '2089-12-01T00:00:00.000Z',
  updatedAt: '2089-12-02T00:00:00.000Z',
};

test('a new popup is a draft that starts at the given time and runs a week, in Vietnam time', () => {
  const form = emptyPopupForm(new Date('2090-01-01T00:00:00Z'));
  assert.equal(form.isEnabled, false);
  assert.equal(form.startsAt, '2090-01-01T07:00');
  assert.equal(form.endsAt, '2090-01-08T07:00');
  assert.equal(form.media, null);
});

test('the form round-trips a popup: Vietnam local times, empty text, the chosen image', () => {
  const form = formOfPopup(response);
  assert.equal(form.startsAt, '2090-01-01T07:00');
  assert.equal(form.endsAt, '2090-01-08T17:30');
  assert.equal(form.titleEn, '');
  assert.equal(form.media?.id, 'm-1');
  const request = popupInputOf(form);
  assert.ok('body' in request);
  assert.deepEqual(request.body, {
    mediaId: 'm-1',
    titleVi: 'Khuyến mãi Tết',
    titleEn: null,
    bodyVi: 'Giảm 20%',
    bodyEn: null,
    ctaLabelVi: 'Đặt lịch',
    ctaLabelEn: null,
    ctaUrl: '/{locale}/account/book',
    startsAt: '2090-01-01T00:00:00.000Z',
    endsAt: '2090-01-08T10:30:00.000Z',
    isEnabled: true,
  });
  assert.equal(popupFormChanged(form, formOfPopup(response)), false);
  assert.equal(popupFormChanged({ ...form, titleVi: 'x' }, formOfPopup(response)), true);
});

test('form checks: the first problem found, named after the field to fix', () => {
  assert.equal(problemOf({}), null);
  assert.equal(problemOf({ titleVi: '  ' }), 'content');
  assert.equal(problemOf({ titleVi: '', media }), null, 'an image alone is enough');
  assert.equal(problemOf({ titleVi: 'x'.repeat(121) }), 'titleVi');
  assert.equal(problemOf({ bodyEn: 'x'.repeat(301) }), 'bodyEn');
  assert.equal(problemOf({ ctaLabelVi: 'x'.repeat(41), ctaUrl: '/vi' }), 'ctaLabelVi');
  assert.equal(problemOf({ ctaUrl: '/vi/book' }), 'ctaLabel');
  assert.equal(problemOf({ ctaLabelVi: 'Go' }), 'ctaUrl');
  assert.equal(problemOf({ ctaLabelVi: 'Go', ctaUrl: 'javascript:alert(1)' }), 'ctaUrl');
  assert.equal(problemOf({ ctaLabelEn: 'Go', ctaUrl: 'https://example.com' }), null);
  assert.equal(problemOf({ startsAt: '' }), 'startsAt');
  assert.equal(problemOf({ endsAt: 'soon' }), 'endsAt');
  assert.equal(problemOf({ startsAt: '2090-02-01T10:00', endsAt: '2090-02-01T10:00' }), 'window');
  assert.equal(problemOf({ startsAt: '2090-02-02T10:00', endsAt: '2090-02-01T10:00' }), 'window');
  // Every problem has a message in both languages and a field to focus.
  const problems = Object.keys(vi.popups.form.problems) as PopupProblem[];
  assert.deepEqual(problems.slice().sort(), Object.keys(en.popups.form.problems).sort());
  for (const problem of problems) {
    assert.ok(vi.popups.form.problems[problem].length > 0);
    assert.ok(problemField(problem) in filled(), problem);
  }
});

test('status colours: live is green, scheduled blue, ended grey, a draft is a warning', () => {
  assert.deepEqual((['ACTIVE', 'SCHEDULED', 'ENDED', 'DRAFT'] as const).map(popupTone), [
    'success',
    'info',
    'neutral',
    'warning',
  ]);
});

test('a popup goes by its title in the viewer language, else the other one, else its image', () => {
  const base = { titleVi: 'Tết', titleEn: 'Tet', media };
  assert.equal(popupName(base, 'vi', '—'), 'Tết');
  assert.equal(popupName(base, 'en', '—'), 'Tet');
  assert.equal(popupName({ ...base, titleEn: null }, 'en', '—'), 'Tết');
  assert.equal(popupName({ titleVi: null, titleEn: null, media }, 'vi', '—'), 'tet.png');
  assert.equal(popupName({ titleVi: null, titleEn: null, media: null }, 'vi', '—'), '—');
});

test('preview: the same language rules as the live popup, from the form', () => {
  const form = filled({
    titleVi: 'Chào',
    titleEn: '',
    bodyEn: 'Body',
    ctaLabelVi: 'Đặt lịch',
    ctaUrl: '/vi/account/book',
    media,
  });
  const image = previewImageOf(form.media, 'en');
  assert.deepEqual(image, {
    src: '/api/v1/website/media/m-1/md',
    alt: 'Ảnh Tết',
    width: 1920,
    height: 800,
  });
  const english = previewContent(form, 'en', image);
  assert.equal(english?.title, 'Chào', 'falls back to the other language');
  assert.equal(english?.body, 'Body');
  assert.deepEqual(english?.cta, { label: 'Đặt lịch', href: '/vi/account/book' });
  assert.equal(previewContent(form, 'vi', image)?.body, 'Body');
  assert.equal(previewContent(filled({ titleVi: '' }), 'vi', null), null, 'nothing to preview');
  assert.equal(previewContent(filled({ titleVi: '', media }), 'vi', image)?.title, null);
  assert.equal(previewContent(filled(), 'vi', null)?.cta, null, 'no link, no button');
  assert.equal(previewImageOf(null, 'vi'), null);
  assert.equal(previewImageOf({ ...media, altVi: null, altEn: null }, 'vi')?.alt, 'tet.png');
});

test('an overlap refusal names the other popup by id; its message exists in both languages', () => {
  const refused = new ApiError(409, 'POPUP_OVERLAP', 'ab12cd34-0000-4000-8000-000000000001');
  assert.equal(overlapId(refused), 'ab12cd34-0000-4000-8000-000000000001');
  assert.equal(overlapId(new ApiError(409, 'CONFLICT')), null);
  assert.equal(overlapId(new Error('x')), null);
  assert.equal(errorMessage(refused, vi), vi.errors.popupOverlap);
  assert.equal(errorMessage(refused, en), en.errors.popupOverlap);
  assert.equal(
    errorMessage(new ApiError(409, 'MEDIA_ALT_REQUIRED', 'mediaId'), vi),
    vi.errors.mediaAltRequired,
  );
  assert.ok(vi.popups.overlap.includes('{name}') && en.popups.overlap.includes('{name}'));
});

test('the API client reads the other popup’s id out of a real overlap refusal', async () => {
  const other = '2f1b2d8e-5c3a-4b7a-9d2e-1a2b3c4d5e6f';
  const { fetcher } = scriptedFetch([
    failure(
      409,
      'POPUP_OVERLAP',
      `Another enabled popup already covers part of this time: ${other}`,
    ),
    failure(400, 'VALIDATION_FAILED', 'Validation failed: ctaUrl'),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  await assert.rejects(
    api.get('/api/v1/website/popups'),
    (error: unknown) => error instanceof ApiError && overlapId(error) === other,
  );
  // Field names still parse as before.
  await assert.rejects(
    api.get('/api/v1/website/popups'),
    (error: unknown) => error instanceof ApiError && error.field === 'ctaUrl',
  );
});

test('Vietnamese and English popup texts have the same keys', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
      : [prefix];
  for (const group of ['popups', 'website'] as const) {
    assert.deepEqual(keys(vi[group]).sort(), keys(en[group]).sort(), group);
  }
  assert.deepEqual(keys(vi.media.remove).sort(), keys(en.media.remove).sort());
  assert.deepEqual(keys(vi.errors).sort(), keys(en.errors).sort());
});

test('the website page: popup actions need the global website permission; the popup form too', () => {
  const editor = employee([['MANAGE_WEBSITE_CONTENT']]);
  const page = render(<MediaLibraryScreen />, editor, 'en');
  assert.ok(page.includes(en.website.title), 'the page title');
  assert.ok(page.includes(en.website.media) && page.includes(en.website.popup), 'both tabs');
  assert.ok(page.includes(en.media.upload), 'the library tab shows its page action first');
  const branchOnly = render(<MediaLibraryScreen />, employee([['MANAGE_WEBSITE_CONTENT', 'A']]));
  assert.ok(!branchOnly.includes(vi.website.popup));
  assert.ok(branchOnly.includes(vi.media.noAccess));

  const create = render(<PopupFormScreen id={null} />, owner, 'en');
  assert.ok(create.includes(en.popups.createTitle));
  assert.ok(create.includes(en.popups.form.titleVi) && create.includes(en.popups.form.startsAt));
  assert.ok(create.includes(en.popups.form.save));
  assert.ok(!create.includes(en.popups.noAccess));
  for (const account of [employee([['MANAGE_WEBSITE_CONTENT', 'A']]), employee([])]) {
    const denied = render(<PopupFormScreen id={null} />, account);
    assert.ok(denied.includes(vi.popups.noAccess));
    assert.ok(!denied.includes(vi.popups.form.save));
  }
  // An existing popup shows its page frame while it loads, never a half-empty form.
  const editing = render(<PopupFormScreen id="p-1" />, owner);
  assert.ok(editing.includes(vi.popups.editTitle));
  assert.ok(editing.includes(vi.common.loading));
  assert.ok(!editing.includes(vi.popups.form.save));
});
