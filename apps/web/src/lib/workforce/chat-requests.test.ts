import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  displayPhone,
  nextStatuses,
  normalizeChatRequestList,
  statusTone,
  telHref,
} from './chat-requests';

test('a stored Vietnamese number reads the way it is dialled; anything else is left alone', () => {
  assert.equal(displayPhone('+84905123456'), '0905 123 456');
  assert.equal(displayPhone('+842363123456'), '0236 3123 456');
  assert.equal(displayPhone('+14155550123'), '+14155550123');
  assert.equal(displayPhone('0905123456'), '0905123456');
  assert.equal(telHref('+84905123456'), 'tel:+84905123456');
  assert.equal(telHref('+84 905-123 456'), 'tel:+84905123456');
});

test('the list state keeps only a known status and a page of one or more', () => {
  assert.deepEqual(normalizeChatRequestList({ status: 'NEW', page: 3 }), {
    status: 'NEW',
    page: 3,
  });
  assert.deepEqual(normalizeChatRequestList({ status: 'DONE', page: 0 }), { status: '', page: 1 });
  assert.deepEqual(normalizeChatRequestList({ status: '', page: 2.5 }), { status: '', page: 1 });
});

test('requests move forward only, and a new one stands out', () => {
  assert.deepEqual(nextStatuses('NEW'), ['CALLED', 'CLOSED']);
  assert.deepEqual(nextStatuses('CALLED'), ['CLOSED']);
  assert.deepEqual(nextStatuses('CLOSED'), []);
  assert.equal(statusTone('NEW'), 'warning');
  assert.equal(statusTone('CALLED'), 'info');
  assert.equal(statusTone('CLOSED'), 'neutral');
});
