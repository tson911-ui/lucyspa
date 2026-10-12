import { strToU8, unzipSync, Zip, ZipDeflate } from 'fflate';

/**
 * Phase 8 P8-4 (docs/PHASE8_REPORTS.md section 6, P8-T9): taking a report out as a file. Pure: no database, no network.
 *
 * - **CSV**: UTF-8 with a byte-order mark (so Vietnamese opens correctly in Excel), comma delimiter, CRLF line ends. A TEXT cell that starts
 *   with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with an apostrophe (formula injection); the one exception is a phone number
 *   (`+84…`, digits only), which must stay as it is. Numbers are never prefixed.
 * - **XLSX**: a minimal SpreadsheetML workbook written as a stream over `fflate` (no new dependency). Text is always an inline STRING, never a
 *   formula; money and counts are numbers (money formatted `#,##0`), dates are real dates, a percentage is a fraction formatted `0.00%`. The
 *   header row is bold, frozen and filterable.
 */

export type ExportCell = string | number | bigint | Date | null;

export type ExportColumnKind = 'text' | 'int' | 'money' | 'date' | 'percent';

export interface ExportColumn {
  header: string;
  kind: ExportColumnKind;
}

export interface ExportSheet {
  /** Sheet name in Excel (31 characters at most, none of `[]:*?/\`). */
  name: string;
  columns: readonly ExportColumn[];
  rows: Iterable<readonly ExportCell[]>;
}

const PHONE = /^\+\d{6,15}$/;

/** A text cell that a spreadsheet could read as a formula starts with one of these. */
export function neutralizeFormula(text: string): string {
  if (text === '' || PHONE.test(text)) return text;
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** The calendar day of an instant held as a UTC date (the caller passes the branch business date as a UTC midnight). */
export function isoDay(date: Date): string {
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`;
}

// -------------------------------------------------------------------------------------------------------------- CSV

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvCell(cell: ExportCell, kind: ExportColumnKind): string {
  if (cell === null) return '';
  if (typeof cell === 'string') return csvField(neutralizeFormula(cell));
  if (cell instanceof Date) return isoDay(cell);
  if (kind === 'percent') return (Number(cell) * 100).toFixed(2);
  return String(cell);
}

export function toCsv(sheet: ExportSheet): Uint8Array {
  const lines: string[] = [sheet.columns.map((column) => csvField(column.header)).join(',')];
  for (const row of sheet.rows) {
    lines.push(
      row.map((cell, index) => csvCell(cell, sheet.columns[index]?.kind ?? 'text')).join(','),
    );
  }
  return strToU8(`\uFEFF${lines.join('\r\n')}\r\n`);
}

// ------------------------------------------------------------------------------------------------------------- XLSX

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function xmlEscape(text: string): string {
  return text
    .replace(XML_ILLEGAL, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Excel's sheet-name rules: at most 31 characters, none of []:*?/\, not empty, no leading/trailing apostrophe. */
export function sheetName(raw: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    raw
      .replace(/[[\]:*?/\\]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .trim()
      .slice(0, 31) || 'Sheet';
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
    const suffix = ` ${n}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  return name;
}

function columnLetters(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const STYLE = { header: 1, int: 2, money: 3, date: 4, percent: 5 } as const;

const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4E9EB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function textCell(ref: string, value: string, style?: number): string {
  const space = /^\s|\s$|\n/.test(value) ? ' xml:space="preserve"' : '';
  const s = style === undefined ? '' : ` s="${style}"`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t${space}>${xmlEscape(value)}</t></is></c>`;
}

function dataCell(ref: string, cell: ExportCell, kind: ExportColumnKind): string {
  if (cell === null) return '';
  if (typeof cell === 'string') return textCell(ref, cell);
  if (cell instanceof Date) {
    return `<c r="${ref}" s="${STYLE.date}"><v>${Math.round((cell.getTime() - EXCEL_EPOCH) / 86_400_000)}</v></c>`;
  }
  const style =
    kind === 'money'
      ? STYLE.money
      : kind === 'percent'
        ? STYLE.percent
        : kind === 'int'
          ? STYLE.int
          : undefined;
  if (typeof cell === 'bigint') {
    // Excel numbers are doubles: an integer above 2^53 would lose digits, so it stays text.
    if (cell > 9_007_199_254_740_991n || cell < -9_007_199_254_740_991n)
      return textCell(ref, cell.toString());
    return `<c r="${ref}"${style === undefined ? '' : ` s="${style}"`}><v>${cell.toString()}</v></c>`;
  }
  if (!Number.isFinite(cell)) return '';
  return `<c r="${ref}"${style === undefined ? '' : ` s="${style}"`}><v>${String(cell)}</v></c>`;
}

const ROWS_PER_CHUNK = 2_000;

/** Writes the workbook as a zip, one sheet at a time, pushing the XML in chunks (memory stays near the size of the compressed file). */
export function toXlsx(sheets: readonly ExportSheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet');
  const parts: Uint8Array[] = [];
  let failure: Error | undefined;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else parts.push(chunk);
  });
  const put = (name: string, xml: string) => {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    file.push(strToU8(xml), true);
  };

  const taken = new Set<string>();
  const names = sheets.map((sheet) => {
    const name = sheetName(sheet.name, taken);
    taken.add(name.toLowerCase());
    return name;
  });

  put(
    '[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map(
        (_sheet, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join(
        '',
      )}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  put(
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  put(
    'xl/workbook.xml',
    `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${names
      .map(
        (name, index) =>
          `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join('')}</sheets></workbook>`,
  );
  put(
    'xl/_rels/workbook.xml.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_sheet, index) =>
          `<Relationship Id="rId${index + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join(
        '',
      )}<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`,
  );
  put('xl/styles.xml', STYLES_XML);

  sheets.forEach((sheet, sheetIndex) => {
    const file = new ZipDeflate(`xl/worksheets/sheet${sheetIndex + 1}.xml`, { level: 6 });
    zip.add(file);
    const widths = sheet.columns.map((column) =>
      Math.min(60, Math.max(10, column.header.length + 2)),
    );
    const lastColumn = columnLetters(Math.max(0, sheet.columns.length - 1));
    file.push(
      strToU8(
        `${XML_HEAD}<worksheet xmlns="${NS_MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths
          .map(
            (width, index) =>
              `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
          )
          .join('')}</cols><sheetData><row r="1" ht="22" customHeight="1">${sheet.columns
          .map((column, index) => textCell(`${columnLetters(index)}1`, column.header, STYLE.header))
          .join('')}</row>`,
      ),
      false,
    );
    let rowNo = 1;
    let buffer: string[] = [];
    for (const row of sheet.rows) {
      rowNo += 1;
      buffer.push(
        `<row r="${rowNo}">${row
          .map((cell, index) =>
            dataCell(`${columnLetters(index)}${rowNo}`, cell, sheet.columns[index]?.kind ?? 'text'),
          )
          .join('')}</row>`,
      );
      if (buffer.length >= ROWS_PER_CHUNK) {
        file.push(strToU8(buffer.join('')), false);
        buffer = [];
      }
    }
    if (buffer.length > 0) file.push(strToU8(buffer.join('')), false);
    file.push(
      strToU8(`</sheetData><autoFilter ref="A1:${lastColumn}${Math.max(1, rowNo)}"/></worksheet>`),
      true,
    );
  });
  zip.end();
  if (failure) throw failure;
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The parts of a workbook by name (for tests that look inside a file that was written). */
export function readZipParts(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}
