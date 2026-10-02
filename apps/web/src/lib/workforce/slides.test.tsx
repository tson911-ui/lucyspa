import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebsiteSlideResponse } from '@lucy-spa/contracts';
import { HomeSlider } from '../../components/public/home-slider';
import { MediaLibraryScreen } from '../../components/workforce/screens/media-library';
import { SlidesPanel } from '../../components/workforce/screens/website-slides';
import { getDictionary } from '../../i18n/dictionaries';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from './api';
import { MEDIA_LIST_DEFAULTS, normalizeMediaList } from './media';
import {
  applyPageOrder,
  emptySlideForm,
  formOfSlide,
  inOrder,
  problemField,
  slideFormChanged,
  slideInputOf,
  slideLimitRefused,
  slideName,
  slideTone,
  visibleCount,
  type SlideForm,
  type SlideProblem,
} from './slides';
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
const phone = { ...media, id: 'm-2', filename: 'tet-phone.png', width: 1080, height: 1350 };

const filled = (patch: Partial<SlideForm> = {}): SlideForm => ({
  ...emptySlideForm(),
  media,
  titleVi: 'Khuyến mãi Tết',
  ...patch,
});

const problemOf = (patch: Partial<SlideForm>): SlideProblem | null => {
  const result = slideInputOf(filled(patch));
  return 'problem' in result ? result.problem : null;
};

const response: WebsiteSlideResponse = {
  id: 's-1',
  seasonId: null,
  mediaId: 'm-1',
  media,
  mobileMediaId: 'm-2',
  mobileMedia: phone,
  titleVi: 'Khuyến mãi Tết',
  titleEn: null,
  subtitleVi: 'Giảm 20%',
  subtitleEn: null,
  linkUrl: '/{locale}/account/book',
  linkLabelVi: 'Đặt lịch',
  linkLabelEn: null,
  altVi: 'Mô tả riêng',
  altEn: null,
  startsAt: '2090-01-01T00:00:00.000Z',
  endsAt: null,
  isEnabled: true,
  position: 2,
  status: 'SCHEDULED',
  rowVersion: 4,
  createdAt: '2089-12-01T00:00:00.000Z',
  updatedAt: '2089-12-02T00:00:00.000Z',
};

test('a new slide is hidden, open-ended, with no image yet', () => {
  const form = emptySlideForm();
  assert.equal(form.isEnabled, false);
  assert.equal(form.startsAt, '');
  assert.equal(form.endsAt, '');
  assert.equal(form.media, null);
  assert.equal(form.mobileMedia, null);
});

test('the form round-trips a slide: Vietnam local times, an open end, both images, the description', () => {
  const form = formOfSlide(response);
  assert.equal(form.startsAt, '2090-01-01T07:00');
  assert.equal(form.endsAt, '');
  assert.equal(form.titleEn, '');
  assert.equal(form.media?.id, 'm-1');
  assert.equal(form.mobileMedia?.id, 'm-2');
  const request = slideInputOf(form);
  assert.ok('body' in request);
  assert.deepEqual(request.body, {
    mediaId: 'm-1',
    mobileMediaId: 'm-2',
    titleVi: 'Khuyến mãi Tết',
    titleEn: null,
    subtitleVi: 'Giảm 20%',
    subtitleEn: null,
    linkUrl: '/{locale}/account/book',
    linkLabelVi: 'Đặt lịch',
    linkLabelEn: null,
    altVi: 'Mô tả riêng',
    altEn: null,
    startsAt: '2090-01-01T00:00:00.000Z',
    endsAt: null,
    isEnabled: true,
    seasonId: null,
  });
  assert.equal(slideFormChanged(form, formOfSlide(response)), false);
  assert.equal(slideFormChanged({ ...form, titleVi: 'x' }, formOfSlide(response)), true);
});

test('form checks: the first problem found, named after the field to fix', () => {
  assert.equal(problemOf({}), null);
  assert.equal(problemOf({ media: null }), 'media');
  assert.equal(problemOf({ mobileMedia: media }), 'mobileMedia', 'the same image twice');
  assert.equal(problemOf({ mobileMedia: phone }), null);
  assert.equal(problemOf({ titleVi: '', titleEn: '' }), null, 'a slide may be image only');
  assert.equal(problemOf({ titleVi: 'x'.repeat(121) }), 'titleVi');
  assert.equal(problemOf({ subtitleEn: 'x'.repeat(201) }), 'subtitleEn');
  assert.equal(problemOf({ altVi: 'x'.repeat(301) }), 'altVi');
  assert.equal(problemOf({ linkLabelVi: 'x'.repeat(41), linkUrl: '/vi' }), 'linkLabelVi');
  assert.equal(problemOf({ linkUrl: '/vi/book' }), 'linkLabel');
  assert.equal(problemOf({ linkLabelVi: 'Go' }), 'linkUrl');
  assert.equal(problemOf({ linkLabelVi: 'Go', linkUrl: 'javascript:alert(1)' }), 'linkUrl');
  assert.equal(problemOf({ linkLabelEn: 'Go', linkUrl: 'https://example.com' }), null);
  // Both ends are optional; a typed one must be a real time.
  assert.equal(problemOf({ startsAt: '', endsAt: '' }), null);
  assert.equal(problemOf({ startsAt: '2090-02-01T10:00', endsAt: '' }), null);
  assert.equal(problemOf({ startsAt: 'soon' }), 'startsAt');
  assert.equal(problemOf({ endsAt: 'soon' }), 'endsAt');
  assert.equal(problemOf({ startsAt: '2090-02-01T10:00', endsAt: '2090-02-01T10:00' }), 'window');
  assert.equal(problemOf({ startsAt: '2090-02-02T10:00', endsAt: '2090-02-01T10:00' }), 'window');
  // Every problem has a message in both languages and a field to focus.
  const problems = Object.keys(vi.slides.form.problems) as SlideProblem[];
  assert.deepEqual(problems.slice().sort(), Object.keys(en.slides.form.problems).sort());
  for (const problem of problems) {
    assert.ok(vi.slides.form.problems[problem].length > 0);
    assert.ok(problemField(problem) in filled(), problem);
  }
});

test('status colours: visible is green, scheduled blue, ended grey, hidden a warning', () => {
  assert.deepEqual((['VISIBLE', 'SCHEDULED', 'ENDED', 'HIDDEN'] as const).map(slideTone), [
    'success',
    'info',
    'neutral',
    'warning',
  ]);
  const count = (statuses: WebsiteSlideResponse['status'][]) =>
    visibleCount(statuses.map((status) => ({ status })));
  assert.equal(count(['VISIBLE', 'HIDDEN', 'VISIBLE', 'SCHEDULED', 'ENDED']), 2);
});

test('a slide goes by its title in the viewer language, else the other one, else its image', () => {
  const base = { titleVi: 'Tết', titleEn: 'Tet', media };
  assert.equal(slideName(base, 'vi', '—'), 'Tết');
  assert.equal(slideName(base, 'en', '—'), 'Tet');
  assert.equal(slideName({ ...base, titleEn: null }, 'en', '—'), 'Tết');
  assert.equal(slideName({ titleVi: null, titleEn: null, media }, 'vi', '—'), 'tet.png');
});

test('rearranging one page replaces that page’s slice of the whole order', () => {
  const all = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(applyPageOrder(all, 1, 5, ['e', 'd', 'c', 'b', 'a']), ['e', 'd', 'c', 'b', 'a']);
  assert.deepEqual(applyPageOrder(all, 1, 2, ['b', 'a']), ['b', 'a', 'c', 'd', 'e']);
  assert.deepEqual(applyPageOrder(all, 2, 2, ['d', 'c']), ['a', 'b', 'd', 'c', 'e']);
  assert.deepEqual(applyPageOrder(all, 3, 2, ['e']), ['a', 'b', 'c', 'd', 'e']);
});

test('the list shows the optimistic order while a save runs, and keeps unknown slides at the end', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(inOrder(items, null), items);
  assert.deepEqual(
    inOrder(items, ['c', 'a', 'b']).map((item) => item.id),
    ['c', 'a', 'b'],
  );
  // A slide that arrived meanwhile is not lost; one that disappeared is not invented.
  assert.deepEqual(
    inOrder(items, ['b', 'gone', 'a']).map((item) => item.id),
    ['b', 'a', 'c'],
  );
});

test('the visible-limit refusal has a message in both languages', () => {
  const refused = new ApiError(409, 'SLIDE_LIMIT');
  assert.equal(slideLimitRefused(refused), true);
  assert.equal(slideLimitRefused(new ApiError(409, 'CONFLICT')), false);
  assert.equal(errorMessage(refused, vi), vi.errors.slideLimit);
  assert.equal(errorMessage(refused, en), en.errors.slideLimit);
});

test('Vietnamese and English slider texts have the same keys', () => {
  const keys = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
      : [prefix];
  for (const group of ['slides', 'website'] as const) {
    assert.deepEqual(keys(vi[group]).sort(), keys(en[group]).sort(), group);
  }
  assert.deepEqual(keys(vi.errors).sort(), keys(en.errors).sort());
  const publicKeys = (locale: 'vi' | 'en') =>
    Object.keys(getDictionary(locale))
      .filter((key) => key.startsWith('slider'))
      .sort();
  assert.deepEqual(publicKeys('vi'), publicKeys('en'));
  assert.equal(publicKeys('vi').length, 7);
  assert.ok(getDictionary('vi').sliderSlide.includes('{position}'));
  assert.ok(getDictionary('en').sliderSlide.includes('{count}'));
  assert.ok(getDictionary('en').sliderGoTo.includes('{position}'));
});

test('the website page keeps the tab in the address bar: media, popup or slider, anything else is media', () => {
  const state = (tab: string) => normalizeMediaList({ ...MEDIA_LIST_DEFAULTS, tab }).tab;
  assert.equal(state('slider'), 'slider');
  assert.equal(state('popup'), 'popup');
  assert.equal(state('media'), 'media');
  assert.equal(state('nope'), 'media');
});

test('the website page shows the slider tab to the website editor; the panel needs a loaded list', () => {
  const page = render(<MediaLibraryScreen />, employee([['MANAGE_WEBSITE_CONTENT']]), 'en');
  assert.ok(page.includes(en.website.slider), 'the third tab');
  const branchOnly = render(<MediaLibraryScreen />, employee([['MANAGE_WEBSITE_CONTENT', 'A']]));
  assert.ok(!branchOnly.includes(vi.website.slider));
  // The panel's first paint is the loading state, never an empty-list message that might be wrong.
  const panel = render(<SlidesPanel editing={null} onEditing={() => undefined} />, owner, 'en');
  assert.ok(panel.includes(en.common.loading));
  assert.ok(!panel.includes(en.slides.empty));
  // The drawer for a new slide opens on its own and shows the form.
  const adding = render(
    <SlidesPanel editing={{ id: null }} onEditing={() => undefined} />,
    owner,
    'en',
  );
  assert.ok(adding.includes(en.slides.createTitle));
  assert.ok(adding.includes(en.slides.form.titleVi) && adding.includes(en.slides.form.startsAt));
  assert.ok(adding.includes(en.slides.form.save));
});

test('the home page slider draws nothing at first paint: no slides, no change to the page', () => {
  assert.equal(renderToStaticMarkup(<HomeSlider locale="vi" />), '');
});
