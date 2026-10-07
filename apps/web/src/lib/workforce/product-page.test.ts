import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProductPublicPageCopy } from '@lucy-spa/contracts';
import {
  copyOfDraft,
  draftFromPage,
  nextLineKey,
  pageChanged,
  pageProblem,
  pageRequest,
} from './product-page';

const EMPTY: ProductPublicPageCopy = {
  heroMediaId: null,
  heroTitleVi: null,
  heroTitleEn: null,
  heroTextVi: null,
  heroTextEn: null,
  commitmentTitleVi: null,
  commitmentTitleEn: null,
  commitmentItems: [],
};

test('an empty copy is a valid draft and saves as all-empty (the public blocks stay hidden)', () => {
  const draft = draftFromPage(EMPTY);
  assert.equal(pageProblem(draft), null);
  assert.deepEqual(copyOfDraft(draft), EMPTY);
  assert.equal(pageChanged(draft, draftFromPage(EMPTY)), false);
});

test('a text block needs both languages or none; blanks count as none', () => {
  const draft = draftFromPage(EMPTY);
  assert.equal(pageProblem({ ...draft, heroTitleVi: 'Chăm da' }), 'heroTitle');
  assert.equal(pageProblem({ ...draft, heroTitleVi: 'Chăm da', heroTitleEn: 'Skin care' }), null);
  assert.equal(pageProblem({ ...draft, heroTitleVi: '   ' }), null);
  assert.equal(pageProblem({ ...draft, heroTextEn: 'Only English' }), 'heroText');
  assert.equal(pageProblem({ ...draft, commitmentTitleEn: 'Promise' }), 'commitmentTitle');
});

test('commitment lines: both languages each, at most six, and the length limits', () => {
  const draft = draftFromPage(EMPTY);
  const line = (key: number, textVi: string, textEn: string) => ({ key, textVi, textEn });
  assert.equal(pageProblem({ ...draft, lines: [line(0, 'Giá rõ ràng', '')] }), 'lines');
  assert.equal(pageProblem({ ...draft, lines: [line(0, 'Giá rõ ràng', 'Clear prices')] }), null);
  const seven = Array.from({ length: 7 }, (_, key) => line(key, 'a', 'a'));
  assert.equal(pageProblem({ ...draft, lines: seven }), 'lines');
  assert.equal(pageProblem({ ...draft, lines: seven.slice(0, 6) }), null);
  assert.equal(
    pageProblem({ ...draft, heroTitleVi: 'x'.repeat(121), heroTitleEn: 'y' }),
    'tooLong',
  );
  assert.equal(pageProblem({ ...draft, lines: [line(0, 'x'.repeat(121), 'y')] }), 'tooLong');
});

test('the request carries the whole copy, trimmed, with blanks as null; a wrong draft makes none', () => {
  const draft = {
    ...draftFromPage(EMPTY),
    mediaId: 'a1',
    heroTitleVi: '  Chăm da ',
    heroTitleEn: 'Skin care',
    lines: [{ key: 4, textVi: ' Giá rõ ràng ', textEn: 'Clear prices ' }],
  };
  assert.deepEqual(pageRequest(draft, 7), {
    expectedRowVersion: 7,
    publicPage: {
      ...EMPTY,
      heroMediaId: 'a1',
      heroTitleVi: 'Chăm da',
      heroTitleEn: 'Skin care',
      commitmentItems: [{ textVi: 'Giá rõ ràng', textEn: 'Clear prices' }],
    },
  });
  assert.equal(pageRequest({ ...draft, heroTitleEn: '' }, 7), null);
  assert.equal(pageChanged(draft, draftFromPage(EMPTY)), true);
  assert.equal(nextLineKey(draft.lines), 5);
  assert.equal(nextLineKey([]), 0);
});
