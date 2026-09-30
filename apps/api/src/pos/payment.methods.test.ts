import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../auth/auth.error.js';
import { PAYMENT_METHOD_RULES, resolvePaymentMethod } from './payment.methods.js';

test('payment methods: only CASH is recorded directly; PAYOS is a provider method; CARD does not exist', () => {
  assert.deepEqual(Object.keys(PAYMENT_METHOD_RULES), ['CASH', 'PAYOS']);
  assert.deepEqual(PAYMENT_METHOD_RULES.CASH, {
    active: true,
    reversible: true,
    tender: true,
    provider: false,
  });
  // PayOS money exists only when the provider confirms it: never recorded directly, never reversed (Q6, Q7).
  assert.deepEqual(PAYMENT_METHOD_RULES.PAYOS, {
    active: false,
    reversible: false,
    tender: false,
    provider: true,
  });
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
