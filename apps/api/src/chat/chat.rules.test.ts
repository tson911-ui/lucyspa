import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bookingUrl,
  cleanMessage,
  cleanReply,
  CircuitBreaker,
  isSessionId,
  optionalText,
  parseBotBooking,
  secondsToShopMidnight,
  shopDay,
} from './chat.rules.js';

test('a visitor message is cleaned, never cut: control and invisible characters go, long or empty is refused', () => {
  assert.equal(cleanMessage('  Giá   gội đầu \n\n dưỡng sinh?  '), 'Giá gội đầu dưỡng sinh?');
  assert.equal(cleanMessage('a\u0000b‮c​d'), 'a b c d');
  assert.equal(cleanMessage(''), null);
  assert.equal(cleanMessage('   \n  '), null);
  assert.equal(cleanMessage(42), null);
  assert.equal(cleanMessage('x'.repeat(500)), 'x'.repeat(500));
  assert.equal(cleanMessage('x'.repeat(501)), null);
  // Composed and decomposed Vietnamese are the same text.
  assert.equal(cleanMessage('ế'), cleanMessage('ế'));
});

test('optional text: empty is absent, text is cleaned, too long or not text is refused', () => {
  assert.equal(optionalText(undefined, 80), null);
  assert.equal(optionalText('   ', 80), null);
  assert.equal(optionalText('  Lan   Anh ', 80), 'Lan Anh');
  assert.equal(optionalText('x'.repeat(81), 80), undefined);
  assert.equal(optionalText(5, 80), undefined);
});

test('the session id is a UUID and nothing else', () => {
  assert.equal(isSessionId('3b1f6c52-0a43-4f3e-9d0b-2f6f1c8a9e11'), true);
  assert.equal(isSessionId('3B1F6C52-0A43-4F3E-9D0B-2F6F1C8A9E11'), true);
  for (const bad of [
    '',
    'abc',
    '3b1f6c52-0a43-4f3e-9d0b-2f6f1c8a9e1',
    null,
    7,
    '../../etc/passwd',
  ]) {
    assert.equal(isSessionId(bad), false, String(bad));
  }
});

test('a reply becomes plain text: tags, links, addresses, e-mails and markdown marks are removed', () => {
  assert.equal(
    cleanReply('Gội đầu dưỡng sinh **350.000đ**, khoảng 60 phút.'),
    'Gội đầu dưỡng sinh 350.000đ, khoảng 60 phút.',
  );
  assert.equal(
    cleanReply(
      'Xem <a href="https://evil.example">tại đây</a>: https://evil.example/x và www.evil.example',
    ),
    'Xem tại đây: và',
  );
  assert.equal(
    cleanReply('Đặt lịch [tại đây](https://evil.example/book) nhé'),
    'Đặt lịch tại đây nhé',
  );
  assert.equal(cleanReply('![logo](https://evil.example/a.png)'), 'logo');
  assert.equal(cleanReply('Liên hệ spa@evil.example để biết thêm'), 'Liên hệ để biết thêm');
  assert.equal(cleanReply('# Tiêu đề\n\n\n\nNội dung `mã`'), 'Tiêu đề\n\nNội dung mã');
  assert.equal(cleanReply('<script>alert(1)</script>'), 'alert(1)');
  assert.equal(cleanReply('a &amp; b &#39;c'), 'a b c');
  assert.equal(cleanReply('   '), null);
  assert.equal(cleanReply('<b></b>'), null);
  assert.equal(cleanReply({ reply: 'x' }), null);
  // SPF > 30 is not markdown and survives.
  assert.equal(cleanReply('Kem chống nắng SPF > 30'), 'Kem chống nắng SPF > 30');
});

test('a long reply is cut at a word and ends with an ellipsis, within the limit', () => {
  const long = `${'Câu trả lời dài. '.repeat(200)}`;
  const cut = cleanReply(long)!;
  assert.ok(cut.length <= 1_501, String(cut.length));
  assert.ok(cut.endsWith('…'));
  assert.ok(!cut.endsWith('. …'));
});

test('the slot the bot names is checked field by field; anything else is no slot', () => {
  const good = {
    branch: 'hai-chau',
    services: ['goi-dau', 'massage'],
    date: '2026-11-05',
    time: '14:30',
  };
  assert.deepEqual(parseBotBooking(good), { ...good });
  assert.deepEqual(parseBotBooking({ ...good, time: undefined }), { ...good, time: null });
  assert.deepEqual(parseBotBooking({ ...good, services: ['a', 'a'] }), {
    ...good,
    services: ['a'],
    time: '14:30',
  });
  for (const bad of [
    null,
    [],
    'x',
    { ...good, branch: 'https://evil.example' },
    { ...good, branch: '' },
    { ...good, services: [] },
    { ...good, services: ['a', 'b', 'c', 'd'] },
    { ...good, services: ['ok', 'not ok'] },
    { ...good, services: 'goi-dau' },
    { ...good, date: '2026-13-01' },
    { ...good, date: '05/11/2026' },
    { ...good, time: '25:00' },
    { ...good, time: 1430 },
  ]) {
    assert.equal(parseBotBooking(bad), null, JSON.stringify(bad));
  }
});

test('the booking link is built from the fields and escapes them', () => {
  assert.equal(
    bookingUrl('https://lucyspa.vn', 'vi', {
      branch: 'hai-chau',
      services: ['goi-dau', 'massage'],
      date: '2026-11-05',
      time: '14:30',
    }),
    'https://lucyspa.vn/vi/account/book?branch=hai-chau&services=goi-dau,massage&date=2026-11-05&time=14%3A30',
  );
  assert.equal(
    bookingUrl('https://lucyspa.vn', 'en', {
      branch: 'a',
      services: ['b'],
      date: '2026-11-05',
      time: null,
    }),
    'https://lucyspa.vn/en/account/book?branch=a&services=b&date=2026-11-05',
  );
});

test('the shop day follows Vietnam time and ends at 17:00 UTC', () => {
  assert.equal(shopDay(new Date('2026-11-05T16:59:59Z')), '2026-11-05');
  assert.equal(shopDay(new Date('2026-11-05T17:00:00Z')), '2026-11-06');
  assert.equal(secondsToShopMidnight(new Date('2026-11-05T16:00:00Z')), 3_600);
  assert.equal(secondsToShopMidnight(new Date('2026-11-05T17:00:00Z')), 86_400);
  assert.equal(secondsToShopMidnight(new Date('2026-11-05T16:59:59Z')), 1);
});

test('the breaker opens after five failures in a minute, waits, lets one probe through, and closes on success', () => {
  const breaker = new CircuitBreaker(5, 60_000, 30_000);
  assert.equal(breaker.allow(0), true);
  for (let n = 0; n < 4; n += 1) breaker.failure(1_000 * n);
  assert.equal(breaker.open, false);
  breaker.failure(4_000);
  assert.equal(breaker.open, true);
  assert.equal(breaker.allow(5_000), false);
  assert.equal(breaker.allow(33_999), false);
  // After the cool-down exactly one probe goes out.
  assert.equal(breaker.allow(34_000), true);
  assert.equal(breaker.allow(34_001), false);
  // The probe fails: it stays open and waits again.
  breaker.failure(34_500);
  assert.equal(breaker.allow(40_000), false);
  assert.equal(breaker.allow(64_500), true);
  breaker.success();
  assert.equal(breaker.open, false);
  assert.equal(breaker.allow(64_600), true);
  // Failures spread over more than a minute never add up.
  const slow = new CircuitBreaker(5, 60_000, 30_000);
  for (let n = 0; n < 8; n += 1) slow.failure(n * 20_000);
  assert.equal(slow.open, false);
});
