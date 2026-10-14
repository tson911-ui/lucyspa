import type { ServiceResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contentChanges,
  contentDirty,
  contentOf,
  contentProblem,
  itemsOf,
  linesOf,
  pairsOf,
} from './service-content';

const saved = (patch: Partial<ServiceResponse> = {}): ServiceResponse =>
  ({
    id: 's',
    includedVi: ['Gội đầu', 'Massage'],
    includedEn: [],
    stepsVi: [],
    stepsEn: [],
    faqVi: [{ question: 'Có đau không?', answer: 'Không.' }],
    faqEn: [],
    photoMediaId: null,
    ...patch,
  }) as ServiceResponse;

test('one item per line: trimmed, blank lines dropped, round trip through the text box', () => {
  assert.deepEqual(itemsOf('  Gội đầu \r\n\n Massage  \n   '), ['Gội đầu', 'Massage']);
  assert.equal(linesOf(['a', 'b']), 'a\nb');
  assert.deepEqual(itemsOf(linesOf(['a', 'b'])), ['a', 'b']);
  assert.deepEqual(itemsOf(''), []);
});

test('pairs: blank rows vanish, spaces are trimmed', () => {
  assert.deepEqual(
    pairsOf([
      { question: ' Q ', answer: ' A ' },
      { question: ' ', answer: '' },
    ]),
    [{ question: 'Q', answer: 'A' }],
  );
});

test('the form starts equal to the saved content, so nothing is sent until something changes', () => {
  const service = saved();
  const form = contentOf(service);
  assert.equal(contentDirty(form, service), false);
  assert.deepEqual(contentChanges(form, service), {});
  assert.deepEqual(contentChanges({ ...form, includedVi: 'Gội đầu\nMassage\n\n' }, service), {});
});

test('only the changed fields are sent; clearing a field sends an empty list', () => {
  const service = saved();
  const form = contentOf(service);
  assert.deepEqual(
    contentChanges({ ...form, includedVi: 'Gội đầu', stepsEn: 'Rinse\nDry', faqVi: [] }, service),
    { includedVi: ['Gội đầu'], stepsEn: ['Rinse', 'Dry'], faqVi: [] },
  );
  assert.equal(contentDirty({ ...form, includedVi: '' }, service), true);
});

test('limits match the API: 12 items, 300 characters, 10 questions, a question needs its answer', () => {
  const form = contentOf(saved());
  assert.equal(contentProblem(form), null);
  const many = Array.from({ length: 13 }, (_, index) => `Mục ${index}`).join('\n');
  assert.equal(contentProblem({ ...form, stepsVi: many }), 'stepsVi');
  assert.equal(contentProblem({ ...form, includedEn: 'a'.repeat(301) }), 'includedEn');
  assert.equal(contentProblem({ ...form, includedEn: 'a'.repeat(300) }), null);
  assert.equal(
    contentProblem({ ...form, faqEn: [{ question: 'Chỉ có hỏi', answer: ' ' }] }),
    'faqEn',
  );
  assert.equal(
    contentProblem({
      ...form,
      faqVi: Array.from({ length: 11 }, () => ({ question: 'Q', answer: 'A' })),
    }),
    'faqVi',
  );
  // A blank row is simply dropped, not a problem.
  assert.equal(contentProblem({ ...form, faqEn: [{ question: '', answer: '' }] }), null);
});
