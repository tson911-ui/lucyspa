import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import {
  contentChanges,
  contentData,
  parseContentPatch,
  readContent,
  readFaqList,
  readTextList,
  sameJson,
  serviceFaqList,
  serviceTextList,
  storedList,
} from './service-content.js';

const refuses = (work: () => unknown, field: string) =>
  assert.throws(
    work,
    (error: unknown) =>
      error instanceof AuthError && error.code === 'VALIDATION_FAILED' && error.field === field,
  );

test('text lists are trimmed, blank items dropped, order kept', () => {
  assert.deepEqual(serviceTextList(['  Gội đầu  ', '', '   ', 'Massage'], 'includedVi'), [
    'Gội đầu',
    'Massage',
  ]);
  assert.deepEqual(serviceTextList([], 'stepsVi'), []);
});

test('text lists refuse non-lists, non-text items, control characters, and too many or too long items', () => {
  refuses(() => serviceTextList('x', 'includedVi'), 'includedVi');
  refuses(() => serviceTextList([1], 'includedVi'), 'includedVi');
  refuses(() => serviceTextList(['a\nb'], 'stepsEn'), 'stepsEn');
  refuses(() => serviceTextList(['a'.repeat(301)], 'stepsEn'), 'stepsEn');
  assert.equal(serviceTextList(['a'.repeat(300)], 'stepsEn').length, 1);
  refuses(
    () =>
      serviceTextList(
        Array.from({ length: 13 }, (_, i) => `item ${i}`),
        'stepsVi',
      ),
    'stepsVi',
  );
  assert.equal(
    serviceTextList(
      Array.from({ length: 12 }, (_, i) => `item ${i}`),
      'stepsVi',
    ).length,
    12,
  );
  // Blank items do not count against the limit.
  assert.equal(
    serviceTextList([...Array.from({ length: 12 }, (_, i) => `item ${i}`), '', ' '], 'stepsVi')
      .length,
    12,
  );
});

test('FAQ pairs: both sides are needed, a fully blank pair is dropped, extra keys are refused', () => {
  assert.deepEqual(
    serviceFaqList(
      [
        { question: ' Có đau không? ', answer: ' Không. ' },
        { question: ' ', answer: '' },
      ],
      'faqVi',
    ),
    [{ question: 'Có đau không?', answer: 'Không.' }],
  );
  refuses(() => serviceFaqList([{ question: 'Q', answer: ' ' }], 'faqVi'), 'faqVi');
  refuses(() => serviceFaqList([{ question: ' ', answer: 'A' }], 'faqVi'), 'faqVi');
  refuses(() => serviceFaqList([{ question: 'Q', answer: 'A', extra: 1 }], 'faqEn'), 'faqEn');
  refuses(() => serviceFaqList(['Q'], 'faqEn'), 'faqEn');
  refuses(() => serviceFaqList([{ question: 'Q'.repeat(201), answer: 'A' }], 'faqEn'), 'faqEn');
  refuses(() => serviceFaqList([{ question: 'Q', answer: 'A'.repeat(1_001) }], 'faqEn'), 'faqEn');
  refuses(
    () =>
      serviceFaqList(
        Array.from({ length: 11 }, () => ({ question: 'Q', answer: 'A' })),
        'faqVi',
      ),
    'faqVi',
  );
});

test('an empty list is stored as SQL NULL and read back as an empty list', () => {
  assert.equal(storedList([]), Prisma.DbNull);
  assert.deepEqual(storedList(['a']), ['a']);
  assert.deepEqual(readTextList(null), []);
  assert.deepEqual(readFaqList(null), []);
  assert.deepEqual(readTextList(['a', 3, ' '] as Prisma.JsonValue), ['a']);
  assert.deepEqual(
    readFaqList([{ question: 'Q', answer: 'A' }, { question: 'Q' }, 'x'] as Prisma.JsonValue),
    [{ question: 'Q', answer: 'A' }],
  );
});

test('parseContentPatch only carries the fields that were sent', () => {
  assert.deepEqual(parseContentPatch({}), {});
  assert.deepEqual(parseContentPatch({ includedEn: ['Towel', ''], faqVi: [] }), {
    includedEn: ['Towel'],
    faqVi: [],
  });
  refuses(() => parseContentPatch({ stepsVi: 'one' }), 'stepsVi');
});

test('contentChanges compares by value, so saving the same content changes nothing', () => {
  const row = {
    includedVi: ['A', 'B'],
    includedEn: null,
    stepsVi: null,
    stepsEn: null,
    faqVi: [{ question: 'Q', answer: 'A' }],
    faqEn: null,
  };
  assert.deepEqual(
    contentChanges(row, {
      includedVi: ['A', 'B'],
      includedEn: [],
      faqVi: [{ question: 'Q', answer: 'A' }],
    }),
    {},
  );
  assert.deepEqual(contentChanges(row, { includedVi: ['A'], faqVi: [], stepsEn: ['1'] }), {
    includedVi: ['A'],
    faqVi: [],
    stepsEn: ['1'],
  });
  assert.deepEqual(readContent(row).includedEn, []);
  const data = contentData({ faqVi: [], stepsEn: ['1'] });
  assert.equal(data.faqVi, Prisma.DbNull);
  assert.deepEqual(data.stepsEn, ['1']);
  assert.equal(sameJson(undefined, null), true);
});
