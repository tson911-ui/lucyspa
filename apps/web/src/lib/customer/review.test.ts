import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../api/client';
import { reviewErrorKey, reviewRequest } from './review';

test('the request: a rating is needed; a skipped person is left out; a blank note is no note', () => {
  assert.equal(reviewRequest('inv-1', '', 'xin chào', {}), null);
  assert.deepEqual(reviewRequest('inv-1', '5', '  Rất tốt  ', { e1: '4', e2: '0' }), {
    invoiceId: 'inv-1',
    rating: 5,
    comment: 'Rất tốt',
    staff: [{ employeeUserId: 'e1', rating: 4 }],
  });
  assert.deepEqual(reviewRequest('inv-1', '1', '   ', {}), {
    invoiceId: 'inv-1',
    rating: 1,
    comment: null,
    staff: [],
  });
});

test('the errors the customer can meet map to plain messages', () => {
  assert.equal(reviewErrorKey(new ApiError(409, 'REVIEW_ALREADY_SUBMITTED', 'x')), 'already');
  assert.equal(reviewErrorKey(new ApiError(409, 'REVIEW_NOT_AVAILABLE', 'x')), 'unavailable');
  assert.equal(reviewErrorKey(new ApiError(422, 'VALIDATION_FAILED', 'x')), 'invalid');
  assert.equal(reviewErrorKey(new ApiError(500, 'SOMETHING', 'x')), 'generic');
  assert.equal(reviewErrorKey(new Error('offline')), 'generic');
});
