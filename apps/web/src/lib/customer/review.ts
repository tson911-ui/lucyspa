import type { CustomerReviewRequest } from '@lucy-spa/contracts';
import { ApiError } from '../api/client';

/**
 * Phase 8 P8-17: the logic behind the review card of the customer's paid-invoice page, apart from the markup. The rating of a person is "0" while
 * skipped; only 1 to 5 is sent. The note is trimmed and left out when empty.
 */
export const STAR_CHOICES = ['1', '2', '3', '4', '5'] as const;
export type StarChoice = (typeof STAR_CHOICES)[number];

export function reviewRequest(
  invoiceId: string,
  rating: StarChoice | '',
  comment: string,
  staff: Readonly<Record<string, StarChoice | '0'>>,
): CustomerReviewRequest | null {
  if (rating === '') return null;
  const note = comment.trim();
  return {
    invoiceId,
    rating: Number(rating),
    comment: note === '' ? null : note,
    staff: Object.entries(staff)
      .filter(([, value]) => value !== '0')
      .map(([employeeUserId, value]) => ({ employeeUserId, rating: Number(value) })),
  };
}

export type ReviewErrorKey = 'already' | 'unavailable' | 'invalid' | 'generic';

export function reviewErrorKey(error: unknown): ReviewErrorKey {
  if (!(error instanceof ApiError)) return 'generic';
  if (error.code === 'REVIEW_ALREADY_SUBMITTED') return 'already';
  if (error.code === 'REVIEW_NOT_AVAILABLE') return 'unavailable';
  if (error.code === 'VALIDATION_FAILED' || error.code === 'HTTP_400') return 'invalid';
  return 'generic';
}
