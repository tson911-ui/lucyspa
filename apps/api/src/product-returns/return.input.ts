import { AuthError } from '../auth/auth.error.js';

/**
 * Phase 6 P6-12: free-text parsing for return notes. A note is what was said and seen at the counter: trimmed, line breaks allowed,
 * no other control character, at most `max` characters; `null` when blank. (The inventory parser is the same rule with a fixed
 * limit of 500.)
 */
export function optionalNote(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.normalize('NFC').trim();
  if (text === '') return null;
  if ([...text].length > max || /[^\P{Cc}\n\r\t]/u.test(text)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return text;
}

export function requiredNote(value: unknown, field: string, max: number): string {
  const text = optionalNote(value, field, max);
  if (text === null) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}
