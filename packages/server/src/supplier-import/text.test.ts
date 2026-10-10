import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, decodeEntities, hashOf, htmlToPlainText, plainLine } from './text.js';

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
