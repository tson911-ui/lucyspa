import type { ReviewsReport } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportsDDictionary } from '../../../i18n/reports-d';
import { owner, render } from '../../../test/support';
import { ReviewsBody } from './reports-reviews';

const d = reportsDDictionary('vi');
const branchA = { id: 'a', code: 'A', name: 'Nguyễn Quang Bích' };
const branchB = { id: 'b', code: 'B', name: 'Quận 1' };

const report = (patch: Partial<ReviewsReport> = {}): ReviewsReport => ({
  generatedAt: '2026-10-12T03:00:00.000Z',
  period: { from: '2026-10-01', to: '2026-10-12', previous: null },
  branches: [branchA, branchB],
  totals: { count: 10, averageHundredths: 375, distribution: [1, 0, 2, 2, 5], enough: true },
  byBranch: [
    {
      branch: branchA,
      count: 8,
      averageHundredths: 375,
      distribution: [1, 0, 2, 2, 3],
      enough: true,
    },
    {
      branch: branchB,
      count: 2,
      averageHundredths: 400,
      distribution: [0, 0, 1, 0, 1],
      enough: false,
    },
  ],
  staff: [
    {
      userId: 'u1',
      name: 'Thu Hà',
      employeeCode: 'NV01',
      count: 6,
      averageHundredths: 417,
      distribution: [0, 0, 1, 3, 2],
      enough: true,
    },
    {
      userId: 'u2',
      name: 'Minh Anh',
      employeeCode: null,
      count: 2,
      averageHundredths: 450,
      distribution: [0, 0, 0, 1, 1],
      enough: false,
    },
  ],
  paidInvoices: 40,
  responseBp: 2500,
  ...patch,
});

test('the reviews report: private note, the average with two decimals only from five ratings, "chưa đủ đánh giá" below, the response rate', () => {
  const html = render(<ReviewsBody data={report()} />, owner);
  assert.match(html, new RegExp(d.privateNote.slice(0, 30)));
  assert.match(html, /3,75/);
  assert.match(html, /4,17/);
  assert.doesNotMatch(html, /4,50/);
  assert.doesNotMatch(html, /4,00/);
  assert.equal(html.match(new RegExp(d.notEnough, 'g'))?.length, 2, 'Quận 1 and Minh Anh');
  assert.match(html, /25,0%/);
  assert.match(html, /Thu Hà/);
  assert.match(html, /Quận 1/);
  assert.doesNotMatch(html, /<h[1-3][^>]*>[^<]*[0-9][^<]*<\/h[1-3]>/);
});

test('with too few ratings in all the page shows no average figure at all', () => {
  const html = render(
    <ReviewsBody
      data={report({
        totals: { count: 3, averageHundredths: 433, distribution: [0, 0, 1, 1, 1], enough: false },
        byBranch: [
          {
            branch: branchA,
            count: 3,
            averageHundredths: 433,
            distribution: [0, 0, 1, 1, 1],
            enough: false,
          },
        ],
        staff: [],
      })}
    />,
    owner,
  );
  assert.doesNotMatch(html, /4,33/);
  assert.match(html, new RegExp(d.notEnough));
  assert.match(html, new RegExp(d.emptyStaff));
});

test('an empty period says so, with no average and no distribution invented', () => {
  const html = render(
    <ReviewsBody
      data={report({
        totals: { count: 0, averageHundredths: null, distribution: [0, 0, 0, 0, 0], enough: false },
        byBranch: [
          {
            branch: branchA,
            count: 0,
            averageHundredths: null,
            distribution: [0, 0, 0, 0, 0],
            enough: false,
          },
        ],
        staff: [],
        paidInvoices: 0,
        responseBp: 0,
      })}
    />,
    owner,
  );
  assert.match(html, new RegExp(d.emptyStaff));
});
