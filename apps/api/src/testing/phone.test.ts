import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePhone } from '../auth/identity.js';
import { validVnMobile, validVnMobileLocal } from './phone.js';

test('the fixture phone is always accepted by the real validator, in canonical and local form, and never repeats', () => {
  const seen = new Set<string>();
  for (let index = 0; index < 20_000; index += 1) {
    const number = validVnMobile();
    assert.equal(normalizePhone(number).phoneCanonical, number, number);
    assert.equal(seen.has(number), false, `repeated ${number}`);
    seen.add(number);
    const local = validVnMobileLocal();
    assert.match(local, /^0\d{9}$/);
    assert.equal(normalizePhone(local).phoneCanonical, `+84${local.slice(1)}`, local);
  }
});

test('the old fixture shape was the bug: +84992 is not an allocated mobile prefix, the validator is right to reject it', () => {
  assert.throws(() => normalizePhone('+84992648886'));
  assert.throws(() => normalizePhone('+84992000000'));
});

test("the validator accepts real customers' phones in the formats people type", () => {
  for (const [typed, canonical] of [
    ['0934936101', '+84934936101'],
    ['0934 936 101', '+84934936101'],
    ['093.493.6101', '+84934936101'],
    ['+84 934 936 101', '+84934936101'],
    ['+84934936101', '+84934936101'],
    ['0084934936101', '+84934936101'],
    ['(093) 493-6101', '+84934936101'],
    ['0376543210', '+84376543210'],
    ['0708123456', '+84708123456'],
    ['0856789012', '+84856789012'],
    ['0522334455', '+84522334455'],
    ['0996345678', '+84996345678'],
  ] as const) {
    assert.equal(normalizePhone(typed).phoneCanonical, canonical, typed);
  }
});
