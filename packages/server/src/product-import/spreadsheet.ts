import { unzipSync, type UnzipFileInfo } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

/**
 * Phase 6 P6-5: reading an uploaded product file (.xlsx or .csv) into rows of text. Pure: no database, no network, hard limits.
 *
 * - `.xlsx` is a zip of XML parts. Only the workbook, its relations, the shared strings, the styles and ONE sheet (the first) are
 *   inflated, and every entry's declared size is checked before it is inflated (a zip bomb stops at the cap). A document type or an
 *   entity declaration in any part is refused (no entity expansion, nothing external is ever read).
 * - Cells become text exactly as a person reads them: shared, inline and rich-text strings; numbers without float noise; a cell
 *   styled as a date becomes `YYYY-MM-DD` (the 1900 and 1904 date systems, including Excel's fake 29 February 1900).
 * - `.csv` is decoded as strict UTF-8 (a BOM is dropped); the delimiter is `,`, `;` or a tab; quoted fields may hold commas, quotes
 *   and line breaks. The old `.xls` format is refused with a clear reason.
 * - The first non-empty row is the header. Every row keeps its number in the sheet (header = its own number), so a message can say
 *   "dòng 7" and the person finds it.
 */
export const IMPORT_LIMITS = Object.freeze({
  /** Same ceiling as an image upload, which is known to pass the production proxy. Smaller on purpose. */
  maxBytes: 5 * 1024 * 1024,
  maxRows: 2_000,
  maxColumns: 60,
  maxUnzippedBytes: 24 * 1024 * 1024,
});

export type SpreadsheetFailure =
  | 'too_large'
  | 'xls'
  | 'unsupported'
  | 'corrupt'
  | 'encoding'
  | 'empty'
  | 'too_many_rows'
  | 'too_many_columns';

export class SpreadsheetError extends Error {
  constructor(readonly reason: SpreadsheetFailure) {
    super(`The file cannot be read: ${reason}`);
    this.name = 'SpreadsheetError';
  }
}

export interface SheetRow {
  /** The number of the row in the sheet (the header counts: the first data row is usually 2). */
  rowNo: number;
  cells: string[];
}
export interface ParsedSheet {
  header: SheetRow;
  rows: SheetRow[];
}

const text = (value: string) => value.replace(/ /g, ' ').trim();

/** Every row of the file as text, before the header and the limits on rows are applied. */
export function readRows(bytes: Uint8Array, filename: string): SheetRow[] {
  if (bytes.length === 0) throw new SpreadsheetError('empty');
  if (bytes.length > IMPORT_LIMITS.maxBytes) throw new SpreadsheetError('too_large');
  const lower = filename.toLowerCase();
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (ole || lower.endsWith('.xls')) throw new SpreadsheetError('xls');
  if (zip) return readXlsx(bytes);
  if (lower.endsWith('.xlsx')) throw new SpreadsheetError('corrupt');
  if (!lower.endsWith('.csv') && !lower.endsWith('.txt')) throw new SpreadsheetError('unsupported');
  return readCsv(bytes);
}

export function readSpreadsheet(bytes: Uint8Array, filename: string): ParsedSheet {
  return finish(readRows(bytes, filename));
}

function finish(rows: SheetRow[]): ParsedSheet {
  const filled = rows.filter((row) => row.cells.some((cell) => cell !== ''));
  const header = filled[0];
  if (!header || filled.length < 2) throw new SpreadsheetError('empty');
  const data = filled.slice(1);
  if (data.length > IMPORT_LIMITS.maxRows) throw new SpreadsheetError('too_many_rows');
  const widest = Math.max(...filled.map((row) => row.cells.length));
  if (widest > IMPORT_LIMITS.maxColumns) throw new SpreadsheetError('too_many_columns');
  return { header, rows: data };
}

// ------------------------------------------------------------------------------------------------------------- CSV

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new SpreadsheetError('encoding');
  }
}

/** The delimiter that splits the first line into the most fields (quotes respected). */
function delimiterOf(source: string): string {
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t']) {
    let count = 0;
    let quoted = false;
    for (const char of source) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && (char === '\n' || char === '\r')) break;
      else if (!quoted && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function readCsv(bytes: Uint8Array): SheetRow[] {
  const source = decodeUtf8(bytes);
  const delimiter = delimiterOf(source);
  const rows: SheetRow[] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;
  let recordNo = 1;
  const endField = () => {
    record.push(text(field));
    field = '';
  };
  const endRecord = () => {
    endField();
    rows.push({ rowNo: recordNo, cells: record });
    record = [];
    recordNo += 1;
    started = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
    } else if (char === '"' && field === '') {
      quoted = true;
      started = true;
    } else if (char === delimiter) {
      endField();
      started = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      if (started || field !== '' || record.length > 0) endRecord();
      else recordNo += 1;
    } else {
      field += char;
      started = true;
    }
    if (rows.length > IMPORT_LIMITS.maxRows + 50) throw new SpreadsheetError('too_many_rows');
  }
  if (quoted) throw new SpreadsheetError('corrupt');
  if (started || field !== '' || record.length > 0) endRecord();
  return rows;
}

// ------------------------------------------------------------------------------------------------------------ XLSX

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  removeNSPrefix: true,
  ignoreDeclaration: true,
  processEntities: true,
  isArray: (name) =>
    ['si', 'r', 'c', 'row', 'sheet', 'Relationship', 'xf', 'numFmt'].includes(name),
});

type Node = Record<string, unknown>;

function parsePart(files: Record<string, Uint8Array>, name: string): Node | null {
  const bytes = files[name];
  if (!bytes) return null;
  const source = new TextDecoder('utf-8').decode(bytes);
  // No document type, no entity declaration: nothing to expand and nothing external to fetch.
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new SpreadsheetError('corrupt');
  try {
    return xml.parse(source) as Node;
  } catch {
    throw new SpreadsheetError('corrupt');
  }
}

/** Inflates only the named parts; the declared size of every entry is checked first. */
function unzipParts(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter: (file: UnzipFileInfo) => {
        if (!wanted(file.name)) return false;
        total += file.originalSize;
        if (
          file.originalSize > IMPORT_LIMITS.maxUnzippedBytes ||
          total > IMPORT_LIMITS.maxUnzippedBytes
        ) {
          throw new SpreadsheetError('too_large');
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof SpreadsheetError) throw error;
    throw new SpreadsheetError('corrupt');
  }
}

const asNode = (value: unknown): Node =>
  value && typeof value === 'object' ? (value as Node) : {};
const asList = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
/** The text of an element: plain, or with attributes (`xml:space`). */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const inner = (value as Node)['#text'];
    return typeof inner === 'string' ? inner : '';
  }
  return '';
}
/** A shared or inline string item: its plain text, or the runs of a rich text; phonetic runs are not text. */
function stringItem(item: unknown): string {
  const node = asNode(item);
  if (node['t'] !== undefined) return textOf(node['t']);
  return asList(node['r'])
    .map((run) => textOf(asNode(run)['t']))
    .join('');
}

function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference.replace(/[0-9]/g, ''))
    index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);
function isDateFormat(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '');
  return /[ymd]/i.test(bare) && !/general/i.test(bare);
}

/** An Excel serial date as `YYYY-MM-DD` (empty for the day that never existed, 29 February 1900). */
export function excelSerialToIso(serial: number, date1904: boolean): string {
  const days = Math.floor(serial);
  let epoch: number;
  if (date1904) epoch = Date.UTC(1904, 0, 1);
  else if (days >= 61) epoch = Date.UTC(1899, 11, 30);
  else if (days >= 1 && days < 60) epoch = Date.UTC(1899, 11, 31);
  else return '';
  const moved = new Date(epoch + days * 86_400_000);
  return Number.isNaN(moved.getTime()) ? '' : moved.toISOString().slice(0, 10);
}

/** A number cell as text: whole numbers without a decimal point or exponent, others as Excel stored them. */
function numberText(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return text(raw);
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  return /e/i.test(raw) ? String(value) : raw.trim();
}

function readXlsx(bytes: Uint8Array): SheetRow[] {
  const head = unzipParts(
    bytes,
    (name) => name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels',
  );
  const workbook = parsePart(head, 'xl/workbook.xml');
  const rels = parsePart(head, 'xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new SpreadsheetError('corrupt');
  const book = asNode(workbook['workbook']);
  const first = asNode(asList(asNode(book['sheets'])['sheet'])[0]);
  const relationId = first['@_id'];
  if (typeof relationId !== 'string') throw new SpreadsheetError('corrupt');
  const relation = asList(asNode(rels['Relationships'])['Relationship'])
    .map(asNode)
    .find((entry) => entry['@_Id'] === relationId);
  const target = relation?.['@_Target'];
  if (typeof target !== 'string') throw new SpreadsheetError('corrupt');
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const date1904 = ['1', 'true'].includes(String(asNode(book['workbookPr'])['@_date1904'] ?? ''));

  const files = unzipParts(
    bytes,
    (name) => name === sheetPath || name === 'xl/sharedStrings.xml' || name === 'xl/styles.xml',
  );
  const shared = asList(
    asNode(asNode(parsePart(files, 'xl/sharedStrings.xml') ?? {})['sst'])['si'],
  ).map(stringItem);
  const styles = asNode(asNode(parsePart(files, 'xl/styles.xml') ?? {})['styleSheet']);
  const customDate = new Set(
    asList(asNode(styles['numFmts'])['numFmt'])
      .map(asNode)
      .filter((format) => isDateFormat(String(format['@_formatCode'] ?? '')))
      .map((format) => Number(format['@_numFmtId'])),
  );
  const dateStyle = asList(asNode(styles['cellXfs'])['xf']).map((entry) => {
    const id = Number(asNode(entry)['@_numFmtId']);
    return BUILTIN_DATE_FORMATS.has(id) || customDate.has(id);
  });

  const sheet = parsePart(files, sheetPath);
  if (!sheet) throw new SpreadsheetError('corrupt');
  const rows: SheetRow[] = [];
  let sequence = 0;
  for (const row of asList(asNode(asNode(asNode(sheet['worksheet'])['sheetData']))['row']).map(
    asNode,
  )) {
    sequence += 1;
    const rowNo = Number(row['@_r']) || sequence;
    const cells: string[] = [];
    let next = 0;
    for (const cell of asList(row['c']).map(asNode)) {
      const reference = String(cell['@_r'] ?? '');
      const index = reference ? columnIndex(reference) : next;
      next = index + 1;
      if (index < 0 || index >= IMPORT_LIMITS.maxColumns * 2) continue;
      const kind = String(cell['@_t'] ?? 'n');
      const value = textOf(cell['v']);
      let out = '';
      if (kind === 's') out = shared[Number(value)] ?? '';
      else if (kind === 'inlineStr') out = stringItem(cell['is']);
      else if (kind === 'str') out = value;
      else if (kind === 'b') out = value === '1' ? 'true' : 'false';
      else if (kind === 'e') out = '';
      else if (value !== '') {
        const style = Number(cell['@_s'] ?? 0);
        out = dateStyle[style] ? excelSerialToIso(Number(value), date1904) : numberText(value);
      }
      while (cells.length <= index) cells.push('');
      cells[index] = text(out);
    }
    rows.push({ rowNo, cells });
  }
  return rows;
}
