import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReportRegistryResponse } from '@lucy-spa/contracts';
import { collectNumbers } from '@lucy-spa/server';
import {
  ASSISTANT_TOOLS,
  definitionsOf,
  parseArgs,
  toolsFor,
  type AssistantReports,
  type ToolBranch,
} from './assistant.tools.js';

const BRANCHES: ToolBranch[] = [
  { id: 'b1', code: 'DN1', name: 'Chi nhánh 1' },
  { id: 'b2', code: 'DN2', name: 'Chi nhánh 2' },
];

const registry = (open: Record<string, string[]>): ReportRegistryResponse =>
  ({
    generatedAt: '2026-10-13T00:00:00.000Z',
    branches: BRANCHES.map(({ id, code, name }) => ({ id, code, name })),
    reports: Object.entries(open).map(([id, branchIds]) => ({
      id,
      area: 'revenue',
      wave: 'A',
      available: branchIds.length > 0,
      exportable: false,
      exportReauth: false,
      branchIds,
    })),
  }) as unknown as ReportRegistryResponse;

test('the tool list is cut to the reports the person may open, and the branches to the ones those reports cover', () => {
  const { tools, branches } = toolsFor(
    registry({ 'revenue-overview': ['b1'], refunds: [], profit: ['b1', 'b2'], reviews: ['b2'] }),
  );
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['profit', 'revenue', 'reviews']);
  assert.deepEqual(
    branches.map((branch) => branch.code),
    ['DN1', 'DN2'],
  );
  assert.deepEqual(toolsFor(registry({ 'revenue-overview': [] })).tools, []);
  // Every tool is bound to a report the catalogue knows, and the names are unique.
  assert.equal(new Set(ASSISTANT_TOOLS.map((tool) => tool.name)).size, ASSISTANT_TOOLS.length);
});

test('every definition is a strict object schema with the branch codes of the person only', () => {
  const { tools, branches } = toolsFor(registry({ 'revenue-overview': ['b1'] }));
  const [definition] = definitionsOf(tools, branches);
  assert.equal(definition!.name, 'revenue');
  const schema = definition!.inputSchema as {
    additionalProperties: boolean;
    required: string[];
    properties: { branch: { description: string } };
  };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['from', 'to', 'branch']);
  assert.match(schema.properties.branch.description, /DN1/);
  assert.doesNotMatch(schema.properties.branch.description, /DN2/);
});

test('arguments: real dates, from not after to, at most a year, a branch only from the person’s list', () => {
  assert.deepEqual(parseArgs({ from: '2026-10-01', to: '2026-10-13', branch: null }, BRANCHES), {
    from: '2026-10-01',
    to: '2026-10-13',
    branchId: undefined,
  });
  assert.equal(
    parseArgs({ from: '2026-10-01', to: '2026-10-13', branch: 'dn2' }, BRANCHES)?.branchId,
    'b2',
  );
  for (const bad of [
    { from: '2026-02-31', to: '2026-03-02', branch: null },
    { from: '2026-10-13', to: '2026-10-01', branch: null },
    { from: '2025-01-01', to: '2026-12-31', branch: null },
    { from: '2026-10-01', to: '2026-10-13', branch: 'HN9' },
    { from: '2026-10-01', to: '2026-10-13', branch: 7 },
    { from: '10/01/2026', to: '2026-10-13', branch: null },
    null,
    'x',
    [],
  ]) {
    assert.equal(parseArgs(bad, BRANCHES), null, JSON.stringify(bad));
  }
});

const period = {
  from: '2026-10-01',
  to: '2026-10-13',
  previous: { from: '2026-09-18', to: '2026-09-30' },
};
const ref = { id: 'b1', code: 'DN1', name: 'Chi nhánh 1' };
const none = async () => {
  throw new Error('not called');
};
const stub = (patch: Partial<Record<keyof AssistantReports, unknown>>): AssistantReports =>
  ({
    registry: none,
    revenue: none,
    refunds: none,
    serviceRevenue: none,
    productRevenue: none,
    customerVisits: none,
    bookingFunnel: none,
    cashDaily: none,
    cashFunds: none,
    labourCost: none,
    payrollMonthly: none,
    advances: none,
    profit: none,
    reviews: none,
    ...patch,
  }) as unknown as AssistantReports;

const run = async (name: string, reports: AssistantReports) => {
  const tool = ASSISTANT_TOOLS.find((entry) => entry.name === name)!;
  return tool.run(
    { from: '2026-10-01', to: '2026-10-13', branchId: undefined },
    { token: 't', reports, branches: BRANCHES },
  );
};

test('projections: totals and labels only; no person, phone, pay line, comment or invoice code ever reaches the model', async () => {
  const payroll = await run(
    'payroll_totals',
    stub({
      payrollMonthly: async () => ({
        started: true,
        totals: { netVnd: '30000000', tipsVnd: '1000000' },
        rows: [
          {
            month: '2026-09',
            status: 'PAID',
            people: 12,
            byKind: { BASE_SALARY: '20000000', TOUR: '5000000' },
            netVnd: '30000000',
            tipsVnd: '1000000',
          },
        ],
      }),
    }),
  );
  const advances = await run(
    'advances_totals',
    stub({
      advances: async () => ({
        started: true,
        totals: { outstandingVnd: '3000000', pendingVnd: '500000' },
        rows: [
          { userId: 'u1', name: 'Nguyễn Thị A', employeeCode: 'NV01', outstandingVnd: '3000000' },
          { userId: 'u2', name: 'Trần B', employeeCode: 'NV02', outstandingVnd: '0' },
        ],
      }),
    }),
  );
  const refunds = await run(
    'refunds',
    stub({
      refunds: async () => ({
        period,
        totals: { refundsVnd: '200000', exchangesVnd: '0', reversalsVnd: '0', paymentAnomalies: 1 },
        rows: [{ invoiceCode: 'INV-1', reason: 'Khách A gọi 0905123456', amountVnd: '200000' }],
      }),
    }),
  );
  const reviews = await run(
    'reviews',
    stub({
      reviews: async () => ({
        period,
        totals: { count: 40, averageHundredths: 457, distribution: [0, 1, 2, 7, 30], enough: true },
        byBranch: [{ branch: ref, count: 40, averageHundredths: 457 }],
        staff: [{ userId: 'u1', name: 'Nguyễn Thị A', employeeCode: 'NV01', count: 9 }],
        paidInvoices: 80,
        responseBp: 5000,
      }),
    }),
  );
  const visits = await run(
    'visits',
    stub({
      customerVisits: async () => ({
        period,
        totals: {
          visits: 90,
          bookedVisits: 60,
          walkInVisits: 30,
          people: 70,
          newPeople: 20,
          returningPeople: 50,
          unidentified: 0,
        },
        byBranch: [{ branch: ref, visits: 90, people: 70 }],
      }),
    }),
  );
  const wire = JSON.stringify([payroll, advances, refunds, reviews, visits]);
  for (const forbidden of [
    'Nguyễn',
    'Trần',
    'NV01',
    'INV-1',
    '0905',
    'userId',
    'phone',
    'employeeCode',
    'reason',
    'staff',
  ]) {
    assert.ok(!wire.includes(forbidden), `${forbidden} must not reach the model`);
  }
  assert.deepEqual(advances, {
    booksStarted: true,
    outstanding: 3_000_000,
    waitingForApproval: 500_000,
    peopleWithAdvanceOutstanding: 1,
  });
  assert.equal((reviews as { average: number }).average, 4.57);
  assert.equal((reviews as { ratedPercent: number }).ratedPercent, 50);
});

test('the revenue tool returns the change against the previous period so the model never has to compute it', async () => {
  const result = (await run(
    'revenue',
    stub({
      revenue: async (_token: string, query: Record<string, unknown>) => {
        assert.equal(query['compare'], 'previous');
        return {
          period,
          totals: {
            netVnd: '12500000',
            collectedVnd: '13000000',
            refundsVnd: '500000',
            exchangesVnd: '0',
          },
          previousTotals: { netVnd: '10000000' },
          paidInvoices: { count: 40, totalVnd: '13000000', averageVnd: '325000' },
          visits: 90,
          onlineHeldVnd: '0',
          byBranch: [
            { branch: ref, netVnd: '12500000', visits: 90, paidInvoices: 40, collectedVnd: '0' },
          ],
          bySide: [{ key: 'SPA', netVnd: '9000000', shareBp: 7200 }],
          byKind: [{ key: 'SERVICE', netVnd: '9000000', shareBp: 7200 }],
          byChannel: [{ key: 'COUNTER', netVnd: '12500000', shareBp: 10000 }],
          byMethod: [{ method: 'CASH', inVnd: '8000000', outVnd: '500000', netVnd: '7500000' }],
        };
      },
    }),
  )) as {
    previousPeriod: { changeVnd: number; changePercent: number };
    byKind: { name: string; percent: number }[];
  };
  assert.equal(result.previousPeriod.changeVnd, 2_500_000);
  assert.equal(result.previousPeriod.changePercent, 25);
  assert.deepEqual(result.byKind, [{ name: 'dịch vụ', netRevenue: 9_000_000, percent: 72 }]);
  const numbers = collectNumbers(result);
  for (const n of [12_500_000, 2_500_000, 25, 72, 90]) assert.ok(numbers.has(n), String(n));
});
