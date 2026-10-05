import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskName } from '../pos/combo-use.core.js';
import { customerComboStatus, customerKindOf } from './customer-loyalty.core.js';

const now = new Date('2026-10-05T03:00:00.000Z');
const past = new Date('2026-10-01T00:00:00.000Z');
const future = new Date('2026-12-01T00:00:00.000Z');

test('P5-10 the points history is in simple wording: a manual change is always "adjusted"', () => {
  assert.equal(customerKindOf('EARN'), 'EARNED');
  assert.equal(customerKindOf('EARN_REVERSAL'), 'TAKEN_BACK');
  assert.equal(customerKindOf('REFERRAL_AWARD'), 'REFERRAL');
  assert.equal(customerKindOf('MANUAL_ADJUSTMENT'), 'ADJUSTED');
  assert.equal(customerKindOf('MANUAL_CORRECTION'), 'ADJUSTED');
});

test('P5-10 combo status for its owner: paused beats used up beats expired', () => {
  const base = { usable: true, freeSessions: 3, expiresAt: null, now };
  assert.equal(customerComboStatus(base), 'ACTIVE');
  assert.equal(customerComboStatus({ ...base, expiresAt: future }), 'ACTIVE');
  assert.equal(customerComboStatus({ ...base, expiresAt: past }), 'EXPIRED');
  assert.equal(
    customerComboStatus({ ...base, expiresAt: now }),
    'EXPIRED',
    'expires at the instant',
  );
  assert.equal(customerComboStatus({ ...base, freeSessions: 0 }), 'USED_UP');
  assert.equal(customerComboStatus({ ...base, freeSessions: 0, expiresAt: past }), 'USED_UP');
  assert.equal(customerComboStatus({ ...base, usable: false }), 'PAUSED');
  assert.equal(customerComboStatus({ ...base, usable: false, freeSessions: 0 }), 'PAUSED');
});

test('P5-10 other people are only ever a masked name', () => {
  assert.equal(maskName('Lê Quốc Bình'), 'L••• Q••• B•••');
  assert.doesNotMatch(maskName('Nguyễn Thị Lan'), /guyễn|hị|an/);
});
