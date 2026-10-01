import type { parseApiEnvironment, PaymentProvider } from '@lucy-spa/server';

export type ApiEnvironment = ReturnType<typeof parseApiEnvironment>;
export const API_ENVIRONMENT = Symbol('API_ENVIRONMENT');
export const API_LOGGER = Symbol('API_LOGGER');
/** The payment provider (PayOS), or null when it is not configured: the method is then disabled. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export type PaymentProviderOrNull = PaymentProvider | null;
/** Website media object storage (UX/UI Step 11): local disk now, replaceable by configuration. */
export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
