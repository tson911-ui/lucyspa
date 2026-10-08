import {
  PRODUCT_RETURN_WINDOW_HOURS,
  type ProductReturnReasonName,
  type ProductReturnWindowStatus,
} from '@lucy-spa/contracts';

/**
 * Phase 6 P6-12 (T23, OQ-22, OQ-40): the return windows. The clock starts at hand-over to the customer; for an in-stock counter
 * sale (the only sale before the pre-order Steps) that is the invoice's paid time. A personal-preference return has 7 days (168
 * elapsed hours, not calendar days), a wrong or damaged product 48 hours; a skin-irritation case has no window (case by case, PRD
 * 28.3). The end of the window is inclusive: a case opened at exactly 48 hours is still inside. After it, the reason is refused with no
 * override (T23). The database derives the same end as a CHECK, so a request can never invent a longer window.
 */
const HOUR_MS = 3_600_000;

export function windowEndsAt(reason: ProductReturnReasonName, handoverAt: Date): Date | null {
  if (reason === 'SKIN_IRRITATION') return null;
  return new Date(handoverAt.getTime() + PRODUCT_RETURN_WINDOW_HOURS[reason] * HOUR_MS);
}

export function windowStatus(
  reason: ProductReturnReasonName,
  handoverAt: Date,
  now: Date,
): ProductReturnWindowStatus {
  const end = windowEndsAt(reason, handoverAt);
  return {
    open: end === null || now.getTime() <= end.getTime(),
    endsAt: end === null ? null : end.toISOString(),
  };
}

export const RETURN_REASONS = [
  'PERSONAL_PREFERENCE',
  'WRONG_OR_DAMAGED',
  'SKIN_IRRITATION',
] as const satisfies readonly ProductReturnReasonName[];

/**
 * Whether the photo requirement of WRONG_OR_DAMAGED is met: at least one photo that is still present and was taken (uploaded) inside
 * the 48 hours. Other reasons need no photo to be decided. A case the Owner opened after its window (an exception) was opened when that
 * window was already over, so any photo that is still present counts.
 */
export function hasQualifyingPhoto(
  reason: ProductReturnReasonName,
  windowEnd: Date | null,
  photos: readonly { uploadedAt: Date; removedAt: Date | null }[],
  windowException = false,
): boolean {
  if (reason !== 'WRONG_OR_DAMAGED') return true;
  if (windowException) return photos.some((photo) => photo.removedAt === null);
  if (windowEnd === null) return false;
  return photos.some(
    (photo) => photo.removedAt === null && photo.uploadedAt.getTime() <= windowEnd.getTime(),
  );
}
