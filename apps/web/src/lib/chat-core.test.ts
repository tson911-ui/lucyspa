import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from './api/client';
import {
  bookingPath,
  chatSessionId,
  looksLikePhone,
  stepFromAnswer,
  stepFromFailure,
} from './chat-core';

const ID = '3b1f6c52-0a43-4f3e-9d0b-2f6f1c8a9e11';

test('the chat session is a UUID kept in this tab: read back when valid, made and stored otherwise, never fatal when storage is blocked', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  assert.equal(
    chatSessionId(storage, () => ID),
    ID,
  );
  assert.equal(values.get('lucy-chat-session'), ID);
  // The stored one is reused, a new random is not asked for.
  assert.equal(
    chatSessionId(storage, () => 'ffffffff-0a43-4f3e-9d0b-2f6f1c8a9e11'),
    ID,
  );
  // Something else in storage is replaced.
  values.set('lucy-chat-session', 'not-a-uuid');
  assert.equal(
    chatSessionId(storage, () => ID),
    ID,
  );
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(
    chatSessionId(blocked, () => ID),
    ID,
  );
  assert.equal(
    chatSessionId(null, () => ID),
    ID,
  );
});

test('an answer is a reply or the callback form; a failure waits on 429 and otherwise offers the form', () => {
  assert.deepEqual(stepFromAnswer({ status: 'REPLY', reply: 'Chào!', bookingUrl: null }), {
    kind: 'REPLY',
    reply: 'Chào!',
    bookingUrl: null,
  });
  assert.deepEqual(stepFromAnswer({ status: 'FALLBACK', reason: 'CAP_REACHED' }), {
    kind: 'FORM',
    reason: 'CAP_REACHED',
  });
  assert.deepEqual(stepFromFailure(new ApiError(429, 'RATE_LIMITED')), { kind: 'WAIT' });
  for (const error of [new ApiError(500, 'HTTP_500'), new ApiError(0, 'NETWORK'), new Error('x')]) {
    assert.deepEqual(stepFromFailure(error), { kind: 'FORM', reason: 'N8N_DOWN' });
  }
});

test('the booking link opens as a path on this site and nowhere else', () => {
  const origin = 'https://lucyspa.vn';
  assert.equal(
    bookingPath(
      'https://lucyspa.vn/vi/account/book?branch=a&services=b&date=2026-11-05&time=14%3A30',
      origin,
    ),
    '/vi/account/book?branch=a&services=b&date=2026-11-05&time=14%3A30',
  );
  assert.equal(
    bookingPath('https://lucyspa.vn/en/account/book?branch=a', origin),
    '/en/account/book?branch=a',
  );
  for (const bad of [
    null,
    'not a url',
    'https://evil.example/vi/account/book?branch=a',
    'https://lucyspa.vn/vi/book?branch=a',
    'https://lucyspa.vn/vi/account',
    'https://lucyspa.vn.evil.example/vi/account/book',
    'javascript:alert(1)',
  ]) {
    assert.equal(bookingPath(bad, origin), null, String(bad));
  }
});

test('a phone number is checked loosely: digits and separators, nine to fifteen digits', () => {
  for (const ok of [
    '0905123456',
    '0905 123 456',
    '+84 905 123 456',
    '(0905) 123-456',
    '090.512.3456',
  ]) {
    assert.equal(looksLikePhone(ok), true, ok);
  }
  for (const bad of [
    '',
    '12345',
    'abc',
    '0905-abc-123',
    '+',
    '1234567890123456',
    '0905 123 456 ext 5',
  ]) {
    assert.equal(looksLikePhone(bad), false, bad);
  }
});
