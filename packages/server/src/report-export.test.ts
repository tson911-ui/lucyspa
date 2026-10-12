import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync } from 'fflate';
import { readRows } from './product-import/spreadsheet.js';
import {
  neutralizeFormula,
  sheetName,
  toCsv,
  toXlsx,
  xmlEscape,
  type ExportSheet,
} from './report-export.js';

const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

const sample = (): ExportSheet => ({
  name: 'Doanh thu',
  columns: [
    { header: 'Ngày', kind: 'date' },
    { header: 'Chi nhánh', kind: 'text' },
    { header: 'Doanh thu', kind: 'money' },
    { header: 'Số hóa đơn', kind: 'int' },
    { header: 'Tỷ lệ', kind: 'percent' },
  ],
  rows: [
    [new Date(Date.UTC(2026, 9, 12)), 'Chi nhánh Quận 1', 1_250_000n, 14, 0.1234],
    [new Date(Date.UTC(2026, 9, 13)), 'Có "dấu ngoặc", dấu phẩy', -50_000, 0, 0],
    [new Date(Date.UTC(2026, 9, 14)), null, 0, 3, 1],
  ],
});

test('CSV: byte-order mark, comma, CRLF, quotes doubled, Vietnamese intact, dates ISO, money plain', () => {
  const bytes = toCsv(sample());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = decode(bytes);
  assert.ok(text.startsWith('\uFEFFNgày,Chi nhánh,Doanh thu,Số hóa đơn,Tỷ lệ\r\n'));
  const lines = text.slice(1).split('\r\n');
  assert.equal(lines[1], '2026-10-12,Chi nhánh Quận 1,1250000,14,12.34');
  assert.equal(lines[2], '2026-10-13,"Có ""dấu ngoặc"", dấu phẩy",-50000,0,0.00');
  assert.equal(lines[3], '2026-10-14,,0,3,100.00');
  assert.equal(lines[4], '');
});

test('CSV: a text cell that a spreadsheet could read as a formula is neutralised; numbers and phones are not touched', () => {
  assert.equal(neutralizeFormula('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(neutralizeFormula('+cmd|calc'), "'+cmd|calc");
  assert.equal(neutralizeFormula('-1+1'), "'-1+1");
  assert.equal(neutralizeFormula('@SUM(1)'), "'@SUM(1)");
  assert.equal(neutralizeFormula('\t=1'), "'\t=1");
  assert.equal(neutralizeFormula('\r=1'), "'\r=1");
  assert.equal(neutralizeFormula('Nguyễn Văn A'), 'Nguyễn Văn A');
  assert.equal(neutralizeFormula('+84901234567'), '+84901234567'); // a phone number stays as it is (Owner: shown in full)
  assert.equal(neutralizeFormula(''), '');
  const csv = decode(
    toCsv({
      name: 'x',
      columns: [
        { header: 'Tên', kind: 'text' },
        { header: 'Số tiền', kind: 'money' },
      ],
      rows: [
        ['=HYPERLINK("http://evil")', -75_000],
        ['+84901234567', 5],
      ],
    }),
  );
  assert.ok(csv.includes('"\'=HYPERLINK(""http://evil"")",-75000'), csv);
  assert.ok(csv.includes('+84901234567,5'), csv);
});

test('XLSX: reads back with the product-import reader: text, money and counts are numbers, nothing is a formula', () => {
  const bytes = toXlsx([sample()]);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const rows = readRows(bytes, 'report.xlsx');
  assert.deepEqual(rows[0]?.cells, ['Ngày', 'Chi nhánh', 'Doanh thu', 'Số hóa đơn', 'Tỷ lệ']);
  assert.deepEqual(rows[1]?.cells.slice(0, 4), ['2026-10-12', 'Chi nhánh Quận 1', '1250000', '14']);
  assert.equal(rows[2]?.cells[1], 'Có "dấu ngoặc", dấu phẩy');
  assert.equal(rows[2]?.cells[2], '-50000');
  assert.equal(rows[3]?.cells[1], '');
  const files = unzipSync(bytes);
  const sheet = decode(files['xl/worksheets/sheet1.xml']!);
  assert.ok(!sheet.includes('<f>'), 'no formula cell');
  assert.ok(
    sheet.includes('<c r="C2" s="3"><v>1250000</v></c>'),
    'money is a number with the thousands style',
  );
  assert.ok(sheet.includes('<c r="A2" s="4"><v>'), 'a date is a real date');
  assert.ok(sheet.includes('<pane ySplit="1"'), 'the header row is frozen');
  assert.ok(sheet.includes('<autoFilter ref="A1:E4"/>'));
  const styles = decode(files['xl/styles.xml']!);
  assert.ok(styles.includes('numFmtId="10"'), 'percent');
});

test('XLSX: text starting with = + - @ stays an inline string (never evaluated), XML specials and control characters are safe', () => {
  const bytes = toXlsx([
    {
      name: 'a',
      columns: [{ header: 'Giá trị <&>', kind: 'text' }],
      rows: [
        ['=1+1'],
        ['+84901234567'],
        ['A & B < C > "D"'],
        ['  khoảng trắng  '],
        ['x\u0001y'],
        ['dòng 1\ndòng 2'],
      ],
    },
  ]);
  const rows = readRows(bytes, 'x.xlsx');
  assert.deepEqual(
    rows.map((row) => row.cells[0]),
    [
      'Giá trị <&>',
      '=1+1',
      '+84901234567',
      'A & B < C > "D"',
      'khoảng trắng',
      'xy',
      'dòng 1\ndòng 2',
    ],
  );
  const xml = decode(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);
  assert.ok(xml.includes('t="inlineStr"') && !xml.includes(' t="str"') && !xml.includes('<f>'));
  assert.ok(xml.includes('<t xml:space="preserve">  khoảng trắng  </t>'));
});

test('XLSX: more than one sheet, names made safe and unique; integers beyond 2^53 stay text; 40,000 rows stream', () => {
  assert.equal(sheetName('Báo cáo: doanh thu/quý [1]?'), 'Báo cáo  doanh thu quý  1');
  assert.equal(sheetName('a'.repeat(40)).length, 31);
  assert.equal(sheetName(''), 'Sheet');
  assert.equal(sheetName('Dữ liệu', new Set(['dữ liệu'])), 'Dữ liệu 2');
  assert.equal(xmlEscape('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  const big: (string | number | bigint)[][] = [];
  for (let n = 1; n <= 40_000; n += 1) big.push([`Dòng ${n}`, n * 1000, BigInt(n)]);
  const bytes = toXlsx([
    {
      name: 'Dữ liệu',
      columns: [
        { header: 'Tên', kind: 'text' },
        { header: 'Tiền', kind: 'money' },
        { header: 'N', kind: 'int' },
      ],
      rows: big,
    },
    { name: 'Dữ liệu', columns: [{ header: 'Lớn', kind: 'money' }], rows: [[2n ** 60n]] },
  ]);
  const files = unzipSync(bytes);
  assert.ok(files['xl/worksheets/sheet2.xml']);
  assert.ok(decode(files['xl/workbook.xml']!).includes('name="Dữ liệu 2"'));
  assert.ok(decode(files['xl/worksheets/sheet2.xml']!).includes('1152921504606846976</t>'));
  const sheet1 = decode(files['xl/worksheets/sheet1.xml']!);
  assert.ok(sheet1.includes('<row r="40001">'));
  assert.ok(sheet1.includes('<autoFilter ref="A1:C40001"/>'));
  assert.ok(bytes.length < 3_000_000, `compressed ${bytes.length}`);
});

test('an empty workbook is refused; a sheet with only a header is a valid file', () => {
  assert.throws(() => toXlsx([]));
  const bytes = toXlsx([{ name: 'a', columns: [{ header: 'Tên', kind: 'text' }], rows: [] }]);
  const files = unzipSync(bytes);
  assert.ok(decode(files['xl/worksheets/sheet1.xml']!).includes('<autoFilter ref="A1:A1"/>'));
  assert.equal(
    decode(toCsv({ name: 'a', columns: [{ header: 'Tên', kind: 'text' }], rows: [] })),
    '\uFEFFTên\r\n',
  );
});
