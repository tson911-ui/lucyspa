import { PRODUCT_IMPORT_COLUMNS, type ProductImportKindName } from '@lucy-spa/contracts';
import { strToU8, zipSync } from 'fflate';
import { IMPORT_LIMITS } from './spreadsheet.js';

export type TemplateFormat = 'xlsx' | 'csv';
export type TemplateLanguage = 'vi' | 'en';

export interface TemplateFile {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

const TEXT = {
  vi: {
    data: 'Dữ liệu',
    guide: 'Hướng dẫn',
    column: 'Cột',
    required: 'Bắt buộc',
    note: 'Ghi chú',
    example: 'Ví dụ',
    yes: 'Có',
    no: 'Không',
    file: { CATALOG: 'mau-san-pham', OPENING_STOCK: 'mau-ton-dau-ky' },
    lines: (kind: ProductImportKindName) => [
      kind === 'CATALOG'
        ? 'Nhập sản phẩm và phân loại. Mỗi dòng là một phân loại (một SKU).'
        : 'Nhập số lượng tồn đầu kỳ cho một chi nhánh. Mỗi dòng là một lô của một phân loại.',
      'Sheet "Dữ liệu" chỉ có dòng tiêu đề: nhập dữ liệu từ dòng 2 và giữ nguyên tiêu đề.',
      'Không lưu gì cho đến khi bạn xem trước kết quả và bấm xác nhận.',
      `Tối đa ${IMPORT_LIMITS.maxRows.toLocaleString('vi-VN')} dòng và ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB mỗi tệp. Tệp .xlsx hoặc .csv (UTF-8).`,
      ...(kind === 'CATALOG'
        ? [
            'Cập nhật: ô để trống thì giữ nguyên giá trị hiện tại. Ô trống không xóa dữ liệu.',
            'Sản phẩm mới được tạo ở trạng thái nháp; đăng bán trong màn hình sản phẩm.',
          ]
        : [
            'Mỗi phân loại chỉ nhập tồn đầu kỳ một lần, khi chưa có nhập hay xuất kho tại chi nhánh.',
          ]),
    ],
  },
  en: {
    data: 'Data',
    guide: 'Guide',
    column: 'Column',
    required: 'Required',
    note: 'Note',
    example: 'Example',
    yes: 'Yes',
    no: 'No',
    file: { CATALOG: 'products-template', OPENING_STOCK: 'opening-stock-template' },
    lines: (kind: ProductImportKindName) => [
      kind === 'CATALOG'
        ? 'Import products and variants. One row is one variant (one SKU).'
        : 'Import opening stock for one branch. One row is one lot of one variant.',
      'The "Data" sheet holds the header row only: type from row 2 and keep the header.',
      'Nothing is saved until you review the preview and confirm.',
      `Up to ${IMPORT_LIMITS.maxRows.toLocaleString('en-US')} rows and ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB per file. .xlsx or .csv (UTF-8).`,
      ...(kind === 'CATALOG'
        ? [
            'Update: a blank cell keeps the current value. A blank never deletes data.',
            'New products are created as drafts; publish them on the products screen.',
          ]
        : ['A variant gets opening stock once, while it has no stock history at the branch.']),
    ],
  },
} as const;

/** Columns whose cells must stay text (a SKU or barcode of digits must not turn into a number). */
const TEXT_COLUMNS = new Set(['sku', 'product_key', 'barcode', 'lot_code']);

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const letters = (index: number) => {
  let out = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};

const cell = (reference: string, value: string, style: number) =>
  `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function csvField(value: string): string {
  return /[",\r\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildTemplate(
  kind: ProductImportKindName,
  format: TemplateFormat,
  language: TemplateLanguage,
): TemplateFile {
  const text = TEXT[language];
  const columns = PRODUCT_IMPORT_COLUMNS[kind];
  const base = text.file[kind];
  if (format === 'csv') {
    // A byte order mark so Excel opens the file as UTF-8. Header only: any example row would be imported as data.
    const line = columns.map((column) => csvField(column.header[language])).join(',');
    return {
      bytes: strToU8(`\uFEFF${line}\r\n`),
      filename: `${base}.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  }

  const header = columns
    .map((column, i) => cell(`${letters(i)}1`, column.header[language], 2))
    .join('');
  const cols = columns
    .map(
      (column, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${Math.max(14, column.header[language].length + 6)}" customWidth="1"${TEXT_COLUMNS.has(column.key) ? ' style="1"' : ''}/>`,
    )
    .join('');
  const dataSheet =
    `${DECLARATION}<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData><row r="1" ht="24" customHeight="1">${header}</row></sheetData></worksheet>`;

  const rows: string[] = [];
  let n = 1;
  for (const line of text.lines(kind)) {
    rows.push(`<row r="${n}">${cell(`A${n}`, line, 0)}</row>`);
    n += 1;
  }
  n += 1;
  const head = [text.column, text.required, text.note, text.example];
  rows.push(
    `<row r="${n}">${head.map((value, i) => cell(`${letters(i)}${n}`, value, 2)).join('')}</row>`,
  );
  for (const column of columns) {
    n += 1;
    const values = [
      column.header[language],
      column.required ? text.yes : text.no,
      column.note[language],
      column.example,
    ];
    rows.push(
      `<row r="${n}">${values.map((value, i) => cell(`${letters(i)}${n}`, value, i === 2 ? 3 : 0)).join('')}</row>`,
    );
  }
  const guideSheet =
    `${DECLARATION}<worksheet xmlns="${MAIN}"><cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="12" customWidth="1"/>` +
    `<col min="3" max="3" width="80" customWidth="1"/><col min="4" max="4" width="22" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData></worksheet>`;

  const styles =
    `${DECLARATION}<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1E9EA"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`;

  const parts: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `${DECLARATION}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${escapeXml(text.data)}" sheetId="1" r:id="rId1"/><sheet name="${escapeXml(text.guide)}" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(dataSheet),
    'xl/worksheets/sheet2.xml': strToU8(guideSheet),
  };
  return {
    bytes: zipSync(parts),
    filename: `${base}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
