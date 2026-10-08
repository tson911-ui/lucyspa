import type { parseApiEnvironment, PaymentProvider } from '@lucy-spa/server';

export type ApiEnvironment = ReturnType<typeof parseApiEnvironment>;
export const API_ENVIRONMENT = Symbol('API_ENVIRONMENT');
export const API_LOGGER = Symbol('API_LOGGER');
/** The payment provider (PayOS), or null when it is not configured: the method is then disabled. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export type PaymentProviderOrNull = PaymentProvider | null;
/** Website media object storage (UX/UI Step 11): local disk now, replaceable by configuration. */
export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
/**
 * Phase 6 P6-12 (OQ-79): the PRIVATE evidence photos of product return cases. A second storage rooted at a `returns` folder inside
 * MEDIA_STORAGE_DIR (no new setting): the website's keys start with a year, so they can never address this folder, and the photos are
 * streamed only by the permission-checked return endpoint.
 */
export const RETURN_EVIDENCE_STORAGE = Symbol('RETURN_EVIDENCE_STORAGE');
