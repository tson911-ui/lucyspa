import { HttpException } from '@nestjs/common';

const errors = {
  VALIDATION_FAILED: [400, 'Validation failed'],
  VERIFICATION_FAILED: [400, 'Verification failed; request a new code or restart registration'],
  AUTHENTICATION_FAILED: [401, 'Authentication failed'],
  AUTHENTICATION_REQUIRED: [401, 'Authentication required'],
  REQUEST_NOT_ALLOWED: [403, 'Request not allowed'],
  REAUTHENTICATION_REQUIRED: [403, 'Recent password confirmation required'],
  FORBIDDEN: [403, 'Forbidden'],
  NOT_FOUND: [404, 'Not found'],
  CONFLICT: [409, 'Conflict'],
  SERVICE_UNAVAILABLE: [503, 'Service unavailable'],
  RATE_LIMITED: [429, 'Too many requests'],
  // Phase 3 customer booking outcomes (stable, customer-safe; no engine internals).
  BOOKING_INVALID_TIME: [400, 'The branch is not open for this time'],
  BOOKING_OUTSIDE_HORIZON: [400, 'The date is outside the booking window'],
  BOOKING_SERVICE_UNAVAILABLE: [409, 'A service is not available at this branch'],
  BOOKING_CUSTOMER_CONFLICT: [409, 'You already have a booking at this time'],
  BOOKING_SLOT_UNAVAILABLE: [409, 'This time is no longer available'],
  BOOKING_KTV_UNAVAILABLE: [409, 'The chosen staff member is not available at this time'],
  BOOKING_NO_SUITABLE_KTV: [409, 'No suitable staff member is available at this time'],
  BOOKING_CANCEL_NOT_ALLOWED: [409, 'This booking can no longer be cancelled'],
  // Phase 3 Step 5 operational outcomes.
  BOOKING_ARRIVAL_TOO_EARLY: [409, 'The check-in window for this booking has not opened yet'],
  BOOKING_ARRIVAL_NOT_ALLOWED: [409, 'This booking can no longer be checked in'],
  BOOKING_HOLD_ACTIVE: [409, 'The late hold still protects this booking'],
  BOOKING_NO_SHOW_NOT_ALLOWED: [409, 'This booking cannot be marked as no-show'],
  QUEUE_ADVANCE_NOT_ALLOWED: [409, 'This visit cannot be advanced'],
  // Phase 3 Step 6 walk-in outcomes.
  WALKIN_NOT_ASSIGNABLE: [409, 'This visit no longer takes assignments'],
  WALKIN_LINE_NOT_WAITING: [409, 'Only a waiting service line can change its requested staff'],
  WALKIN_CANCEL_NOT_ALLOWED: [409, 'This walk-in can no longer be cancelled'],
  SERVICE_START_NOT_ALLOWED: [409, 'This service cannot be started'],
  SERVICE_END_NOT_ALLOWED: [409, 'This service has not started or cannot be ended'],
  SERVICE_SEQUENCE_BLOCKED: [409, 'Complete the preceding service first'],
  SERVICE_KTV_BUSY: [409, 'End the current service before starting another'],
  SERVICE_NOT_TODAY: [409, "Only today's service work can be started"],
  SERVICE_START_UNAVAILABLE: [409, 'Check attendance and operational availability before starting'],
  SERVICE_EARLY_START_CONFLICT: [
    409,
    'Cannot start early: the staff member has other work before the planned start',
  ],
  SERVICE_EARLY_START_OUTSIDE_SHIFT: [409, 'Cannot start early: outside the scheduled work shift'],
  SERVICE_EXECUTION_CONFLICT: [409, 'Service work changed; refresh and try again'],
  // Phase 4 Step 2: visit completion carryover.
  SERVICE_RESOLUTION_NOT_ALLOWED: [409, 'This service cannot be resolved'],
  SERVICE_LINE_CANCEL_NOT_ALLOWED: [409, 'This service line can no longer be cancelled'],
  REASSIGNMENT_NOT_ALLOWED: [409, 'Only assigned, unstarted service work can be reassigned'],
  REASSIGNMENT_CONFLICT: [409, 'The assignment changed; refresh and try again'],
  REASSIGNMENT_KTV_UNAVAILABLE: [409, 'The replacement is no longer eligible for this work'],
  REASSIGNMENT_SPECIFIC_ACK_REQUIRED: [
    400,
    'Explicit acknowledgement of the specific staff request is required',
  ],
  // Phase 4 Step 3: staff-added service.
  VISIT_LINE_ADD_NOT_ALLOWED: [409, 'A service can no longer be added to this visit'],
  // Phase 4 Step 5: invoice / POS.
  INVOICE_VISIT_NOT_COMPLETED: [409, 'Only a completed visit can be invoiced'],
  INVOICE_STATE_INVALID: [409, 'This invoice is not in a state that allows this action'],
  INVOICE_NOT_READY: [
    409,
    'Every service needs a price and a quantity before the invoice is finalized',
  ],
  INVOICE_CANCEL_NOT_ALLOWED: [409, 'This invoice cannot be cancelled here'],
  // Phase 4 Step 6: discounts / vouchers.
  VOUCHER_INVALID: [409, 'This voucher code cannot be used'],
  DISCOUNT_STATE_INVALID: [409, 'The discount program does not allow this change'],
  DISCOUNT_CODE_TAKEN: [409, 'This code is already in use'],
  // Phase 4 Step 7: cash / split payments and corrections.
  PAYMENT_METHOD_UNAVAILABLE: [400, 'This payment method is not available'],
  PAYMENT_AMOUNT_INVALID: [409, 'The amount is more than the remaining balance of the invoice'],
  PAYMENT_STATE_INVALID: [409, 'This payment cannot be reversed'],
  // Phase 4 Step 8: PayOS.
  PAYMENT_PROVIDER_PENDING: [
    409,
    'A PayOS payment request is waiting on this invoice; cancel it or wait for it to end',
  ],
  PAYMENT_REQUEST_STATE_INVALID: [409, 'This PayOS payment request is not waiting for payment'],
  PAYMENT_PROVIDER_UNAVAILABLE: [
    503,
    'The payment provider could not be reached; try again shortly',
  ],
  PAYMENT_PROVIDER_REJECTED: [502, 'The payment provider refused the request'],
  PAYMENT_ANOMALY_REVIEWED: [409, 'This payment anomaly was already reviewed'],
  INVOICE_NOTE_NOT_ALLOWED: [409, 'A management note is only for an invoice settled through PayOS'],
  // UX/UI Step 11: website media library (design 16.3). Shown verbatim by the uploader.
  MEDIA_TYPE_UNSUPPORTED: [415, 'Only JPEG, PNG or WebP images are accepted'],
  MEDIA_TOO_LARGE: [413, 'The image is larger than 10 MB'],
  MEDIA_DIMENSIONS_TOO_LARGE: [400, 'The image is larger than 6000 pixels on one side'],
  MEDIA_INVALID_IMAGE: [400, 'The file is not a valid still image'],
  MEDIA_IN_USE: [409, 'This image is used on the website and cannot be deleted'],
  // UX/UI Step 12: promotional popup (design 16.5). `POPUP_OVERLAP` names the conflicting popup's id as the field.
  MEDIA_ALT_REQUIRED: [409, 'Add a Vietnamese description to the image before using it'],
  POPUP_OVERLAP: [409, 'Another enabled popup already covers part of this time'],
  // UX/UI Step 13: homepage slider (design 16.6, Q-CM7).
  SLIDE_LIMIT: [409, 'At most 8 slides can be visible at the same time'],
  // UX/UI Step S3: seasonal themes (design 20.4). `SEASON_OVERLAP` names the conflicting season's id as the field.
  SEASON_OVERLAP: [409, 'Another enabled season already covers part of this time'],
  // Phase 5 P5-3: loyalty points and the Owner's go-live switch.
  LOYALTY_NOT_LIVE: [409, 'The loyalty programme has not been switched on yet'],
  LOYALTY_ALREADY_LIVE: [409, 'The loyalty programme is already switched on'],
  // The field carries the current balance as `balance<N>` so the screen can say "Số dư chỉ còn N điểm".
  LOYALTY_BALANCE_TOO_LOW: [409, 'A manual deduction cannot be larger than the balance'],
  LOYALTY_ENTRY_ALREADY_CORRECTED: [409, 'This ledger entry already has a correction'],
  // Phase 5 P5-5: referral (staff side only; public signup never reports any of these).
  REFERRAL_NOT_NEW: [
    409,
    'This customer already had a visit, so a referrer can no longer be recorded',
  ],
  REFERRAL_ALREADY_BOUND: [409, 'This customer already has a referrer'],
  REFERRAL_LOCKED: [409, 'The reward was already granted, so the referrer can no longer change'],
  REFERRAL_SELF: [400, 'A customer cannot refer themselves'],
  REFERRAL_SAME_REFERRER: [400, 'This is already the referrer'],
  // Phase 5 P5-7: combos.
  COMBO_NOT_SELLABLE: [409, 'This combo is not on sale'],
  COMBO_CHANGED: [409, 'The combo changed after this sale was started; start a new sale'],
  COMBO_SERVICE_INVALID: [409, 'A combo needs an active service'],
  // Phase 5 P5-8: using the sessions.
  COMBO_NOT_USABLE: [409, 'This combo cannot be used now'],
  COMBO_NO_SESSION_LEFT: [409, 'This combo has no session left'],
  COMBO_SERVICE_MISMATCH: [409, 'A combo can only be used for its own service'],
  COMBO_LINE_QUANTITY: [
    409,
    'A combo session pays one unit of the service: set the quantity to 1 first',
  ],
  COMBO_USE_NOT_RESTORABLE: [409, 'This use was already restored or released'],
  // Phase 5 P5-9: the gift / benefit catalog.
  REWARD_SERVICE_INVALID: [409, 'A free-service reward needs an active service'],
  REWARD_ITEM_INACTIVE: [409, 'This reward is not available to grant'],
  REWARD_NOT_USABLE: [409, 'This reward was revoked or has expired'],
  REWARD_NOTHING_LEFT: [409, 'This reward has no unit left'],
  REWARD_ALREADY_VOIDED: [409, 'This reward was already revoked'],
  REWARD_USE_NOT_RESTORABLE: [409, 'This use was already restored, or its reward was revoked'],
  // Phase 6 P6-3: the product catalog. Each one names a database rule of the P6-2 migrations.
  PRODUCT_STATUS_INVALID: [409, 'This product cannot move to that status'],
  PRODUCT_PUBLISH_INCOMPLETE: [409, 'A product is published only with an active, priced variant'],
  PRODUCT_LAST_PRICED_VARIANT: [
    409,
    'A published product keeps at least one active, priced variant',
  ],
  PRODUCT_PRICE_BELOW_PROMOTION: [
    409,
    'The list price must stay above the price of a promotion that has not ended',
  ],
  PRODUCT_PROMOTION_PRICE_INVALID: [409, 'A promotional price is below the current list price'],
  PRODUCT_PROMOTION_EXPIRED: [409, 'This promotion is already over'],
  PRODUCT_PROMOTION_OVERLAP: [409, 'This variant already has a promotion in that period'],
  PRODUCT_CATEGORY_DEPTH: [409, 'Categories have two levels at most'],
  // Phase 6 P6-4: inventory.
  INVENTORY_INSUFFICIENT_STOCK: [409, 'The lot holds less than the quantity requested'],
  INVENTORY_RECEIPT_NOT_DRAFT: [409, 'Only a draft receipt can change'],
  INVENTORY_COUNT_NOT_OPEN: [409, 'Only an open stock count can change'],
  INVENTORY_VARIANT_UNAVAILABLE: [409, 'The variant cannot be used for stock'],
  INVENTORY_STOCK_RESERVED: [409, 'Finalized invoices have reserved this stock'],
  // Phase 6 P6-8: product lines on invoices. The field of PRODUCT_OUT_OF_STOCK lists the line ids that cannot be served.
  PRODUCT_NOT_SELLABLE: [409, 'This product cannot be sold now'],
  PRODUCT_OUT_OF_STOCK: [409, 'There is not enough stock for one or more product lines'],
  PRODUCT_SELLER_INVALID: [409, 'The seller must be an active employee assigned to this branch'],
  PRODUCT_SELLER_REQUIRED: [400, 'Choose the seller of this product line'],
  // Phase 6 P6-5: the Excel/CSV import. The field of IMPORT_FILE_INVALID names the reason (never file content).
  IMPORT_FILE_INVALID: [422, 'The file cannot be imported'],
  IMPORT_JOB_NOT_PREVIEWED: [409, 'Only a previewed import can be applied or cancelled'],
  IMPORT_PREVIEW_STALE: [409, 'The data changed since the preview; upload the file again'],
  IMPORT_NOTHING_TO_APPLY: [409, 'No valid row of this file would change anything'],
  // Phase 6 P6-12: product return cases (T23, T35, OQ-22, OQ-79).
  RETURN_NOT_ELIGIBLE: [409, 'This invoice line cannot be returned'],
  RETURN_WINDOW_EXPIRED: [
    409,
    'The return window for this reason is over; only the Owner may approve an exception, with a written reason',
  ],
  RETURN_SEAL_REQUIRED: [409, 'A personal-preference return needs the seal intact'],
  RETURN_QUANTITY_EXCEEDED: [409, 'More units than the line has left to return'],
  RETURN_CLOSED: [409, 'The return case is closed'],
  RETURN_PHOTO_REQUIRED: [
    409,
    'This reason needs a photo taken within 48 hours before it is accepted',
  ],
  RETURN_PHOTO_LIMIT: [409, 'A return case holds at most eight photos'],
  RETURN_PHOTO_GONE: [409, 'This photo was already removed'],
} as const;

export type AuthErrorCode = keyof typeof errors;

/** Only allowlisted public errors reach the transport; never attach input or driver causes. */
export class AuthError extends HttpException {
  constructor(
    readonly code: keyof typeof errors,
    /** Safe field identifier only, never the submitted value. */
    readonly field?: string,
    /** Safe 401 detail: the session ended because the person's permissions changed. */
    readonly reason?: 'AUTHORIZATION_CHANGED',
  ) {
    super(field ? `${errors[code][1]}: ${field}` : errors[code][1], errors[code][0]);
  }
}
