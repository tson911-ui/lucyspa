import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalJson,
  decodeEntities,
  hashOf,
  htmlToPlainText,
  plainLine,
  stripSupplierReviewText,
} from './text.js';

// Claude integration CI-0: every heading and entry shape found in the real Haruohui descriptions (2026-10-11 scan), with invented names.
const FACTS = [
  'Công dụng',
  'Làm sạch da nhẹ nhàng.',
  'Dung tích: 100ml',
  'Hướng dẫn sử dụng',
  'Thoa đều lên mặt.',
];
const CLOSING = 'Sở hữu ngay sản phẩm này hôm nay.';
const block = (...lines: string[]) => [...FACTS, ...lines].join('\n');

test('review block: a heading with age and emoji entries is removed, the facts stay', () => {
  const input = block(
    'Đánh giá người dùng Việt Nam',
    '- Minh Thư (35 tuổi) 🌸: Chất kem rất đặc, thấm nhanh. Da mình căng mướt.',
    '- Ngọc Lan (42 tuổi) ✨: Mùi thơm dễ chịu, da mình bớt khô.',
    '- Hồng Hạnh (29 tuổi) 💖: Mua cả set dùng rất hời.',
  );
  const result = stripSupplierReviewText(input);
  assert.equal(result.text, FACTS.join('\n'));
  assert.equal(result.removed, 3);
  assert.equal(result.suspected, false);
});

test('review block: every heading and entry shape found in the real descriptions', () => {
  const shapes: string[][] = [
    [
      'Đánh giá',
      '-',
      '- Bạn Lan Hương 🌸: Đây là chân ái cho da khô của mình.',
      '- Chị Ngọc Mai 🎀: Mùi thơm quý phái.',
    ],
    [
      'Đánh giá giả lập người dùng',
      '- Hoàng Lan 👑: Kem mắt đỉnh nhất mình từng dùng.',
      '- Khánh Huyền 🌷: Mùi thơm thảo mộc rất sang.',
    ],
    [
      'Đánh giá từ khách hàng',
      '- Ngọc Lan ✨: Lớp nền rất mướt.',
      '- Phương Thảo 🌸: Da mình khô nhưng không bong tróc.',
    ],
    [
      'Đánh giá người dùng Việt Nam Tinh Chất Demo Essence',
      '- Thu Hoài (34 tuổi) 🌸: Tinh chất thấm nhanh.',
      '- Thanh Vân (41 tuổi) ✨: Da nhạy cảm phục hồi tốt.',
    ],
    [
      'Cảm nhận khách hàng',
      '- Ngọc Lan 🌸: Kem rất mịn, che được vết tàn nhang.',
      '- Phương Thảo 💎: Dùng rất thích.',
    ],
    [
      'Đánh giá từ người dùng Việt Nam',
      '-',
      '👩 Bảo Thanh (Hà Nội): “Tinh chất lỏng nhẹ, thấm siêu nhanh.”',
      '-',
      '👱 Thảo Vy (TP.HCM): “Dùng vô cùng hài lòng.”',
    ],
    [
      'Đánh giá từ người dùng',
      '☀️ Hồng Hạnh (29 tuổi, Hà Nội): Kem thoa lên nâng tông tự nhiên.',
      '🌸 Lan Anh (34 tuổi, TP.HCM): Chống nắng đỉnh lắm, da mình mờ thâm.',
    ],
    [
      'Đánh giá :',
      '- Mẹ Thanh Thủy (28 tuổi) 🌸: “Chai siêu to dùng tiết kiệm.”',
      '- Mẹ Minh Hà (32 tuổi) 🌿: “Hương thơm ngọt dịu.”',
    ],
  ];
  for (const shape of shapes) {
    const result = stripSupplierReviewText(block(...shape));
    assert.equal(result.text, FACTS.join('\n'), shape[0]);
    assert.equal(
      result.removed,
      shape.length - shape.filter((line) => line === '-').length - 1,
      shape[0],
    );
  }
});

test('review block: entries with no heading are removed when there are two or more unmistakable ones', () => {
  const input = block(
    '-',
    'Thanh Huyền (28 tuổi): 🌟 Em phấn nén này che khuyết điểm đỉnh thật sự, mình rất thích.',
    '-',
    'Minh Tú (34 tuổi): 💖 Mình bị nám hai bên má, dùng thấy mờ bớt.',
  );
  const result = stripSupplierReviewText(input);
  assert.equal(result.text, FACTS.join('\n'));
  assert.equal(result.removed, 2);
});

test('review block: a closing sales paragraph after the entries is kept', () => {
  const input = block(
    'Đánh giá người dùng Việt Nam',
    '- Minh Thư (35 tuổi) 🌸: Chất kem rất đặc, da mình căng mướt.',
    '- Ngọc Lan (42 tuổi) ✨: Mùi thơm dễ chịu.',
    CLOSING,
  );
  assert.equal(stripSupplierReviewText(input).text, [...FACTS, CLOSING].join('\n'));
});

test('review block: ordinary text is never touched', () => {
  const sentences = block(
    'Sản phẩm được đánh giá cao về mặt thiết kế.',
    'Đánh giá cao nhất của giới chuyên môn là độ dịu nhẹ, phù hợp da nhạy cảm.',
    'Cảm nhận sử dụng:',
    'Thành phần: Nước, Glycerin',
    '- Ferm Theriaca™: Công thức hỗ trợ làm dịu.',
    '- Cytosis®: Tinh chất lên men độc quyền.',
    '– Ban Ngày: Sữa rửa mặt ➔ Nước hoa hồng ➔ Kem dưỡng',
    '– Ban Đêm: Tẩy trang ➔ Sữa rửa mặt ➔ Tinh chất',
    'Dung tích: 50ml',
    'Kem Dưỡng Mắt: dùng buổi tối',
  );
  const result = stripSupplierReviewText(sentences);
  assert.equal(result.text, sentences);
  assert.equal(result.removed, 0);
  assert.equal(result.suspected, false);
});

test('review block: a review heading with no readable entries is kept and reported as suspected', () => {
  const input = block('Đánh giá', 'Nội dung đánh giá chưa rõ ràng của người bán');
  const result = stripSupplierReviewText(input);
  assert.equal(result.text, input);
  assert.equal(result.removed, 0);
  assert.equal(result.suspected, true);
});

test('review block: cleaning twice gives the same text, and empty or short input is safe', () => {
  const once = stripSupplierReviewText(
    block(
      'Đánh giá',
      '- Minh Thư (35 tuổi) 🌸: Da mình căng mướt.',
      '- Ngọc Lan (42 tuổi) ✨: Mùi thơm dễ chịu.',
    ),
  );
  const twice = stripSupplierReviewText(once.text);
  assert.equal(twice.text, once.text);
  assert.equal(twice.removed, 0);
  for (const input of ['', '-', 'Đánh giá', 'ok']) {
    assert.equal(stripSupplierReviewText(input).text, input);
  }
});

test('entities are decoded exactly once', () => {
  assert.equal(decodeEntities('A &amp; B &#8211; C &#x1F33F; &nbsp;D'), 'A & B – C 🌿  D');
  assert.equal(decodeEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
  assert.equal(decodeEntities('&unknown; &#0; &#1114112;'), '&unknown;  ');
});

test('names lose tags and control characters and keep their Vietnamese letters', () => {
  assert.equal(
    plainLine('  <b>Serum  Dưỡng&nbsp;Ẩm</b> &amp; Phục Hồi ​\u0007 '),
    'Serum Dưỡng Ẩm & Phục Hồi',
  );
  assert.equal(plainLine('x'.repeat(500), 300).length, 300);
});

test('descriptions become plain text: scripts, styles and comments are dropped, blocks become lines', () => {
  const html =
    '<style>.a{color:red}</style><h2>Công dụng</h2><p>Làm sạch&nbsp;da</p><script>alert(1)</script><ul><li>Dịu nhẹ</li><li>Không cồn</li></ul><!-- hidden --><br>Hết';
  assert.equal(
    htmlToPlainText(html),
    ['Công dụng', 'Làm sạch da', '- Dịu nhẹ', '- Không cồn', 'Hết'].join('\n'),
  );
  assert.doesNotMatch(htmlToPlainText(html), /alert|color|hidden|</);
});

test('text that only looks like tags after decoding stays text, never markup', () => {
  const text = htmlToPlainText('&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(text, '<img src=x onerror=alert(1)>');
});

test('canonical JSON and hashes do not depend on key order', () => {
  assert.equal(
    canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }),
    canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }),
  );
  assert.equal(hashOf({ a: 1, b: undefined }), hashOf({ a: 1 }));
  assert.notEqual(hashOf({ a: 1 }), hashOf({ a: 2 }));
  assert.match(hashOf('x'), /^[0-9a-f]{64}$/);
});
