import { PRODUCT_IMPORT_COLUMNS, type ProductImportKindName } from '@lucy-spa/contracts';

/** A header compared without case, accents, spaces or punctuation: "Giá bán (₫)" and "gia ban" are the same column. */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** The same header with any bracketed unit dropped: "Chờ tối thiểu (ngày)" also matches "chờ tối thiểu". */
function withoutBrackets(value: string): string {
  return normalizeHeader(value.replace(/\([^)]*\)|\[[^\]]*\]/g, ''));
}

export interface ColumnMap {
  /** Column key to the 0-based position in the file. */
  index: Record<string, number>;
  /** Headers of the file that match no column (ignored, reported as a warning). */
  unknown: string[];
  /** Required columns the file does not have. */
  missing: string[];
  /** Columns the file has more than once (the first one is used). */
  duplicated: string[];
}

export function mapColumns(kind: ProductImportKindName, header: readonly string[]): ColumnMap {
  const columns = PRODUCT_IMPORT_COLUMNS[kind];
  const names = new Map<string, string>();
  for (const column of columns) {
    for (const name of [column.key, column.header.vi, column.header.en]) {
      names.set(normalizeHeader(name), column.key);
    }
  }
  // The header without its unit is an alias only while it is unambiguous ("Phân loại (VI)" and "(EN)" must stay apart).
  const shortened = new Map<string, string[]>();
  for (const column of columns) {
    for (const name of [column.header.vi, column.header.en]) {
      const short = withoutBrackets(name);
      shortened.set(short, [...(shortened.get(short) ?? []), column.key]);
    }
  }
  for (const [short, keys] of shortened) {
    if (!names.has(short) && new Set(keys).size === 1) names.set(short, keys[0]!);
  }
  const index: Record<string, number> = {};
  const unknown: string[] = [];
  const duplicated: string[] = [];
  header.forEach((cell, position) => {
    if (cell === '') return;
    const key = names.get(normalizeHeader(cell)) ?? names.get(withoutBrackets(cell));
    if (key === undefined) unknown.push(cell);
    else if (Object.hasOwn(index, key)) duplicated.push(key);
    else index[key] = position;
  });
  const missing = columns
    .filter((column) => column.required && !Object.hasOwn(index, column.key))
    .map((column) => column.key);
  return { index, unknown, missing, duplicated };
}

/** One row of the file as `{ column key: text }` for the columns the file has. */
export function rowByColumn(map: ColumnMap, cells: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(map.index).map(([key, position]) => [key, cells[position] ?? '']),
  );
}
