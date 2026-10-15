import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseRichText, WEBSITE_PAGE_LIMITS, type RichBlock } from '@lucy-spa/contracts';
import { parsePolicyFile, POLICY_PAGES } from './policy-pages.js';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../../../../docs/policies.md', import.meta.url)),
  'utf8',
);
const blocksOf = (body: string): RichBlock[] => {
  const result = parseRichText(body);
  assert.ok(result.ok, JSON.stringify(result));
  return result.blocks;
};

test('docs/policies.md: eight pages, in order, each inside the real size limit and valid for the real parser', () => {
  const pages = parsePolicyFile(SOURCE);
  assert.deepEqual(
    pages.map((page) => page.slug),
    [
      'dieu-khoan-su-dung',
      'chinh-sach-thanh-toan',
      'chinh-sach-giao-hang',
      'chinh-sach-doi-tra-hoan-tien',
      'chinh-sach-bao-mat',
      'chinh-sach-dat-lich',
      'chinh-sach-thanh-vien-diem-thuong',
      'tiep-nhan-khieu-nai',
    ],
  );
  assert.equal(new Set(pages.map((page) => page.slug)).size, 8);
  for (const page of pages) {
    assert.ok([...page.body].length <= WEBSITE_PAGE_LIMITS.body, page.slug);
    assert.ok([...page.heading].length <= WEBSITE_PAGE_LIMITS.title, page.slug);
    blocksOf(page.body);
  }
  // The legal line needs exactly one terms and one privacy page; the other six are policy pages.
  assert.deepEqual(
    pages.map((page) => page.role),
    ['TERMS', 'POLICY', 'POLICY', 'POLICY', 'PRIVACY', 'POLICY', 'POLICY', 'POLICY'],
  );
});

test("the wording is the Owner's: the bodies, put back under their headings, are the file itself", () => {
  const pages = parsePolicyFile(SOURCE);
  const rebuilt = pages.map((page) => `## ${page.heading}\n\n${page.body}\n`).join('\n');
  assert.equal(rebuilt, SOURCE.replace(/\r\n?/g, '\n').normalize('NFC').trimEnd() + '\n');
  // Never the word for a medical visit (CLAUDE.md): the spa is not a clinic.
  assert.doesNotMatch(SOURCE, /khám(?! phá)/i);
});

test('the two pipe tables of the file are tables with every row as wide as the header', () => {
  const pages = parsePolicyFile(SOURCE);
  const tables = pages.flatMap((page) =>
    blocksOf(page.body)
      .filter((block) => block.type === 'table')
      .map((table) => [page.slug, table] as const),
  );
  assert.deepEqual(
    tables.map(([slug]) => slug),
    ['chinh-sach-doi-tra-hoan-tien', 'chinh-sach-thanh-vien-diem-thuong'],
  );
  for (const [, table] of tables) {
    assert.equal(table.type, 'table');
    if (table.type !== 'table') continue;
    assert.ok(table.rows.length >= 2);
    for (const row of table.rows) assert.equal(row.length, table.header.length);
  }
});

test('a file whose headings are not the eight expected pages in order is refused, naming what it found', () => {
  const swapped = SOURCE.replace('## Chính sách giao hàng', '## Chính sách vận chuyển');
  assert.throws(() => parsePolicyFile(swapped), /Expected:.*\n.*Found:.*vận chuyển/);
  assert.throws(() => parsePolicyFile('Lời mở đầu\n\n' + SOURCE), /before the first/);
  assert.throws(() => parsePolicyFile(SOURCE.split('## Chính sách thanh toán')[0]!), /eight/);
  assert.equal(POLICY_PAGES.length, 8);
});
