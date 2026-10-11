import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  buildZip,
  IMAGE_ZIP_LIMITS,
  ImageZipError,
  isPictureEntry,
  oversizedPictureNames,
  pictureNameGuesses,
  readImageZip,
} from './image-zip.js';
import { buildTemplate } from './template.js';

const text = (value: string) => new TextEncoder().encode(value);

test('only picture files count: folders, system files and other types are left out', () => {
  assert.equal(isPictureEntry('WHOO001-1.jpg'), true);
  assert.equal(isPictureEntry('photos/WHOO001-1.JPEG'), true);
  assert.equal(isPictureEntry('a.webp'), true);
  assert.equal(isPictureEntry('photos/'), false);
  assert.equal(isPictureEntry('notes.txt'), false);
  assert.equal(isPictureEntry('__MACOSX/._a.png'), false);
  assert.equal(isPictureEntry('x/__MACOSX/a.png'), false);
  assert.equal(isPictureEntry('.hidden.png'), false);
  assert.equal(isPictureEntry('a.gif'), false);
});

test('a file name has the readings SKU + number first, the whole stem second', () => {
  assert.deepEqual(pictureNameGuesses('WHOO001-2.jpg'), [
    { sku: 'WHOO001', position: 2 },
    { sku: 'WHOO001-2', position: 1 },
  ]);
  assert.deepEqual(pictureNameGuesses('whoo001.png'), [{ sku: 'WHOO001', position: 1 }]);
  assert.deepEqual(pictureNameGuesses('A_B_3.webp'), [
    { sku: 'A_B', position: 3 },
    { sku: 'A_B_3', position: 1 },
  ]);
  assert.deepEqual(
    pictureNameGuesses('X-0.png'),
    [{ sku: 'X-0', position: 1 }],
    'position 0 is not a position',
  );
  assert.deepEqual(pictureNameGuesses('.png'), []);
});

test('an archive is read into picture entries by name only (a folder never becomes a path)', () => {
  const zip = buildZip({
    'a/WHOO001-1.png': text('one'),
    '../../evil-2.jpg': text('two'),
    'readme.txt': text('x'),
  });
  const names = readImageZip(zip)
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(names, ['WHOO001-1.png', 'evil-2.jpg']);
});

test('refusals: empty, not a zip, too many pictures, too much declared inside, an oversized picture is named', () => {
  assert.throws(
    () => readImageZip(new Uint8Array()),
    (error) => error instanceof ImageZipError && error.reason === 'empty',
  );
  assert.throws(
    () => readImageZip(text('not a zip')),
    (error) => error instanceof ImageZipError && error.reason === 'corrupt',
  );
  assert.throws(
    () => readImageZip(buildZip({ 'a.txt': text('x') })),
    (error) => error instanceof ImageZipError && error.reason === 'empty',
  );
  const many: Record<string, Uint8Array> = {};
  for (let index = 0; index <= IMAGE_ZIP_LIMITS.maxFiles; index += 1)
    many[`p${index}.png`] = text('x');
  assert.throws(
    () => readImageZip(buildZip(many)),
    (error) => error instanceof ImageZipError && error.reason === 'too_many_files',
  );
  const big = buildZip({
    'BIG-1.png': new Uint8Array(IMAGE_ZIP_LIMITS.maxFileBytes + 1),
    'ok-1.png': text('ok'),
  });
  assert.deepEqual(oversizedPictureNames(big), ['BIG-1.png']);
  assert.deepEqual(
    readImageZip(big).map((entry) => entry.name),
    ['ok-1.png'],
    'the oversized picture is never inflated into the result',
  );
});

test('the price export fills the data sheet and the csv, in the order of the columns', () => {
  const rows = [
    ['KEM-1', 'Kem "A", 50 ml', '350000'],
    ['KEM-2', 'Serum', ''],
  ];
  const csv = strFromU8(buildTemplate('PRICE_UPDATE', 'csv', 'vi', rows).bytes).replace('﻿', '');
  assert.equal(
    csv,
    'Mã SKU,Tên sản phẩm,Giá bán (₫)\r\nKEM-1,"Kem ""A"", 50 ml",350000\r\nKEM-2,Serum,\r\n',
  );
  const header = strFromU8(buildTemplate('PRICE_UPDATE', 'csv', 'vi').bytes).replace('﻿', '');
  assert.equal(header, 'Mã SKU,Tên sản phẩm,Giá bán (₫)\r\n', 'the template has the header only');
  const file = buildTemplate('PRICE_UPDATE', 'xlsx', 'en', rows);
  assert.equal(file.filename, 'price-list.xlsx');
  const sheet = strFromU8(unzipSync(file.bytes)['xl/worksheets/sheet1.xml']!);
  assert.ok(
    sheet.includes('KEM-1') &&
      sheet.includes('350000') &&
      sheet.includes('Kem &quot;A&quot;, 50 ml'),
  );
});
