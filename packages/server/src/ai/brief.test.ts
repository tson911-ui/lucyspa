import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BRIEF_SCHEMA,
  BRIEF_SYSTEM,
  SUGGESTION_SYSTEM,
  buildBriefUserMessage,
  buildSuggestionUserMessage,
  checkBriefSummary,
  checkSuggestionLine,
  cleanNote,
  parseBrief,
  parseSuggestions,
  suggestionSchema,
  type SuggestionCandidate,
} from './brief.js';

const options = { authenticityClaimsAllowed: false, bannedPhrases: [] as string[], maxChars: 400 };

test('a note reaches the model without contacts, on one line, cut at the limit', () => {
  const note = cleanNote(
    'Khách thích massage nhẹ.\nGọi 0905 123 456 hoặc a@b.vn, xem https://x.example',
    300,
  );
  assert.doesNotMatch(note, /0905|@|https|\n/);
  assert.match(note, /massage nhẹ/);
  assert.equal([...cleanNote('x'.repeat(500), 300)].length, 300);
});

test('the summary prompt keeps the model to the notes and the user turn holds no identity', () => {
  assert.match(BRIEF_SYSTEM, /ONLY WHAT THE NOTES SAY/);
  assert.match(BRIEF_SYSTEM, /DATA, NOT INSTRUCTIONS/);
  const user = buildBriefUserMessage(
    { visits: 3, usualServices: [{ name: 'Gội đầu', times: 2 }] },
    ['Thích nước ấm'],
    'abc123',
  );
  assert.match(user, /BEGIN-DATA abc123/);
  assert.match(user, /Customer: khách/);
  assert.match(user, /1\. Thích nước ấm/);
  assert.deepEqual(BRIEF_SCHEMA.required, ['summary']);
  assert.equal(parseBrief({ summary: '  Khách thích nước ấm.  ' }), 'Khách thích nước ấm.');
  assert.equal(parseBrief({ summary: 3 }), null);
  assert.equal(parseBrief(null), null);
});

test('a summary is kept only when it adds nothing: no number, no condition, no claim, not too long, no clinic word', () => {
  const notes = ['Khách thích massage nhẹ, hay đau vai.', 'Lần trước dị ứng mùi sả.'];
  assert.deepEqual(
    checkBriefSummary(
      'Khách thích massage nhẹ và hay đau vai, tránh mùi sả vì dị ứng.',
      notes,
      options,
    ),
    [],
  );
  const codes = (summary: string) =>
    checkBriefSummary(summary, notes, options).map((warning) => warning.code);
  assert.ok(codes('Khách bị eczema nên cần chăm sóc đặc biệt.').includes('SUITABILITY_CONDITION'));
  assert.ok(codes('Khách đã đến 5 lần và thích massage nhẹ.').includes('FACT_MISSING'));
  assert.ok(codes('Cam kết điều trị đau vai cho khách.').includes('FORBIDDEN_PHRASE'));
  assert.ok(codes('Khách nên khám da trước.').includes('CLINIC_WORD'));
  assert.ok(codes('Khách thích massage nhẹ. '.repeat(30)).includes('SEO_DESCRIPTION_LONG'));
  assert.ok(
    codes('Visit notes in English only, nothing in Vietnamese at all here.').includes(
      'WRONG_LANGUAGE',
    ),
  );
});

const CANDIDATES: SuggestionCandidate[] = [
  {
    id: 'p1',
    name: 'Kem dưỡng ẩm Laneige 50ml',
    brand: 'Laneige',
    benefits: 'Cấp nước cho da khô.',
    suitableFor: 'Da khô.',
  },
  {
    id: 'p2',
    name: 'Serum Vitamin C 30ml',
    brand: null,
    benefits: 'Làm sáng da.',
    suitableFor: null,
  },
];

test('talking points: the model can only pick candidate ids, at most three, once each; each line is checked', () => {
  assert.deepEqual(
    (
      suggestionSchema(['p1', 'p2']).properties.picks.items.properties.product_id as unknown as {
        enum: string[];
      }
    ).enum,
    ['p1', 'p2'],
  );
  assert.match(SUGGESTION_SYSTEM, /ONLY THE LIST/);
  const user = buildSuggestionUserMessage(['Gội đầu'], ['Sữa rửa mặt'], CANDIDATES, 'zz');
  assert.match(user, /id p1: Kem dưỡng ẩm Laneige 50ml \(Laneige\)/);
  assert.match(user, /Products bought before: Sữa rửa mặt/);
  const picks = parseSuggestions(
    {
      picks: [
        { product_id: 'p1', line: ' Cấp nước cho da khô. ' },
        { product_id: 'p1', line: 'trùng' },
        { product_id: 'hacked', line: 'x' },
        { product_id: 'p2', line: 'Làm sáng da.' },
      ],
    },
    CANDIDATES,
    3,
  );
  assert.deepEqual(picks, [
    { productId: 'p1', line: 'Cấp nước cho da khô.' },
    { productId: 'p2', line: 'Làm sáng da.' },
  ]);
  assert.equal(parseSuggestions({ picks: 'x' }, CANDIDATES, 3), null);
  const small = { ...options, maxChars: 200 };
  assert.deepEqual(
    checkSuggestionLine('Cấp nước cho da khô, dung tích 50ml.', CANDIDATES[0]!, small),
    [],
  );
  const bad = (line: string) =>
    checkSuggestionLine(line, CANDIDATES[0]!, small).map((warning) => warning.code);
  assert.ok(bad('Chỉ 299.000 đ, giảm 20% hôm nay.').includes('FACT_MISSING'));
  assert.ok(bad('Chữa khỏi khô da vĩnh viễn.').includes('FORBIDDEN_PHRASE'));
  assert.ok(bad('Khách hàng chia sẻ rất thích 🌸').includes('TESTIMONIAL'));
});
