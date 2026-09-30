import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../auth/auth.error.js';
import { PAYMENT_METHOD_RULES, resolvePaymentMethod } from './payment.methods.js';

test('payment methods: only CASH is known and active; CARD-ready means a rule table, not an accepted method', () => {
  assert.deepEqual(Object.keys(PAYMENT_METHOD_RULES), ['CASH']);
  assert.deepEqual(PAYMENT_METHOD_RULES.CASH, { active: true, reversible: true, tender: true });
  assert.equal(resolvePaymentMethod('CASH'), 'CASH');
  for (const value of [
    'CARD',
    'PAYOS',
    'cash',
    ' CASH',
    '',
    '__proto__',
    'constructor',
    'hasOwnProperty',
    0,
    null,
    undefined,
    {},
  ]) {
    assert.throws(
      () => resolvePaymentMethod(value),
      (error: unknown) => error instanceof AuthError && error.code === 'PAYMENT_METHOD_UNAVAILABLE',
      String(value),
    );
  }
});
