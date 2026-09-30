/**
 * Phase 4 Step 8: the provider-neutral payment boundary (design 16.1). The domain owns this interface;
 * PayOS is one adapter behind it and a deterministic simulator proves the contract in tests. Nothing here
 * knows about invoices: it creates, reads and cancels a payment REQUEST and verifies a notification.
 */

/** What the provider says about one payment request. */
export type ProviderStatus = 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED';

export interface ProviderCreateInput {
  /** Merchant order identifier: a positive safe integer, unique per payment channel. */
  readonly orderCode: number;
  readonly amountVnd: number;
  /** Short memo shown on the bank transfer (providers limit its length). */
  readonly description: string;
  readonly expiresAt: Date;
  readonly returnUrl: string;
  readonly cancelUrl: string;
}

export interface ProviderPaymentRequest {
  readonly orderCode: number;
  readonly paymentLinkId: string;
  readonly checkoutUrl: string;
  /** The QR content string (rendered to an image by the client). */
  readonly qrCode: string;
  readonly amountVnd: number;
}

export interface ProviderPaymentSnapshot {
  readonly orderCode: number;
  readonly status: ProviderStatus;
  readonly amountVnd: number;
  readonly amountPaidVnd: number;
  /** The bank transaction reference of the confirming transfer (present when PAID). */
  readonly reference: string | null;
}

/** An AUTHENTIC notification: its signature was verified against the merchant secret. */
export interface VerifiedProviderNotification {
  readonly orderCode: number;
  readonly amountVnd: number;
  readonly reference: string;
  readonly paymentLinkId: string | null;
  readonly currency: string | null;
  /** The provider's own success flag (a `false` notification never credits anything). */
  readonly success: boolean;
  /** The verified data without counterparty bank-account details, safe to store. */
  readonly payload: Record<string, string | number | boolean | null>;
}

/** Why a delivery was refused. Internal (logs and tests only); never sent to the caller. */
export type NotificationRejection =
  'BODY_NOT_OBJECT' | 'DATA_MISSING' | 'SIGNATURE_MISSING' | 'SIGNATURE_MISMATCH';

/** A sanitized description of a refused delivery: reasons and field NAMES only, never a value or signature. */
export interface NotificationRejectionDetail {
  readonly reason: NotificationRejection;
  readonly signatureLength: number | null;
  readonly dataFields: readonly string[];
}

/**
 * The outcome of checking one webhook delivery. Authenticity (signature over `data`) is decided first and
 * independently of the payment fields, so an authentic delivery that is not an actionable payment
 * notification (the PayOS URL-confirmation probe) is UNACTIONABLE, not a forgery.
 */
export type NotificationCheck =
  | { readonly kind: 'REJECTED'; readonly detail: NotificationRejectionDetail }
  | { readonly kind: 'UNACTIONABLE' }
  | { readonly kind: 'VERIFIED'; readonly notification: VerifiedProviderNotification };

/**
 * The provider could not be reached or its answer could not be trusted (network, timeout, 5xx, failed
 * response integrity). The outcome of the request is UNKNOWN: callers must not assume it failed.
 */
export class ProviderUnavailableError extends Error {
  constructor(message = 'Payment provider unavailable') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/** The provider answered and definitively refused (bad request, unknown order, wrong state). */
export class ProviderRejectedError extends Error {
  constructor(
    readonly providerCode: string | null,
    readonly notFound: boolean,
  ) {
    super('Payment provider rejected the request');
    this.name = 'ProviderRejectedError';
  }
}

export interface PaymentProvider {
  readonly name: 'PAYOS';
  createPaymentRequest(input: ProviderCreateInput): Promise<ProviderPaymentRequest>;
  getPaymentRequest(orderCode: number): Promise<ProviderPaymentSnapshot>;
  cancelPaymentRequest(orderCode: number, reason: string): Promise<ProviderPaymentSnapshot>;
  /** Null when the body is not an authentic, well-formed notification (nothing is revealed about why). */
  verifyNotification(body: unknown): VerifiedProviderNotification | null;
  /** Signature first, then interpretation; says why a delivery was refused (for sanitized logs only). */
  checkNotification(body: unknown): NotificationCheck;
}
