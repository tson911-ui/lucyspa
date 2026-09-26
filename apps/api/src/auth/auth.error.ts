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
} as const;

/** Only allowlisted public errors reach the transport; never attach input or driver causes. */
export class AuthError extends HttpException {
  constructor(
    readonly code: keyof typeof errors,
    /** Safe field identifier only, never the submitted value. */
    readonly field?: string,
  ) {
    super(field ? `${errors[code][1]}: ${field}` : errors[code][1], errors[code][0]);
  }
}
