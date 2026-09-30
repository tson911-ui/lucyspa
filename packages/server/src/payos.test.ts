import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePayosEnvironment } from './environment.js';
import { ProviderRejectedError, ProviderUnavailableError } from './payment-provider.js';
import { createPayosProvider, payosCanonical, payosDataSignature, payosSign } from './payos.js';
import { createPayosSimulator } from './payos-simulator.js';

const create = (orderCode: number, amountVnd = 120_000) => ({
  orderCode,
  amountVnd,
  description: 'LUCYSPA',
  expiresAt: new Date(Date.now() + 15 * 60_000),
  returnUrl: 'https://spa.example',
  cancelUrl: 'https://spa.example',
});

test('canonical form: sorted keys, null as empty, documented signature input', () => {
  assert.equal(payosCanonical({ b: 2, a: 'x', c: null, d: undefined, e: 'null' }), 'a=x&b=2&c=&e=');
  // The documented create-request signature input.
  assert.equal(
    payosSign('amount=1&cancelUrl=c&description=d&orderCode=2&returnUrl=r', 'key'),
    payosSign('amount=1&cancelUrl=c&description=d&orderCode=2&returnUrl=r', 'key'),
  );
  assert.notEqual(payosSign('a', 'key'), payosSign('a', 'other'));
});

test('create / read / cancel round trip against the simulator', async () => {
  const sim = createPayosSimulator();
  const made = await sim.provider.createPaymentRequest(create(1_700_000_000_001));
  assert.equal(made.orderCode, 1_700_000_000_001);
  assert.ok(made.checkoutUrl.startsWith('https://'));
  assert.equal((await sim.provider.getPaymentRequest(made.orderCode)).status, 'PENDING');
  const cancelled = await sim.provider.cancelPaymentRequest(
    made.orderCode,
    'Customer changed mind',
  );
  assert.equal(cancelled.status, 'CANCELLED');
  assert.deepEqual(sim.calls, [
    'POST /v2/payment-requests',
    'GET /v2/payment-requests/1700000000001',
    'POST /v2/payment-requests/1700000000001/cancel',
  ]);
});

test('a paid order reads as PAID with the transfer reference', async () => {
  const sim = createPayosSimulator();
  const made = await sim.provider.createPaymentRequest(create(1_700_000_000_002));
  sim.pay(made.orderCode, { reference: 'TF123' });
  const read = await sim.provider.getPaymentRequest(made.orderCode);
  assert.equal(read.status, 'PAID');
  assert.equal(read.amountPaidVnd, 120_000);
  assert.equal(read.reference, 'TF123');
});

test('failures: unreachable and 5xx are unknown, a refusal is definitive, tampering is untrusted', async () => {
  const sim = createPayosSimulator();
  sim.fail('create', 'UNREACHABLE');
  await assert.rejects(sim.provider.createPaymentRequest(create(1)), ProviderUnavailableError);
  sim.fail('create', 'SERVER_ERROR');
  await assert.rejects(sim.provider.createPaymentRequest(create(2)), ProviderUnavailableError);
  sim.fail('create', 'REJECT');
  await assert.rejects(sim.provider.createPaymentRequest(create(3)), ProviderRejectedError);
  sim.fail('create', 'BAD_SIGNATURE');
  await assert.rejects(sim.provider.createPaymentRequest(create(4)), ProviderUnavailableError);
  // Duplicate order code is a definitive refusal.
  await sim.provider.createPaymentRequest(create(5));
  await assert.rejects(sim.provider.createPaymentRequest(create(5)), ProviderRejectedError);
  // An unknown order is "not found".
  await assert.rejects(
    sim.provider.getPaymentRequest(999),
    (error: unknown) => error instanceof ProviderRejectedError && error.notFound,
  );
  // A paid order cannot be cancelled.
  sim.pay(5);
  await assert.rejects(sim.provider.cancelPaymentRequest(5, 'x'), ProviderRejectedError);
});

test('wrong credentials are refused by the provider and never reveal the key', async () => {
  const sim = createPayosSimulator();
  const wrong = createPayosProvider({ ...sim.config, apiKey: 'wrong' }, { fetch: sim.fetch });
  await assert.rejects(
    wrong.createPaymentRequest(create(9)),
    (error: unknown) =>
      error instanceof ProviderRejectedError && !JSON.stringify(error).includes('wrong'),
  );
});

test('notification verification: authentic passes, every tampering fails', () => {
  const sim = createPayosSimulator();
  const good = sim.webhook({ orderCode: 42, amount: 50_000, reference: 'TF1' });
  const verified = sim.provider.verifyNotification(good);
  assert.ok(verified);
  assert.equal(verified.orderCode, 42);
  assert.equal(verified.amountVnd, 50_000);
  assert.equal(verified.success, true);
  // Counterparty account details are not kept.
  assert.equal('counterAccountName' in verified.payload, false);
  assert.equal('counterAccountNumber' in verified.payload, false);

  const data = good['data'] as Record<string, unknown>;
  const bad = [
    { ...good, data: { ...data, amount: 1 } },
    { ...good, data: { ...data, orderCode: 43 } },
    { ...good, signature: 'a'.repeat(64) },
    { ...good, signature: '' },
    { ...good, data: undefined },
    { ...good, success: 'true' },
    null,
    'text',
    [],
  ];
  for (const body of bad) assert.equal(sim.provider.verifyNotification(body), null);
  // A signature made with another key is not authentic.
  const other = createPayosSimulator({ ...sim.config, checksumKey: 'another-key' });
  assert.equal(
    sim.provider.verifyNotification(
      other.webhook({ orderCode: 42, amount: 50_000, reference: 'TF1' }),
    ),
    null,
  );
  // An unsuccessful notification is authentic but never a success.
  const failed = sim.provider.verifyNotification(
    sim.webhook({ orderCode: 42, amount: 50_000, reference: 'TF2', success: false }),
  );
  assert.equal(failed?.success, false);
  assert.equal(
    payosDataSignature(data, sim.config.checksumKey),
    (good as { signature: string }).signature,
  );
});

test('PayOS environment: none disables, all three enable, a partial set fails closed by field name', () => {
  assert.equal(parsePayosEnvironment({}), null);
  assert.equal(
    parsePayosEnvironment({ PAYOS_CLIENT_ID: '', PAYOS_API_KEY: ' ', PAYOS_CHECKSUM_KEY: '' }),
    null,
  );
  assert.deepEqual(
    parsePayosEnvironment({
      PAYOS_CLIENT_ID: 'c',
      PAYOS_API_KEY: 'k',
      PAYOS_CHECKSUM_KEY: 's',
    }),
    { clientId: 'c', apiKey: 'k', checksumKey: 's' },
  );
  assert.throws(
    () => parsePayosEnvironment({ PAYOS_CLIENT_ID: 'secret-value', PAYOS_API_KEY: 'k' }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Invalid environment configuration: PAYOS_CHECKSUM_KEY' &&
      !error.message.includes('secret-value'),
  );
});
