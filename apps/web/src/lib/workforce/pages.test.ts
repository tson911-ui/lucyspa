import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WEBSITE_PAGE_LIMITS } from '@lucy-spa/contracts';
import { ApiError } from '../api/client';
import {
  applyFormat,
  emptyPageForm,
  formOfPage,
  pageFormChanged,
  pageInputOf,
  pageIssue,
  pagePublicPath,
  roleHolderId,
  serverPageIssue,
  type FormatKind,
  type PageForm,
} from './pages';
import { normalizeMediaList, MEDIA_LIST_DEFAULTS } from './media';

const good = (patch: Partial<PageForm> = {}): PageForm => ({
  ...emptyPageForm(),
  slug: 'chinh-sach-bao-mat',
  role: 'PRIVACY',
  titleVi: 'Chính sách bảo mật',
  bodyVi: '## Dữ liệu\n\nChúng tôi giữ dữ liệu an toàn.',
  ...patch,
});

test('a new page is an unpublished information page; a saved page fills the form and "changed" sees any edit', () => {
  const blank = emptyPageForm();
  assert.equal(blank.isPublished, false);
  assert.equal(blank.role, 'INFO');
  const form = formOfPage({
    id: 'x',
    slug: 'gioi-thieu',
    role: 'INFO',
    titleVi: 'Giới thiệu',
    titleEn: null,
    bodyVi: 'Nội dung',
    bodyEn: null,
    seoTitleVi: null,
    seoTitleEn: null,
    seoDescriptionVi: 'Mô tả',
    seoDescriptionEn: null,
    isPublished: true,
    version: 3,
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
  });
  assert.deepEqual([form.titleEn, form.seoDescriptionVi, form.isPublished], ['', 'Mô tả', true]);
  assert.equal(pageFormChanged(form, { ...form }), false);
  assert.equal(pageFormChanged({ ...form, bodyEn: ' ' }, form), true);
});

test('the first problem is reported in the order the form is read, with its line for the text', () => {
  assert.equal(pageIssue(good()), null);
  assert.deepEqual(pageIssue(good({ slug: ' ' })), { field: 'slug', kind: 'slugRequired' });
  assert.deepEqual(pageIssue(good({ slug: 'Có Dấu' })), { field: 'slug', kind: 'slugFormat' });
  assert.deepEqual(pageIssue(good({ slug: 'services' })), { field: 'slug', kind: 'slugReserved' });
  // The address is read as the server reads it: trimmed and lowercased.
  assert.equal(pageIssue(good({ slug: '  Chinh-Sach  ' })), null);
  assert.deepEqual(pageIssue(good({ titleVi: '  ' })), { field: 'titleVi', kind: 'titleRequired' });
  assert.deepEqual(pageIssue(good({ titleVi: 'x'.repeat(121) })), {
    field: 'titleVi',
    kind: 'titleTooLong',
  });
  assert.deepEqual(pageIssue(good({ titleEn: 'x'.repeat(121) })), {
    field: 'titleEn',
    kind: 'titleTooLong',
  });
  assert.deepEqual(pageIssue(good({ bodyVi: '' })), { field: 'bodyVi', kind: 'empty', line: 1 });
  assert.deepEqual(pageIssue(good({ bodyVi: 'Một\n\nCó <b>đậm</b>' })), {
    field: 'bodyVi',
    kind: 'html',
    line: 3,
  });
  assert.deepEqual(pageIssue(good({ bodyVi: '[x](javascript:alert(1))' })), {
    field: 'bodyVi',
    kind: 'link',
    line: 1,
  });
  // English text is optional, but when it is there it follows the same rules.
  assert.equal(pageIssue(good({ bodyEn: '   ' })), null);
  assert.deepEqual(pageIssue(good({ bodyEn: '# Big' })), {
    field: 'bodyEn',
    kind: 'headingLevel',
    line: 1,
  });
  assert.deepEqual(pageIssue(good({ seoTitleEn: 'x'.repeat(WEBSITE_PAGE_LIMITS.seoTitle + 1) })), {
    field: 'seoTitleEn',
    kind: 'seoTitleTooLong',
  });
  assert.deepEqual(
    pageIssue(good({ seoDescriptionVi: 'x'.repeat(WEBSITE_PAGE_LIMITS.seoDescription + 1) })),
    { field: 'seoDescriptionVi', kind: 'seoDescriptionTooLong' },
  );
});

test('the request: trimmed, lowercased address, empty optional fields as null, the text as written', () => {
  const request = pageInputOf(
    good({
      slug: ' Bao-Mat ',
      titleEn: '  ',
      bodyEn: '  ',
      seoTitleVi: ' Tiêu đề ',
      isPublished: true,
    }),
  );
  assert.ok('body' in request);
  assert.deepEqual(request.body, {
    slug: 'bao-mat',
    role: 'PRIVACY',
    titleVi: 'Chính sách bảo mật',
    titleEn: null,
    bodyVi: '## Dữ liệu\n\nChúng tôi giữ dữ liệu an toàn.',
    bodyEn: null,
    seoTitleVi: 'Tiêu đề',
    seoTitleEn: null,
    seoDescriptionVi: null,
    seoDescriptionEn: null,
    isPublished: true,
  });
  const refused = pageInputOf(good({ slug: '' }));
  assert.ok('issue' in refused);
});

test('what the API refuses becomes an issue on a field; a held role names the page that holds it', () => {
  assert.deepEqual(serverPageIssue(new ApiError(409, 'CONFLICT', 'slug')), {
    field: 'slug',
    kind: 'slugTaken',
  });
  const holder = '7b0f1a06-3f0e-4c1c-9a0b-2f2c2a9b7d11';
  assert.deepEqual(serverPageIssue(new ApiError(409, 'PAGE_ROLE_TAKEN', holder)), {
    field: 'role',
    kind: 'roleTaken',
    other: holder,
  });
  assert.equal(roleHolderId(new ApiError(409, 'PAGE_ROLE_TAKEN', holder)), holder);
  assert.equal(roleHolderId(new ApiError(409, 'CONFLICT')), null);
  assert.equal(roleHolderId(new Error('x')), null);
  assert.equal(serverPageIssue(new ApiError(400, 'VALIDATION_FAILED', 'bodyVi'))?.field, 'bodyVi');
  assert.equal(serverPageIssue(new ApiError(400, 'VALIDATION_FAILED', 'expectedVersion')), null);
  assert.equal(serverPageIssue(new ApiError(500, 'HTTP_500')), null);
  assert.equal(pagePublicPath('vi', 'chinh-sach'), '/vi/chinh-sach');
});

const words = { bold: 'chữ đậm', italic: 'chữ nghiêng', link: 'chữ liên kết' };
const apply = (value: string, start: number, end: number, kind: FormatKind) =>
  applyFormat(value, start, end, kind, words);

test('bold and italic wrap the selected words, or put in a placeholder that is selected', () => {
  assert.deepEqual(apply('Xin chào bạn', 4, 8, 'bold'), {
    value: 'Xin **chào** bạn',
    start: 6,
    end: 10,
  });
  assert.deepEqual(apply('Xin chào bạn', 4, 8, 'italic'), {
    value: 'Xin *chào* bạn',
    start: 5,
    end: 9,
  });
  const empty = apply('Xin ', 4, 4, 'bold');
  assert.equal(empty.value, 'Xin **chữ đậm**');
  assert.equal(empty.value.slice(empty.start, empty.end), 'chữ đậm');
});

test('a link wraps the selection and selects the address to type over', () => {
  const linked = apply('Xem dịch vụ nhé', 4, 11, 'link');
  assert.equal(linked.value, 'Xem [dịch vụ](https://) nhé');
  assert.equal(linked.value.slice(linked.start, linked.end), 'https://');
  const bare = apply('', 0, 0, 'link');
  assert.equal(bare.value, '[chữ liên kết](https://)');
  assert.equal(bare.value.slice(bare.start, bare.end), 'https://');
});

test('headings and lists work on whole lines, replace each other, and the same button takes the mark off', () => {
  const text = 'Một dòng\nHai dòng\n\nBa dòng';
  // A caret anywhere in a line formats that line.
  assert.equal(apply(text, 3, 3, 'h2').value, '## Một dòng\nHai dòng\n\nBa dòng');
  // A selection over two lines formats both; the blank line stays blank.
  const list = apply(text, 2, 14, 'ul');
  assert.equal(list.value, '- Một dòng\n- Hai dòng\n\nBa dòng');
  assert.equal(apply(text, 2, 14, 'ol').value, '1. Một dòng\n2. Hai dòng\n\nBa dòng');
  // Another kind replaces the old mark; the same kind removes it.
  assert.equal(apply('## Tiêu đề', 0, 0, 'h3').value, '### Tiêu đề');
  assert.equal(apply('### Tiêu đề', 0, 0, 'h3').value, 'Tiêu đề');
  assert.equal(apply('- a\n- b', 0, 7, 'ul').value, 'a\nb');
  assert.equal(apply('- a\n- b', 0, 7, 'ol').value, '1. a\n2. b');
  // A "###" line is not an "##" line.
  assert.equal(apply('### X', 0, 0, 'h2').value, '## X');
  // The selection after the change covers the lines it changed.
  assert.equal(list.value.slice(list.start, list.end), '- Một dòng\n- Hai dòng');
  // Out-of-range selections are clamped, never a crash.
  assert.equal(apply('abc', 50, 99, 'bold').value.startsWith('abc**'), true);
});

test('the website tabs know the pages tab (it survives a reload of the address)', () => {
  assert.equal(normalizeMediaList({ ...MEDIA_LIST_DEFAULTS, tab: 'pages' }).tab, 'pages');
  assert.equal(normalizeMediaList({ ...MEDIA_LIST_DEFAULTS, tab: 'unknown' }).tab, 'media');
});
