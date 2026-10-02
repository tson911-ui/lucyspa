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
  SERVICE_NOT_READY: [409, 'The planned start time has not arrived'],
  SERVICE_START_UNAVAILABLE: [409, 'Check attendance and operational availability before starting'],
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
} as const;

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
