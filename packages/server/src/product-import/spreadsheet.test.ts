import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { excelSerialToIso, readSpreadsheet, SpreadsheetError } from './spreadsheet.js';

const bytes = (value: string) => strToU8(value);

/** A workbook written by hand, the way Excel lays it out (not by this repo's own writer). */
function workbook(options: {
  sheet: string;
  shared?: string;
  styles?: string;
  date1904?: boolean;
  extra?: Record<string, Uint8Array>;
}): Uint8Array {
  return zipSync({
    'xl/workbook.xml': bytes(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${options.date1904 ? ' date1904="1"' : ''}/><sheets><sheet name="Dữ liệu" sheetId="1" r:id="rId7"/><sheet name="Hướng dẫn" sheetId="2" r:id="rId8"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': bytes(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId8" Type="x" Target="worksheets/sheet2.xml"/><Relationship Id="rId7" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': bytes(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${options.sheet}</sheetData></worksheet>`,
    ),
    'xl/worksheets/sheet2.xml': bytes(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>KHÔNG ĐỌC</t></is></c></row></sheetData></worksheet>`,
    ),
    ...(options.shared ? { 'xl/sharedStrings.xml': bytes(options.shared) } : {}),
    ...(options.styles ? { 'xl/styles.xml': bytes(options.styles) } : {}),
    ...options.extra,
  });
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

test('reads shared, inline and rich-text strings, numbers and sparse cells with their sheet row numbers', () => {
  const shared = `<sst ${NS}><si><t>sku</t></si><si><t>name_vi</t></si><si><r><rPr><b/></rPr><t>Kem </t></r><r><t>dưỡng</t></r><rPh><t>PHONETIC</t></rPh></si><si><t xml:space="preserve"> SP-1 </t></si></sst>`;
  const sheet =
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>price</t></is></c></row>` +
    `<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" t="s"><v>2</v></c><c r="D3"><v>150000</v></c></row>` +
    `<row r="4"><c r="A4" t="inlineStr"><is><r><t>SP</t></r><r><t>-2</t></r></is></c><c r="D4"><v>1.5E+5</v></c></row>`;
  const parsed = readSpreadsheet(workbook({ sheet, shared }), 'file.xlsx');
  assert.deepEqual(parsed.header, { rowNo: 1, cells: ['sku', 'name_vi', '', 'price'] });
  assert.deepEqual(parsed.rows, [
    { rowNo: 3, cells: ['SP-1', 'Kem dưỡng', '', '150000'] },
    { rowNo: 4, cells: ['SP-2', '', '', '150000'] },
  ]);
});

test('a date-styled cell becomes an ISO date, in both date systems, and the fake 29 February 1900 is not a date', () => {
  const styles = `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>`;
  const sheet =
    `<row r="1"><c r="A1" t="inlineStr"><is><t>expiry</t></is></c></row>` +
    `<row r="2"><c r="A2" s="1"><v>46023</v></c></row>` +
    `<row r="3"><c r="A3" s="2"><v>46023.5</v></c></row>` +
    `<row r="4"><c r="A4" s="0"><v>46023</v></c></row>` +
    `<row r="5"><c r="A5" s="1"><v>60</v></c></row>`;
  const parsed = readSpreadsheet(workbook({ sheet, styles }), 'a.xlsx');
  assert.deepEqual(
    parsed.rows.map((row) => row.cells[0]),
    ['2026-01-01', '2026-01-01', '46023'],
  );
  assert.equal(excelSerialToIso(1, false), '1900-01-01');
  assert.equal(excelSerialToIso(59, false), '1900-02-28');
  assert.equal(excelSerialToIso(61, false), '1900-03-01');
  assert.equal(excelSerialToIso(46023 - 1462, true), '2026-01-01');
});

test('booleans, formula strings and error cells', () => {
  const sheet =
    `<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="B1" t="inlineStr"><is><t>b</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row>` +
    `<row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2" t="str"><f>A1</f><v>kết quả</v></c><c r="C2" t="e"><v>#DIV/0!</v></c></row>`;
  assert.deepEqual(readSpreadsheet(workbook({ sheet }), 'a.xlsx').rows[0]?.cells, [
    'true',
    'kết quả',
    '',
  ]);
});

test('only the first sheet is read', () => {
  const sheet = `<row r="1"><c r="A1" t="inlineStr"><is><t>sku</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>X</t></is></c></row>`;
  const parsed = readSpreadsheet(workbook({ sheet }), 'a.xlsx');
  assert.deepEqual(parsed.rows, [{ rowNo: 2, cells: ['X'] }]);
});

test('a document type or entity declaration is refused (no entity expansion)', () => {
  const sheet = `<row r="1"><c r="A1" t="inlineStr"><is><t>sku</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>X</t></is></c></row>`;
  const evil = workbook({
    sheet,
    shared: `<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><sst ${NS}><si><t>&b;</t></si></sst>`,
  });
  assert.throws(() => readSpreadsheet(evil, 'a.xlsx'), { reason: 'corrupt' });
});

test('a zip entry that declares too large a size is refused before it is inflated', () => {
  const huge = new Uint8Array(30 * 1024 * 1024);
  const sheet = `<row r="1"><c r="A1" t="inlineStr"><is><t>sku</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>X</t></is></c></row>`;
  const bomb = workbook({ sheet, shared: '', extra: { 'xl/sharedStrings.xml': huge } });
  assert.ok(bomb.length < 5 * 1024 * 1024, 'the compressed file passes the byte cap');
  assert.throws(() => readSpreadsheet(bomb, 'a.xlsx'), { reason: 'too_large' });
});

test('refuses the old .xls format, wrong types, empty files, a broken zip and too many rows', () => {
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.throws(() => readSpreadsheet(ole, 'a.xlsx'), { reason: 'xls' });
  assert.throws(() => readSpreadsheet(bytes('x'), 'a.xls'), { reason: 'xls' });
  assert.throws(() => readSpreadsheet(bytes('x'), 'a.pdf'), { reason: 'unsupported' });
  assert.throws(() => readSpreadsheet(new Uint8Array(0), 'a.csv'), { reason: 'empty' });
  assert.throws(() => readSpreadsheet(bytes('not a zip'), 'a.xlsx'), { reason: 'corrupt' });
  assert.throws(() => readSpreadsheet(bytes('sku\n'), 'a.csv'), { reason: 'empty' });
  const many = 'sku\n' + Array.from({ length: 2001 }, (_, i) => `S${i}`).join('\n');
  assert.throws(() => readSpreadsheet(bytes(many), 'a.csv'), { reason: 'too_many_rows' });
  assert.ok(new SpreadsheetError('xls') instanceof Error);
});

test('csv: BOM, semicolons, quoted fields with commas, quotes and line breaks, CRLF, a blank line keeps the row number (a quoted line break stays in one row, as in Excel)', () => {
  const source =
    '﻿sku;name_vi;description_vi\r\n' +
    'A-1;"Kem; dưỡng ""da""";"dòng 1\r\ndòng 2"\r\n' +
    '\r\n' +
    'A-2;Sữa;\r\n';
  const parsed = readSpreadsheet(bytes(source), 'file.csv');
  assert.deepEqual(parsed.header, { rowNo: 1, cells: ['sku', 'name_vi', 'description_vi'] });
  assert.deepEqual(parsed.rows, [
    { rowNo: 2, cells: ['A-1', 'Kem; dưỡng "da"', 'dòng 1\r\ndòng 2'] },
    { rowNo: 4, cells: ['A-2', 'Sữa', ''] },
  ]);
});

test('csv: comma and tab delimiters are detected; invalid UTF-8 and an open quote are refused', () => {
  assert.deepEqual(readSpreadsheet(bytes('sku,qty\nA,1'), 'a.csv').rows[0]?.cells, ['A', '1']);
  assert.deepEqual(readSpreadsheet(bytes('sku\tqty\nA\t1'), 'a.csv').rows[0]?.cells, ['A', '1']);
  assert.throws(
    () => readSpreadsheet(new Uint8Array([0x73, 0x6b, 0x75, 0x0a, 0xe9, 0x0a]), 'a.csv'),
    {
      reason: 'encoding',
    },
  );
  assert.throws(() => readSpreadsheet(bytes('sku\n"open'), 'a.csv'), { reason: 'corrupt' });
});
