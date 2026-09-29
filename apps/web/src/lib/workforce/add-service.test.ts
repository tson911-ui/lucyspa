import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addOutcome, addServiceBody, referenceRange } from './add-service';

const base = {
  participantId: 'p-1',
  serviceId: 's-1',
  myUserId: 'u-me',
  idempotencyKey: 'k-1',
};

test('the add request carries only ids and an optional staff intent', () => {
  assert.deepEqual(addServiceBody({ ...base, staff: '' }), {
    participantId: 'p-1',
    serviceId: 's-1',
    requestedEmployeeUserId: null,
    idempotencyKey: 'k-1',
  });
  assert.equal(addServiceBody({ ...base, staff: 'me' })?.requestedEmployeeUserId, 'u-me');
  assert.equal(addServiceBody({ ...base, staff: 'u-other' })?.requestedEmployeeUserId, 'u-other');
  const body = addServiceBody({ ...base, staff: '' }) as unknown as Record<string, unknown>;
  for (const forbidden of ['name', 'price', 'priceVnd', 'quantity', 'plannedStartAt'])
    assert.equal(forbidden in body, false);
});

test('nothing is sent without a participant, a service and a key', () => {
  assert.equal(addServiceBody({ ...base, participantId: '', staff: '' }), null);
  assert.equal(addServiceBody({ ...base, serviceId: '', staff: '' }), null);
  assert.equal(addServiceBody({ ...base, idempotencyKey: '', staff: '' }), null);
});

test('the reference range is a single amount or a range, in the locale format', () => {
  assert.equal(referenceRange({ priceMinVnd: '40000', priceMaxVnd: '40000' }, 'vi'), '40.000 ₫');
  assert.equal(
    referenceRange({ priceMinVnd: '5000', priceMaxVnd: '10000' }, 'en'),
    '5,000 ₫–10,000 ₫',
  );
});

test('the outcome text depends on whether a KTV was scheduled', () => {
  assert.equal(
    addOutcome({ status: 'PLANNED', employee: { id: 'e', displayName: 'A' } }),
    'PLANNED',
  );
  assert.equal(addOutcome({ status: 'WAITING', employee: null }), 'WAITING');
});
