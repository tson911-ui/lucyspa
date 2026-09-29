import type {
  AddServiceLineRequest,
  AddedServiceLineResponse,
  WalkInOptionsResponse,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { formatVnd } from './format';

/** A fresh client idempotency key (one per intended add; kept across retries of the same choice). */
export function newAddKey(): string {
  return globalThis.crypto.randomUUID();
}

export type StaffChoice = '' | 'me' | string;

/**
 * The request for "add a catalog service to this visit". Only ids: the participant, the catalog
 * service and an optional staff intent (`''` = any qualified staff, `'me'` = the signed-in user).
 * No name, price, quantity or time can be expressed; the API re-validates everything.
 */
export function addServiceBody(input: {
  participantId: string;
  serviceId: string;
  staff: StaffChoice;
  myUserId: string;
  idempotencyKey: string;
}): AddServiceLineRequest | null {
  if (!input.participantId || !input.serviceId || !input.idempotencyKey) return null;
  const requested = input.staff === 'me' ? input.myUserId : input.staff;
  return {
    participantId: input.participantId,
    serviceId: input.serviceId,
    requestedEmployeeUserId: requested === '' ? null : requested,
    idempotencyKey: input.idempotencyKey,
  };
}

/** The catalog reference range shown next to a service ("40.000 ₫" or "5.000–10.000 ₫"), never a bill. */
export function referenceRange(
  service: Pick<WalkInOptionsResponse['services'][number], 'priceMinVnd' | 'priceMaxVnd'>,
  locale: Locale,
): string {
  return service.priceMinVnd === service.priceMaxVnd
    ? formatVnd(service.priceMinVnd, locale)
    : `${formatVnd(service.priceMinVnd, locale)}–${formatVnd(service.priceMaxVnd, locale)}`;
}

/** Which of the three outcome texts applies to an add result. */
export function addOutcome(result: Pick<AddedServiceLineResponse, 'status' | 'employee'>) {
  return result.status === 'PLANNED' && result.employee ? 'PLANNED' : 'WAITING';
}
