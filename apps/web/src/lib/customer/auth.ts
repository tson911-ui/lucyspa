import type {
  AcceptedFlowResponse,
  ActivationVerifyRequest,
  ChallengeResendRequest,
  ChallengeResendResponse,
  CurrentAccountResponse,
  LoginRequest,
  PasswordResetCompleteRequest,
  PasswordResetRequest,
  PreferredLocale,
  RegisterCustomerRequest,
} from '@lucy-spa/contracts';
import { ApiError, type ApiClient } from '../api/client';

/**
 * Customer authentication over the unchanged Phase 1 endpoints (design contract section 13).
 * Nothing is stored in web storage: the session is the HttpOnly cookie, and a registration or
 * reset flow token lives only in the page's memory.
 */
export type CustomerSession =
  | { kind: 'customer'; account: CurrentAccountResponse }
  | { kind: 'workforce'; account: CurrentAccountResponse }
  | { kind: 'anonymous' };

export async function loadCustomerSession(api: ApiClient): Promise<CustomerSession> {
  const context = await api.context();
  if (!context.authenticated) return { kind: 'anonymous' };
  try {
    // Passive: resolving the session must never extend the idle timeout.
    const account = await api.get<CurrentAccountResponse>('/api/v1/auth/me', {}, { passive: true });
    return account.kind === 'CUSTOMER'
      ? { kind: 'customer', account }
      : { kind: 'workforce', account };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { kind: 'anonymous' };
    throw error;
  }
}

/** CUSTOMER realm, email only; the login rotates the cookie, so a fresh CSRF context follows. */
export async function customerLogin(
  api: ApiClient,
  email: string,
  password: string,
): Promise<CurrentAccountResponse> {
  await api.context();
  const body: LoginRequest = {
    realm: 'CUSTOMER',
    identifierType: 'EMAIL',
    identifier: email.trim(),
    password,
  };
  const account = await api.post<CurrentAccountResponse>('/api/v1/auth/login', body);
  await api.context();
  return account;
}

export async function customerLogout(api: ApiClient): Promise<void> {
  try {
    await api.post<void>('/api/v1/auth/logout', {});
  } finally {
    api.resetCsrf();
  }
}

export function registerCustomer(
  api: ApiClient,
  input: RegisterCustomerRequest,
): Promise<AcceptedFlowResponse> {
  return api.post<AcceptedFlowResponse>('/api/v1/auth/register', input);
}

/** 204 without a login cookie: the customer signs in afterwards (contract section 1, gap 2). */
export function verifyActivation(api: ApiClient, flowToken: string, otp: string): Promise<void> {
  const body: ActivationVerifyRequest = { flowToken, otp: otp.trim() };
  return api.post<void>('/api/v1/auth/activation/verify', body);
}

export function resendChallenge(
  api: ApiClient,
  flowToken: string,
): Promise<ChallengeResendResponse> {
  const body: ChallengeResendRequest = { flowToken };
  return api.post<ChallengeResendResponse>('/api/v1/auth/challenges/resend', body);
}

export function requestCustomerReset(
  api: ApiClient,
  email: string,
  locale: PreferredLocale,
): Promise<AcceptedFlowResponse> {
  const body: PasswordResetRequest = { realm: 'CUSTOMER', email: email.trim(), locale };
  return api.post<AcceptedFlowResponse>('/api/v1/auth/password-reset/request', body);
}

export function completeCustomerReset(
  api: ApiClient,
  flowToken: string,
  otp: string,
  newPassword: string,
): Promise<void> {
  const body: PasswordResetCompleteRequest = { flowToken, otp: otp.trim(), newPassword };
  return api.post<void>('/api/v1/auth/password-reset/complete', body);
}

/** Only same-area relative paths are accepted as a post-login destination. */
export function safeCustomerNext(next: string | null, base: string): string {
  if (!next || next.includes('\\') || !(next === base || next.startsWith(`${base}/`))) return base;
  const authPages = ['login', 'register', 'forgot-password'].map((page) => `${base}/${page}`);
  return authPages.some((page) => next.startsWith(page)) ? base : next;
}
