import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditArea } from '../../i18n/audit';
import { AUDIT_DEFAULTS, auditQuery, normalizeAudit } from './audit';
import { zonedInstant } from './format';

test('the audit state: a bad date, a backwards range or a malformed action falls back to the defaults', () => {
  assert.deepEqual(
    normalizeAudit({ from: '2026-10-01', to: '2026-10-12', action: 'INVOICE_PAID' }),
    {
      from: '2026-10-01',
      to: '2026-10-12',
      action: 'INVOICE_PAID',
    },
  );
  assert.deepEqual(
    normalizeAudit({ from: '12/10/2026', to: '2026-10-12', action: 'invoice paid' }),
    AUDIT_DEFAULTS,
  );
  assert.deepEqual(
    normalizeAudit({ from: '2026-10-12', to: '2026-10-01', action: '' }),
    AUDIT_DEFAULTS,
  );
});

test('the API query: whole days of the shop time zone as instants, the end being the start of the next day', () => {
  const query = auditQuery(
    { from: '2026-10-11', to: '2026-10-12' },
    'INVOICE_PAID',
    'abc',
    'Asia/Ho_Chi_Minh',
    zonedInstant,
  );
  assert.equal(query['from'], '2026-10-10T17:00:00.000Z');
  assert.equal(query['to'], '2026-10-12T17:00:00.000Z');
  assert.equal(query['action'], 'INVOICE_PAID');
  assert.equal(query['cursor'], 'abc');
  assert.equal(query['limit'], 100);
  const open = auditQuery(
    { from: '2026-10-11', to: '2026-10-11' },
    '',
    null,
    'Asia/Ho_Chi_Minh',
    zonedInstant,
  );
  assert.equal(open['action'], undefined);
  assert.equal(open['cursor'], undefined);
});

test('an action belongs to an area by the start of its code; an unknown one is "other"', () => {
  assert.equal(auditArea('INVOICE_PAID'), 'invoice');
  assert.equal(auditArea('PAYSLIPS_PAID'), 'pay');
  assert.equal(auditArea('PAY_RUN_CLOSED'), 'pay');
  assert.equal(auditArea('CASH_DAY_CLOSED'), 'cash');
  assert.equal(auditArea('STOCK_ADJUSTED'), 'stock');
  assert.equal(auditArea('ROLE_ASSIGNED'), 'access');
  assert.equal(auditArea('REPORT_EXPORTED'), 'report');
  assert.equal(auditArea('SOMETHING_NEW'), 'other');
});
