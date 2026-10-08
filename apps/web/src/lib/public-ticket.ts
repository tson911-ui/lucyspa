import type {
  ProductOrderLineStatusName,
  ProductOrderTicketPublicResponse,
} from '@lucy-spa/contracts';
import { apiOrigin } from './season-server';

/**
 * The public ticket of a counter pre-order (Phase 6 P6-16, OQ-35, OQ-P6-42): read by the server for a visitor who holds the secret
 * link. NOTHING is remembered between requests (the ticket is private to the link) and nothing is cached by the browser or by Next.
 * A token of the wrong shape is "missing" without a request; a failed read is "error", never "missing".
 */

/** 32 random bytes as base64url: the shape the API accepts. */
export const TICKET_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** A slow API must not hold the page for long. */
export const TICKET_FETCH_TIMEOUT_MS = 3_000;

const STATUSES: readonly ProductOrderLineStatusName[] = [
  'AWAITING_PAYMENT',
  'PAID',
  'ORDERED',
  'ARRIVED',
  'HANDED_OVER',
  'COMPLETED',
  'CANCELLED',
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const isStatus = (value: unknown): value is ProductOrderLineStatusName =>
  text(value) && (STATUSES as readonly string[]).includes(value);

/** The shape of the answer, checked field by field; anything else is null. */
export function parsePublicTicket(body: unknown): ProductOrderTicketPublicResponse | null {
  if (!isObject(body)) return null;
  const { code, status, branchName, paidAt, totalVnd, lines } = body;
  if (
    !text(code) ||
    !isStatus(status) ||
    !text(branchName) ||
    !nullableText(paidAt) ||
    !text(totalVnd) ||
    !/^[0-9]+$/.test(totalVnd) ||
    !Array.isArray(lines)
  ) {
    return null;
  }
  const parsed: ProductOrderTicketPublicResponse['lines'] = [];
  for (const line of lines) {
    if (!isObject(line)) return null;
    if (
      !text(line['nameVi']) ||
      !text(line['nameEn']) ||
      !nullableText(line['variantLabelVi']) ||
      !nullableText(line['variantLabelEn']) ||
      typeof line['quantity'] !== 'number' ||
      !Number.isInteger(line['quantity']) ||
      !text(line['unitPriceVnd']) ||
      !text(line['grossVnd']) ||
      !isStatus(line['status']) ||
      !nullableText(line['expectedFrom']) ||
      !nullableText(line['expectedTo'])
    ) {
      return null;
    }
    parsed.push({
      nameVi: line['nameVi'],
      nameEn: line['nameEn'],
      variantLabelVi: line['variantLabelVi'],
      variantLabelEn: line['variantLabelEn'],
      quantity: line['quantity'],
      unitPriceVnd: line['unitPriceVnd'],
      grossVnd: line['grossVnd'],
      status: line['status'],
      expectedFrom: line['expectedFrom'],
      expectedTo: line['expectedTo'],
    });
  }
  return { code, status, branchName, paidAt, totalVnd, lines: parsed };
}

export type TicketRead =
  | { kind: 'ok'; ticket: ProductOrderTicketPublicResponse }
  | { kind: 'missing' }
  | { kind: 'error' };

export async function fetchPublicTicket(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<TicketRead> {
  if (!TICKET_TOKEN.test(token)) return { kind: 'missing' };
  try {
    const response = await fetcher(
      `${apiOrigin()}/api/v1/public/product-order-tickets/${encodeURIComponent(token)}`,
      {
        headers: { accept: 'application/json' },
        credentials: 'omit',
        signal: AbortSignal.timeout(TICKET_FETCH_TIMEOUT_MS),
        cache: 'no-store',
      },
    );
    if (response.status === 404) return { kind: 'missing' };
    if (response.status !== 200) return { kind: 'error' };
    const ticket = parsePublicTicket(await response.json());
    return ticket ? { kind: 'ok', ticket } : { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}
