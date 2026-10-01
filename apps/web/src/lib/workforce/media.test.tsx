import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaLibraryScreen } from '../../components/workforce/screens/media-library';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';
import { ApiError } from './api';
import {
  MEDIA_LIST_DEFAULTS,
  MEDIA_MAX_BYTES,
  mediaMeta,
  mediaVariantUrl,
  missingAlt,
  normalizeMediaList,
  precheckMediaFile,
  PrecheckError,
  trimmedAlt,
  uploadMedia,
  uploadReducer,
  type UploadItem,
} from './media';
import { navigationFor } from './permissions';
import { errorMessage } from './workflows';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

test('list state: search is bounded, page is a positive integer', () => {
  assert.deepEqual(normalizeMediaList({ q: 'x'.repeat(300), page: 3 }), {
    q: 'x'.repeat(100),
    page: 3,
  });
  assert.deepEqual(normalizeMediaList({ q: 'hero', page: 0 }), { q: 'hero', page: 1 });
  assert.deepEqual(normalizeMediaList({ q: '', page: Number.NaN }), MEDIA_LIST_DEFAULTS);
});

test('thumbnails come from the authenticated admin route; meta uses the locale separator', () => {
  assert.equal(mediaVariantUrl('abc', 'thumb'), '/api/v1/website/media/abc/thumb');
  assert.equal(mediaVariantUrl('abc', 'md'), '/api/v1/website/media/abc/md');
  assert.equal(
    mediaMeta({ bytes: 1_536_000, width: 1920, height: 800 }, ','),
    '1,5 MB · 1920 × 800',
  );
  assert.equal(
    mediaMeta({ bytes: 1_536_000, width: 1920, height: 800 }, '.'),
    '1.5 MB · 1920 × 800',
  );
});

test('alt text: Vietnamese is required before use, empty becomes null, whitespace collapses', () => {
  assert.equal(missingAlt({ altVi: null }), true);
  assert.equal(missingAlt({ altVi: '' }), true);
  assert.equal(missingAlt({ altVi: 'Phòng trị liệu' }), false);
  assert.equal(trimmedAlt('   '), null);
  assert.equal(trimmedAlt('  Phòng   trị liệu '), 'Phòng trị liệu');
});

test('the browser refuses what the server would: type and size', () => {
  assert.equal(precheckMediaFile({ type: 'image/png', size: 10 }), null);
  assert.equal(precheckMediaFile({ type: 'image/webp', size: MEDIA_MAX_BYTES }), null);
  assert.equal(precheckMediaFile({ type: 'image/png', size: MEDIA_MAX_BYTES + 1 }), 'size');
  for (const type of ['image/svg+xml', 'image/gif', 'application/pdf', '']) {
    assert.equal(precheckMediaFile({ type, size: 10 }), 'type', type);
  }
});

test('queue reducer: add, start, progress (clamped), finish, fail, dismiss, clear finished', () => {
  const item = (key: string, status: UploadItem['status'] = 'queued'): UploadItem => ({
    key,
    name: `${key}.png`,
    status,
    progress: null,
  });
  let state = uploadReducer([], {
    type: 'add',
    items: [item('a'), item('b'), item('c'), item('d')],
  });
  state = uploadReducer(state, { type: 'start', key: 'a' });
  state = uploadReducer(state, { type: 'progress', key: 'a', percent: 140 });
  assert.deepEqual([state[0]?.status, state[0]?.progress], ['uploading', 100]);
  state = uploadReducer(state, { type: 'finish', key: 'a', duplicate: false });
  state = uploadReducer(state, { type: 'finish', key: 'b', duplicate: true });
  state = uploadReducer(state, {
    type: 'fail',
    key: 'c',
    error: new ApiError(415, 'MEDIA_TYPE_UNSUPPORTED'),
  });
  assert.deepEqual(
    state.map((entry) => entry.status),
    ['done', 'duplicate', 'failed', 'queued'],
  );
  assert.ok(state[2]?.error instanceof ApiError);
  state = uploadReducer(state, { type: 'clear-finished' });
  assert.deepEqual(
    state.map((entry) => entry.key),
    ['d'],
    'only waiting and running items stay',
  );
  state = uploadReducer(state, { type: 'dismiss', key: 'd' });
  assert.deepEqual(state, []);
});

test('an upload is multipart with the file only; alt text is added in the detail drawer', async () => {
  const sent: { path: string; form: FormData }[] = [];
  const api = {
    upload: <T,>(path: string, form: FormData) => {
      sent.push({ path, form });
      return Promise.resolve({ asset: {}, duplicate: false } as T);
    },
  };
  const file = new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' });
  await uploadMedia(api, file);
  assert.equal(sent[0]?.path, '/api/v1/website/media');
  assert.deepEqual([...sent[0]!.form.keys()], ['file']);
  assert.equal((sent[0]!.form.get('file') as File).name, 'hero.png');
});

test('media errors read in plain Vietnamese and English, never raw codes', () => {
  const cases: [string, keyof typeof vi.errors][] = [
    ['MEDIA_TYPE_UNSUPPORTED', 'mediaType'],
    ['MEDIA_TOO_LARGE', 'mediaTooLarge'],
    ['HTTP_413', 'mediaTooLarge'],
    ['MEDIA_DIMENSIONS_TOO_LARGE', 'mediaDimensions'],
    ['MEDIA_INVALID_IMAGE', 'mediaInvalid'],
    ['MEDIA_IN_USE', 'mediaInUse'],
  ];
  for (const [code, key] of cases) {
    assert.equal(errorMessage(new ApiError(400, code), vi), vi.errors[key], code);
    assert.equal(errorMessage(new ApiError(400, code), en), en.errors[key], code);
  }
  assert.ok(new PrecheckError('size').problem === 'size');
});

test('the Website nav item and the media screen are GLOBAL MANAGE_WEBSITE_CONTENT only', () => {
  const item = navigationFor(employee([['MANAGE_WEBSITE_CONTENT']])).find(
    (entry) => entry.key === 'websiteContent',
  );
  assert.deepEqual([item?.group, item?.path], ['administration', '/website']);
  const branchOnly = render(<MediaLibraryScreen />, employee([['MANAGE_WEBSITE_CONTENT', 'A']]));
  assert.ok(branchOnly.includes(vi.media.noAccess));
  assert.ok(!branchOnly.includes(vi.media.upload));
  const editor = render(<MediaLibraryScreen />, employee([['MANAGE_WEBSITE_CONTENT']]), 'en');
  assert.ok(editor.includes(en.media.title));
  assert.ok(editor.includes(en.media.upload), 'the one page action');
  assert.ok(editor.includes(en.common.loading));
  assert.ok(render(<MediaLibraryScreen />, owner).includes(vi.media.upload));
});
