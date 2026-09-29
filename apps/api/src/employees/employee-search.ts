import type { Prisma } from '@lucy-spa/database';

/**
 * Case- and diacritic-insensitive folding for Vietnamese names and employee codes:
 * "Trần Hoàng Anh Thư" -> "tran hoang anh thu", "Đặng" -> "dang". Input is NFC-normalized
 * first so precomposed and decomposed spellings (different IMEs) fold identically.
 */
export function foldSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'd')
    .toLowerCase()
    .normalize('NFC');
}

// Every precomposed Vietnamese letter (lower case) with its folded base, derived from
// `foldSearch` so the SQL translation below can never disagree with the JavaScript fold.
const FROM = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ';
const TO = [...FROM].map((letter) => foldSearch(letter)).join('');

/** Terms of the folded query (whitespace separated), for word-prefix matching. */
export function searchTokens(query: string): string[] {
  return foldSearch(query).split(/\s+/u).filter(Boolean);
}

const BACKSLASH = String.fromCharCode(92);

/** LIKE pattern for a literal fragment: backslash, percent and underscore are escaped. */
export function likeLiteral(value: string): string {
  return [...value]
    .map((char) => (char === BACKSLASH || char === '%' || char === '_' ? BACKSLASH + char : char))
    .join('');
}

/**
 * Employees matching a free-text query, resolved in PostgreSQL (never on a returned page):
 * the folded query, as a whole, is contained in the folded name or employee code; OR every
 * whitespace-separated term is the start of a word of the name or contained in the code.
 * So "trần h", "TRAN H" and "tran hoang" all find "LUCY01 – Trần Hoàng Anh Thư", while a
 * mid-word fragment still works through the whole-phrase rule. Only ids are returned; callers
 * keep applying authorization/hierarchy filters to them.
 *
 * The LIKE patterns are built in JavaScript (escaped there) and passed as bound parameters;
 * the escape character is declared with `ESCAPE` through a parameter-free literal.
 */
export async function searchEmployeeIds(
  tx: Prisma.TransactionClient,
  query: string,
): Promise<string[]> {
  const folded = foldSearch(query).trim().replace(/\s+/gu, ' ');
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const phrase = `%${likeLiteral(folded)}%`;
  const wordPrefixes = tokens.map((term) => `% ${likeLiteral(term)}%`);
  const inCode = tokens.map((term) => `%${likeLiteral(term)}%`);
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH candidate AS (
      SELECT u.id,
        ' ' || translate(lower(normalize(u.full_name, NFC)), ${FROM}, ${TO}) AS name,
        translate(lower(normalize(e.employee_code_canonical, NFC)), ${FROM}, ${TO}) AS code
      FROM users u JOIN employee_profiles e ON e.user_id = u.id
      WHERE u.kind = 'EMPLOYEE'
    )
    SELECT id FROM candidate
    WHERE name LIKE ${phrase} OR code LIKE ${phrase}
      OR NOT EXISTS (
        SELECT 1 FROM unnest(${wordPrefixes}::text[], ${inCode}::text[]) AS t(word_pattern, code_pattern)
        WHERE NOT (name LIKE t.word_pattern OR code LIKE t.code_pattern)
      )
    ORDER BY id`;
  return rows.map((row) => row.id);
}
