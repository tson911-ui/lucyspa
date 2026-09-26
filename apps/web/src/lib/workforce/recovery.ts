import type {
  AcceptedFlowResponse,
  CurrentAccountResponse,
  PasswordResetCompleteRequest,
  PasswordResetRequest,
  RecoveryEmailVerifyRequest,
} from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import type { Locale } from '../../i18n/locales';
import { ApiError, type WorkforceApi } from './api';
import { PASSWORD_LENGTH, passwordLength } from './employee-create';
import { ReauthenticationCancelled } from './reauth';
import { errorMessage } from './workflows';

/**
 * Workforce account recovery (Owner lockout fix) over the EXISTING endpoints only:
 * - recovery email: POST /auth/recovery-email/request (signed in, fresh password proof)
 *   and /verify — proves the stored address so email recovery can work later;
 * - forgot password: POST /auth/password-reset/request (WORKFORCE realm) and /complete.
 * The reset request always answers the same way, so the UI never says whether an account
 * or email exists or is eligible.
 */

export function requestWorkforceReset(
  api: WorkforceApi,
  email: string,
  locale: Locale,
): Promise<AcceptedFlowResponse> {
  const body: PasswordResetRequest = { realm: 'WORKFORCE', email: email.trim(), locale };
  return api.post<AcceptedFlowResponse>('/api/v1/auth/password-reset/request', body);
}

/** Existing completion: new hash, next credential version, every session signed out. */
export function completeWorkforceReset(
  api: WorkforceApi,
  flowToken: string,
  otp: string,
  newPassword: string,
): Promise<void> {
  const body: PasswordResetCompleteRequest = { flowToken, otp: otp.trim(), newPassword };
  return api.post<void>('/api/v1/auth/password-reset/complete', body);
}

export function requestRecoveryEmailCode(api: WorkforceApi): Promise<AcceptedFlowResponse> {
  return api.post<AcceptedFlowResponse>('/api/v1/auth/recovery-email/request', {});
}

export function verifyRecoveryEmail(
  api: WorkforceApi,
  flowToken: string,
  otp: string,
): Promise<void> {
  const body: RecoveryEmailVerifyRequest = { flowToken, otp: otp.trim() };
  return api.post<void>('/api/v1/auth/recovery-email/verify', body);
}

export const OTP_PATTERN = /^[0-9]{6}$/;

export type ResetProblem = 'code' | 'length' | 'mismatch' | null;

/** Immediate checks only (6-digit code, policy length, confirmation); the API decides. */
export function resetProblem(code: string, password: string, confirmation: string): ResetProblem {
  if (!OTP_PATTERN.test(code.trim())) return 'code';
  const length = passwordLength(password);
  if (length < PASSWORD_LENGTH.min || length > PASSWORD_LENGTH.max) return 'length';
  return password === confirmation ? null : 'mismatch';
}

export type RecoveryEmailState = 'verified' | 'unverified' | 'missing' | 'unknown';

export function recoveryEmailState(account: CurrentAccountResponse | null): RecoveryEmailState {
  if (!account || account.recoveryEmail === undefined) return 'unknown';
  if (account.recoveryEmail === null) return 'missing';
  return account.recoveryEmail.verified ? 'verified' : 'unverified';
}

/** Codes are never distinguished: wrong, expired or used all read the same. */
export function recoveryErrorMessage(error: unknown, t: WorkforceDictionary): string {
  if (error instanceof ReauthenticationCancelled) return t.reauth.cancelled;
  if (error instanceof ApiError) {
    if (error.code === 'VERIFICATION_FAILED') return t.recovery.codeRejected;
    if (error.code === 'VALIDATION_FAILED' && error.field === 'newPassword') {
      return t.employees.create.passwordRejected;
    }
    if (error.code === 'VALIDATION_FAILED' && error.field === 'otp') return t.recovery.codeRejected;
    if (error.status === 400) return t.recovery.codeRejected;
  }
  return errorMessage(error, t);
}
