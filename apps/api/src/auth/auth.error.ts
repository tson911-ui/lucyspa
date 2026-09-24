import { HttpException } from '@nestjs/common';

const errors = {
  VALIDATION_FAILED: [400, 'Validation failed'],
  VERIFICATION_FAILED: [400, 'Verification failed; request a new code or restart registration'],
  AUTHENTICATION_REQUIRED: [401, 'Authentication required'],
  REQUEST_NOT_ALLOWED: [403, 'Request not allowed'],
  SERVICE_UNAVAILABLE: [503, 'Service unavailable'],
  RATE_LIMITED: [429, 'Too many requests'],
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
