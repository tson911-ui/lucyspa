import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../auth/auth.error.js';
import {
  parseFacts,
  parseFeaturedGroups,
  parseWhyCards,
  publicFacts,
  publicFeaturedGroups,
  publicWhy,
  readFacts,
  readWhyCards,
} from './shop-info.lists.js';

const builtIn = (id: string, kind: string, visible = true) => ({
  id,
  kind,
  visible,
  icon: null,
  textVi: null,
  textEn: null,
});
const custom = (patch: object = {}) => ({
  id: '8f6f2a4e-5b0c-4a53-9f4e-2f9a4a1c7d10',
  kind: 'CUSTOM',
  visible: true,
  icon: 'sparkles',
  textVi: 'Miễn phí gửi xe',
  textEn: 'Free parking',
  ...patch,
});
const refused = (action: () => unknown, field: string) =>
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof AuthError && error.code === 'VALIDATION_FAILED' && error.field === field,
  );

test('facts: the three built-in items always exist, in the Owner order, and can only be hidden', () => {
  // Empty (the column default) = the three built-ins, visible.
  assert.deepEqual(
    readFacts([]).map((fact) => [fact.id, fact.visible]),
    [
      ['hours', true],
      ['address', true],
      ['hotline', true],
    ],
  );
  const parsed = parseFacts([
    builtIn('hotline', 'HOTLINE'),
    custom(),
    builtIn('hours', 'HOURS', false),
  ]);
  // A built-in the request leaves out comes back (visible) at the end; the order given is kept.
  assert.deepEqual(
    parsed.map((fact) => [fact.id.slice(0, 5), fact.visible]),
    [
      ['hotli', true],
      ['8f6f2', true],
      ['hours', false],
      ['addre', true],
    ],
  );
});

test('facts: custom items need an icon from the list and both languages; everything else is refused by name', () => {
  refused(() => parseFacts('x'), 'facts');
  refused(() => parseFacts([custom({ icon: 'skull' })]), 'facts');
  refused(() => parseFacts([custom({ icon: null })]), 'facts');
  refused(() => parseFacts([custom({ textEn: null })]), 'facts');
  refused(() => parseFacts([custom({ textVi: '   ' })]), 'facts');
  refused(() => parseFacts([custom({ textVi: 'x'.repeat(81) })]), 'facts');
  refused(() => parseFacts([custom({ id: 'not-a-uuid' })]), 'facts');
  refused(() => parseFacts([custom(), custom()]), 'facts');
  refused(() => parseFacts([builtIn('hours', 'HOURS'), builtIn('hours', 'HOURS')]), 'facts');
  refused(() => parseFacts([builtIn('address', 'HOURS')]), 'facts');
  refused(() => parseFacts([{ ...builtIn('hours', 'HOURS'), visible: 'yes' }]), 'facts');
  refused(() => parseFacts([{ ...custom(), kind: 'OTHER' }]), 'facts');
  refused(
    () => parseFacts(Array.from({ length: 17 }, (_, index) => custom({ id: `${index}` }))),
    'facts',
  );
  // Whitespace is normalized; stored text is what the visitor sees.
  assert.equal(
    parseFacts([custom({ textVi: '  Miễn   phí   gửi xe ' })])[0]?.textVi,
    'Miễn phí gửi xe',
  );
});

test('facts: stored data is read tolerantly, a bad entry is dropped and the built-ins stay', () => {
  const read = readFacts([{ nonsense: true }, custom({ icon: 'skull' }), custom()]);
  assert.deepEqual(
    read.map((fact) => fact.kind),
    ['CUSTOM', 'HOURS', 'ADDRESS', 'HOTLINE'],
  );
  assert.deepEqual(readFacts('garbage').length, 3);
});

test('public facts: hidden strip is empty, hidden items are left out, custom text is the visitor language only', () => {
  const facts = parseFacts([
    builtIn('hours', 'HOURS', false),
    custom(),
    builtIn('address', 'ADDRESS'),
    builtIn('hotline', 'HOTLINE'),
  ]);
  assert.deepEqual(publicFacts(false, facts, 'vi'), []);
  assert.deepEqual(publicFacts(true, facts, 'vi'), [
    { kind: 'CUSTOM', icon: 'sparkles', text: 'Miễn phí gửi xe' },
    { kind: 'ADDRESS', icon: 'map-pin', text: null },
    { kind: 'HOTLINE', icon: 'phone', text: null },
  ]);
  assert.equal(publicFacts(true, facts, 'en')[0]?.text, 'Free parking');
});

test('featured groups: strict request, unique codes, optional descriptions, 120 characters', () => {
  assert.deepEqual(parseFeaturedGroups([]), []);
  assert.deepEqual(
    parseFeaturedGroups([
      { code: 'NAIL', descriptionVi: ' Móng  gọn gàng ', descriptionEn: '' },
      { code: 'MASSAGE', descriptionVi: null, descriptionEn: 'Relax' },
    ]),
    [
      { code: 'NAIL', descriptionVi: 'Móng gọn gàng', descriptionEn: null },
      { code: 'MASSAGE', descriptionVi: null, descriptionEn: 'Relax' },
    ],
  );
  refused(() => parseFeaturedGroups(null), 'featuredGroups');
  refused(() => parseFeaturedGroups([{ code: 'bad code!' }]), 'featuredGroups');
  refused(() => parseFeaturedGroups([{ code: 'A' }, { code: 'A' }]), 'featuredGroups');
  refused(
    () => parseFeaturedGroups([{ code: 'A', descriptionVi: 'x'.repeat(121) }]),
    'featuredGroups',
  );
  refused(
    () => parseFeaturedGroups(Array.from({ length: 13 }, (_, index) => ({ code: `G${index}` }))),
    'featuredGroups',
  );
});

test('public featured groups: only live groups, in the Owner order, never the other language description', () => {
  const groups = parseFeaturedGroups([
    { code: 'MASSAGE', descriptionVi: 'Thư giãn', descriptionEn: null },
    { code: 'GONE', descriptionVi: 'x', descriptionEn: 'x' },
    { code: 'NAIL', descriptionVi: null, descriptionEn: 'Tidy nails' },
  ]);
  const live = new Set(['NAIL', 'MASSAGE']);
  assert.deepEqual(publicFeaturedGroups(groups, live, 'vi'), [
    { code: 'MASSAGE', description: 'Thư giãn' },
    { code: 'NAIL', description: null },
  ]);
  assert.deepEqual(publicFeaturedGroups(groups, live, 'en'), [
    { code: 'MASSAGE', description: null },
    { code: 'NAIL', description: 'Tidy nails' },
  ]);
});

const card = (patch: object = {}) => ({
  id: '3b1d6c0a-7a5e-4e55-8a0b-0c4b0b6b9a11',
  icon: 'leaf',
  headingVi: 'Dụng cụ sạch',
  headingEn: 'Clean tools',
  descriptionVi: 'Mỗi khách một bộ dụng cụ.',
  descriptionEn: 'One set of tools per guest.',
  ...patch,
});

test('why cards: strict request, an icon from the set, every text in both languages, unique ids', () => {
  assert.deepEqual(parseWhyCards([]), []);
  assert.equal(
    parseWhyCards([card({ headingVi: '  Dụng   cụ  sạch ' })])[0]?.headingVi,
    'Dụng cụ sạch',
  );
  refused(() => parseWhyCards('x'), 'whyCards');
  refused(() => parseWhyCards([card({ icon: 'skull' })]), 'whyCards');
  refused(() => parseWhyCards([card({ headingEn: null })]), 'whyCards');
  refused(() => parseWhyCards([card({ descriptionVi: ' ' })]), 'whyCards');
  refused(() => parseWhyCards([card({ headingVi: 'x'.repeat(61) })]), 'whyCards');
  refused(() => parseWhyCards([card({ descriptionEn: 'x'.repeat(201) })]), 'whyCards');
  refused(() => parseWhyCards([card({ id: 'nope' })]), 'whyCards');
  refused(() => parseWhyCards([card(), card()]), 'whyCards');
  refused(
    () =>
      parseWhyCards(
        Array.from({ length: 13 }, (_, index) =>
          card({ id: `3b1d6c0a-7a5e-4e55-8a0b-0c4b0b6b9a${String(index).padStart(2, '0')}` }),
        ),
      ),
    'whyCards',
  );
  // Stored data is read tolerantly.
  assert.deepEqual(readWhyCards('garbage'), []);
  assert.equal(readWhyCards([{ nope: 1 }, card()]).length, 1);
});

test('public why: nothing while hidden, without a title or without cards; otherwise the visitor language only', () => {
  const cards = parseWhyCards([card()]);
  assert.equal(publicWhy(false, 'Vì sao', 'Why', cards, 'vi'), null);
  assert.equal(publicWhy(true, null, 'Why', cards, 'vi'), null);
  assert.equal(publicWhy(true, 'Vì sao', 'Why', [], 'vi'), null);
  assert.deepEqual(publicWhy(true, 'Vì sao', 'Why', cards, 'en'), {
    title: 'Why',
    cards: [{ icon: 'leaf', heading: 'Clean tools', description: 'One set of tools per guest.' }],
  });
  assert.equal(publicWhy(true, 'Vì sao', 'Why', cards, 'vi')?.cards[0]?.heading, 'Dụng cụ sạch');
});
