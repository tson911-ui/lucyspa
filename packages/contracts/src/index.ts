/** Public, transport-only contracts. No ORM, Node runtime or domain implementation exports. */
export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  checks?: { database: 'up' | 'down'; redis: 'up' | 'down' };
}

export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string | string[];
  requestId: string;
}

export interface AuthContextResponse {
  csrfToken: string;
  authenticated: boolean;
}

export type PreferredLocale = 'vi' | 'en';

/** POST /api/v1/auth/register. Role, kind, status and other fields are rejected. */
export interface RegisterCustomerRequest {
  fullName: string;
  /** Calendar date `YYYY-MM-DD`. */
  dateOfBirth: string;
  address: string;
  email: string;
  phone: string;
  password: string;
  locale: PreferredLocale;
}

/** Constant for real, duplicate, throttled and suppressed requests; not a delivery promise. */
export interface AcceptedFlowResponse {
  status: 'accepted';
  flowToken: string;
  codeLifetimeSeconds: 300;
  resendAfterSeconds: 60;
}

/** POST /api/v1/auth/activation/verify; success is 204 without a login cookie. */
export interface ActivationVerifyRequest {
  flowToken: string;
  otp: string;
}

export interface ChallengeResendRequest {
  flowToken: string;
}

export interface ChallengeResendResponse {
  status: 'accepted';
  resendAfterSeconds: 60;
}
