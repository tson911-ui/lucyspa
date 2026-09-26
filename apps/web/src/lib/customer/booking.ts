import type {
  BookingRecipientRelationName,
  CustomerBookingCreateRequest,
  CustomerBookingDisplayStatus,
} from '@lucy-spa/contracts';
import type { CustomerDictionary } from '../../i18n/customer';
import { ApiError } from '../api/client';

/**
 * Pure helpers of the customer booking flow. The web app never decides availability or
 * assignment: it only builds the request and renders what the server returns.
 */

/** A person a service is for. `self` is the signed-in owner; others are named, never accounts. */
export interface Person {
  key: string;
  relation: BookingRecipientRelationName;
  name: string;
  phone: string;
}

export const SELF: Person = { key: 'self', relation: 'SELF', name: '', phone: '' };

export interface BookingDraft {
  branchId: string;
  /** Ordered service ids (the order they are performed in). */
  serviceIds: string[];
  people: Person[];
  /** Person key per service position. */
  recipientOf: string[];
  /** Employee id per service position, or 'ANY'. */
  staffOf: string[];
  date: string;
  startTime: string;
}

export function emptyDraft(): BookingDraft {
  return {
    branchId: '',
    serviceIds: [],
    people: [SELF],
    recipientOf: [],
    staffOf: [],
    date: '',
    startTime: '',
  };
}

/** Adds or removes a service; per-position choices follow their service. */
export function toggleService(draft: BookingDraft, serviceId: string): BookingDraft {
  const index = draft.serviceIds.indexOf(serviceId);
  if (index >= 0) {
    return {
      ...draft,
      serviceIds: draft.serviceIds.filter((_, position) => position !== index),
      recipientOf: draft.recipientOf.filter((_, position) => position !== index),
      staffOf: draft.staffOf.filter((_, position) => position !== index),
      startTime: '',
    };
  }
  return {
    ...draft,
    serviceIds: [...draft.serviceIds, serviceId],
    recipientOf: [...draft.recipientOf, SELF.key],
    staffOf: [...draft.staffOf, 'ANY'],
    startTime: '',
  };
}

/** Moves a service up (-1) or down (+1) in the performed order. */
export function moveService(draft: BookingDraft, index: number, direction: -1 | 1): BookingDraft {
  const target = index + direction;
  if (target < 0 || target >= draft.serviceIds.length) return draft;
  const swap = <T>(items: T[]) => {
    const copy = [...items];
    [copy[index], copy[target]] = [copy[target] as T, copy[index] as T];
    return copy;
  };
  return {
    ...draft,
    serviceIds: swap(draft.serviceIds),
    recipientOf: swap(draft.recipientOf),
    staffOf: swap(draft.staffOf),
    startTime: '',
  };
}

export function peopleProblem(draft: BookingDraft): 'name' | null {
  const used = new Set(draft.recipientOf);
  return draft.people.some(
    (person) => used.has(person.key) && person.relation !== 'SELF' && !person.name.trim(),
  )
    ? 'name'
    : null;
}

/**
 * The create request: only people used by a service are sent, each once (a person with
 * several services is one recipient), and the owner is never sent (the session decides it).
 */
export function createRequest(
  draft: BookingDraft,
  idempotencyKey: string,
): CustomerBookingCreateRequest {
  const used = new Set(draft.recipientOf);
  return {
    idempotencyKey,
    branchId: draft.branchId,
    date: draft.date,
    startTime: draft.startTime,
    recipients: draft.people
      .filter((person) => used.has(person.key))
      .map((person) =>
        person.relation === 'SELF'
          ? { key: person.key, relation: 'SELF' as const }
          : {
              key: person.key,
              relation: person.relation,
              displayName: person.name.trim(),
              ...(person.phone.trim() ? { phone: person.phone.trim() } : {}),
            },
      ),
    lines: draft.serviceIds.map((serviceId, index) => ({
      serviceId,
      recipientKey: draft.recipientOf[index] ?? SELF.key,
      employeeUserId: draft.staffOf[index] === 'ANY' ? null : (draft.staffOf[index] ?? null),
    })),
  };
}

/** Availability query for the current draft (the server plans; this only encodes choices). */
export function availabilityQuery(draft: BookingDraft) {
  return {
    branchId: draft.branchId,
    date: draft.date,
    serviceIds: draft.serviceIds.join(','),
    employees: draft.staffOf.join(','),
  };
}

/** Integer VND as `150.000 ₫`; a range when min ≠ max. */
export function formatVndRange(min: string, max: string, locale: string): string {
  const format = (value: string) =>
    `${new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(BigInt(value))} ₫`;
  return min === max ? format(min) : `${format(min)} – ${format(max)}`;
}

/** An instant in the branch's timezone. */
export function formatDateTime(iso: string, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatTime(iso: string, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function statusTone(
  status: CustomerBookingDisplayStatus,
): 'success' | 'info' | 'warning' | 'neutral' | 'error' {
  switch (status) {
    case 'CONFIRMED':
      return 'success';
    case 'ARRIVED':
    case 'IN_SERVICE':
      return 'info';
    case 'COMPLETED':
      return 'neutral';
    case 'NO_SHOW':
      return 'warning';
    default:
      return 'error';
  }
}

/** Booking errors that mean "pick another time" (the wizard returns to the time step). */
export const RETRY_TIME_CODES: ReadonlySet<string> = new Set([
  'BOOKING_SLOT_UNAVAILABLE',
  'BOOKING_KTV_UNAVAILABLE',
  'BOOKING_NO_SUITABLE_KTV',
  'BOOKING_INVALID_TIME',
  'BOOKING_OUTSIDE_HORIZON',
  'BOOKING_CUSTOMER_CONFLICT',
]);

/** A customer-safe message for any API failure; never raw server text. */
export function customerErrorMessage(error: unknown, t: CustomerDictionary): string {
  if (!(error instanceof ApiError)) return t.errors.unexpected;
  const booking = t.errors.booking as Record<string, string>;
  if (error.code in booking) return booking[error.code] as string;
  switch (error.code) {
    case 'VALIDATION_FAILED':
    case 'HTTP_400':
      return t.errors.validation;
    case 'AUTHENTICATION_REQUIRED':
      return t.errors.unauthenticated;
    case 'AUTHENTICATION_FAILED':
      return t.auth.loginFailed;
    case 'FORBIDDEN':
    case 'REQUEST_NOT_ALLOWED':
      return t.errors.forbidden;
    case 'NOT_FOUND':
      return t.errors.notFound;
    case 'CONFLICT':
      return t.errors.conflict;
    case 'RATE_LIMITED':
      return t.errors.rateLimited;
    case 'SERVICE_UNAVAILABLE':
      return t.errors.unavailable;
    case 'NETWORK':
      return t.errors.network;
    default:
      return t.errors.unexpected;
  }
}
