import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  ProviderRejectedError,
  ProviderUnavailableError,
  type PaymentProvider,
  type ProviderCreateInput,
  type ProviderPaymentRequest,
  type ProviderPaymentSnapshot,
  type ProviderStatus,
  type VerifiedProviderNotification,
} from './payment-provider.js';

/**
 * PayOS adapter (Phase 4 Step 8), written against the PayOS merchant API documentation re-verified on
 * 2026-09-30 (payos.vn/docs/api and the official @payos/node 2.x source):
 *
 * - Base `https://api-merchant.payos.vn`, headers `x-client-id` / `x-api-key`, JSON bodies.
 * - `POST /v2/payment-requests` (create), `GET /v2/payment-requests/{orderCode|paymentLinkId}` (read),
 *   `POST /v2/payment-requests/{id}/cancel` (`cancellationReason`). Every response is
 *   `{ code, desc, data, signature }`; success is `code === '00'` with `data`.
 * - The create request is signed with HMAC-SHA256 (checksum key, hex) over
 *   `amount=..&cancelUrl=..&description=..&orderCode=..&returnUrl=..`.
 * - A response `signature` and a webhook `signature` are HMAC-SHA256 (checksum key, hex) over the `data`
 *   object: keys sorted ascending, `key=value` joined by `&`, null/undefined as the empty string.
 * - The webhook body is `{ code, desc, success, data, signature }`.
 *
 * Credentials come only from the environment; they are never logged, stored or returned. Nothing in this
 * file reads the environment: the caller passes a validated config.
 */

export interface PayosConfig {
  readonly clientId: string;
  readonly apiKey: string;
  readonly checksumKey: string;
}

export interface PayosOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Injected in tests (the simulator); production uses the global fetch. */
  readonly fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api-merchant.payos.vn';
const DEFAULT_TIMEOUT_MS = 10_000;

/** The PayOS data-signature canonical form (sorted keys, `key=value`, null as empty). */
export function payosCanonical(data: Record<string, unknown>): string {
  return Object.keys(data)
    .sort()
    .filter((key) => data[key] !== undefined)
    .map((key) => {
      let value = data[key];
      if (Array.isArray(value)) {
        value = JSON.stringify(
          value.map((item) =>
            typeof item === 'object' && item !== null
              ? Object.fromEntries(
                  Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
                    a < b ? -1 : a > b ? 1 : 0,
                  ),
                )
              : item,
          ),
        );
      }
      if (value === null || value === undefined || value === 'undefined' || value === 'null') {
        value = '';
      }
      return `${key}=${String(value)}`;
    })
    .join('&');
}

export function payosSign(text: string, checksumKey: string): string {
  return createHmac('sha256', checksumKey).update(text).digest('hex');
}

export function payosDataSignature(data: Record<string, unknown>, checksumKey: string): string {
  return payosSign(payosCanonical(data), checksumKey);
}

function sameSignature(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const envelope = z.object({
  code: z.union([z.string(), z.number()]).transform(String),
  desc: z.string().optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  signature: z.string().nullish(),
});

const orderCodeSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const amountSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

const createdData = z.object({
  orderCode: orderCodeSchema,
  amount: amountSchema,
  paymentLinkId: z.string().min(1).max(200),
  checkoutUrl: z.string().min(1).max(2_000),
  qrCode: z.string().min(1).max(4_000),
});

const snapshotData = z.object({
  orderCode: orderCodeSchema,
  amount: amountSchema,
  amountPaid: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  status: z.string(),
  transactions: z
    .array(z.object({ reference: z.string().min(1).max(200).nullish() }).passthrough())
    .nullish(),
});

const notificationBody = z.object({
  code: z.union([z.string(), z.number()]).transform(String),
  success: z.boolean(),
  data: z
    .object({
      orderCode: orderCodeSchema,
      amount: amountSchema,
      reference: z.string().min(1).max(200),
      paymentLinkId: z.string().max(200).nullish(),
      currency: z.string().max(10).nullish(),
    })
    .passthrough(),
  signature: z.string().min(1).max(200),
});

/** Scalar data fields worth keeping. Counterparty account names/numbers are deliberately not stored. */
const STORED_FIELDS = [
  'orderCode',
  'amount',
  'description',
  'accountNumber',
  'reference',
  'transactionDateTime',
  'currency',
  'paymentLinkId',
] as const;

function mapStatus(value: string): ProviderStatus {
  switch (value.toUpperCase()) {
    case 'PAID':
      return 'PAID';
    case 'CANCELLED':
    case 'CANCELED':
      return 'CANCELLED';
    case 'EXPIRED':
      return 'EXPIRED';
    // PENDING, PROCESSING, UNDERPAID and anything unknown never credit anything.
    default:
      return 'PENDING';
  }
}

export function createPayosProvider(
  config: PayosConfig,
  options: PayosOptions = {},
): PaymentProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;

  /** One signed request. Returns the verified `data`; throws Unavailable (unknown) or Rejected (definitive). */
  async function call(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-client-id': config.clientId,
          'x-api-key': config.apiKey,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ProviderUnavailableError();
    }
    // Server-side trouble or throttling: the request may or may not have been applied.
    if (response.status >= 500 || response.status === 429 || response.status === 408) {
      throw new ProviderUnavailableError();
    }
    const json: unknown = await response.json().catch(() => null);
    const parsed = envelope.safeParse(json);
    if (!parsed.success) {
      if (!response.ok)
        throw new ProviderRejectedError(String(response.status), response.status === 404);
      throw new ProviderUnavailableError('Unreadable provider response');
    }
    const { code, desc, data, signature } = parsed.data;
    if (!response.ok || code !== '00' || !data) {
      const notFound =
        response.status === 404 || /không tồn tại|not exist|not found/i.test(desc ?? '');
      throw new ProviderRejectedError(code, notFound);
    }
    // A success answer is trusted only with a valid signature over its data.
    if (!signature || !sameSignature(payosDataSignature(data, config.checksumKey), signature)) {
      throw new ProviderUnavailableError('Provider response integrity check failed');
    }
    return data;
  }

  function snapshot(data: Record<string, unknown>): ProviderPaymentSnapshot {
    const parsed = snapshotData.safeParse(data);
    if (!parsed.success) throw new ProviderUnavailableError('Unexpected provider response');
    const transactions = parsed.data.transactions ?? [];
    const reference = transactions.at(-1)?.reference ?? null;
    return {
      orderCode: parsed.data.orderCode,
      status: mapStatus(parsed.data.status),
      amountVnd: parsed.data.amount,
      amountPaidVnd: parsed.data.amountPaid,
      reference,
    };
  }

  return {
    name: 'PAYOS',

    async createPaymentRequest(input: ProviderCreateInput): Promise<ProviderPaymentRequest> {
      const request = {
        orderCode: input.orderCode,
        amount: input.amountVnd,
        description: input.description,
        cancelUrl: input.cancelUrl,
        returnUrl: input.returnUrl,
        expiredAt: Math.floor(input.expiresAt.getTime() / 1000),
      };
      const signature = payosSign(
        `amount=${request.amount}&cancelUrl=${request.cancelUrl}&description=${request.description}&orderCode=${request.orderCode}&returnUrl=${request.returnUrl}`,
        config.checksumKey,
      );
      const data = await call('POST', '/v2/payment-requests', { ...request, signature });
      const parsed = createdData.safeParse(data);
      // The answer must describe exactly the request we made, over https.
      if (
        !parsed.success ||
        parsed.data.orderCode !== input.orderCode ||
        parsed.data.amount !== input.amountVnd ||
        !URL.canParse(parsed.data.checkoutUrl) ||
        new URL(parsed.data.checkoutUrl).protocol !== 'https:'
      ) {
        throw new ProviderUnavailableError('Unexpected provider response');
      }
      return {
        orderCode: parsed.data.orderCode,
        paymentLinkId: parsed.data.paymentLinkId,
        checkoutUrl: parsed.data.checkoutUrl,
        qrCode: parsed.data.qrCode,
        amountVnd: parsed.data.amount,
      };
    },

    async getPaymentRequest(orderCode: number): Promise<ProviderPaymentSnapshot> {
      return snapshot(await call('GET', `/v2/payment-requests/${orderCode}`));
    },

    async cancelPaymentRequest(
      orderCode: number,
      reason: string,
    ): Promise<ProviderPaymentSnapshot> {
      return snapshot(
        await call('POST', `/v2/payment-requests/${orderCode}/cancel`, {
          cancellationReason: reason.slice(0, 255),
        }),
      );
    },

    verifyNotification(body: unknown): VerifiedProviderNotification | null {
      const parsed = notificationBody.safeParse(body);
      if (!parsed.success) return null;
      const { data, signature, success, code } = parsed.data;
      if (!sameSignature(payosDataSignature(data, config.checksumKey), signature)) return null;
      const payload: Record<string, string | number | boolean | null> = {};
      for (const field of STORED_FIELDS) {
        const value = (data as Record<string, unknown>)[field];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          payload[field] = typeof value === 'string' ? value.slice(0, 500) : value;
        }
      }
      return {
        orderCode: data.orderCode,
        amountVnd: data.amount,
        reference: data.reference,
        paymentLinkId: data.paymentLinkId ?? null,
        currency: data.currency ?? null,
        success: success && code === '00',
        payload,
      };
    },
  };
}
