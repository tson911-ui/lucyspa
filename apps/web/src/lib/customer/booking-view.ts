import type { CustomerBookingBranchResponse } from '@lucy-spa/contracts';

/**
 * Pure helpers of the booking page's list and summary (Part 2 contract 5.5). The server still plans, prices and
 * checks everything; these only arrange what it returned and read the deep link.
 */
export type BranchService = CustomerBookingBranchResponse['services'][number];

const MAX_PRESELECT = 10;

/**
 * The codes of `?service=A,B` (also repeated `service=` parameters, and `services=A,B` as the website chat's booking link names
 * them): trimmed, without repeats, at most ten.
 */
export function serviceCodesFromSearch(search: string): string[] {
  const codes: string[] = [];
  const params = new URLSearchParams(search);
  for (const value of [...params.getAll('service'), ...params.getAll('services')]) {
    for (const part of value.split(',')) {
      const code = part.trim();
      if (code && code.length <= 64 && !codes.includes(code)) codes.push(code);
    }
  }
  return codes.slice(0, MAX_PRESELECT);
}

export interface BookingPrefill {
  /** The branch code of `?branch=`. */
  branchCode: string | null;
  /** A real calendar date of `?date=YYYY-MM-DD`. */
  date: string | null;
  /** A start time `HH:MM` of `?time=`. */
  time: string | null;
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * What the booking link of the website chat (and the n8n bots) names beyond the services: the branch, the day and the start time.
 * Read only and forgiving: a value that is not well formed is simply left out, so a wrong link opens the ordinary booking page. The
 * customer still signs in, still sees every step and confirms; the server re-checks the slot like any other.
 */
export function bookingPrefillFromSearch(search: string): BookingPrefill {
  const params = new URLSearchParams(search);
  const branch = params.get('branch')?.trim() ?? '';
  const date = params.get('date')?.trim() ?? '';
  const time = params.get('time')?.trim() ?? '';
  const realDate =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  return {
    branchCode: CODE.test(branch) ? branch : null,
    date: realDate ? date : null,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null,
  };
}

/** The branch id for a code the link named; null when no branch of the customer's list has it. */
export function prefillBranchId(
  code: string | null,
  branches: readonly { id: string; code: string }[],
): string | null {
  if (code === null) return null;
  return branches.find((branch) => branch.code === code)?.id ?? null;
}

/** The linked day when it is inside the bookable range of the branch, otherwise null. */
export function prefillDate(
  date: string | null,
  firstDate: string,
  lastDate: string,
): string | null {
  return date !== null && date >= firstDate && date <= lastDate ? date : null;
}

/** Service ids for the codes, in the order of the codes; a code the branch does not offer is dropped. */
export function preselectServiceIds(
  codes: readonly string[],
  services: readonly BranchService[],
): string[] {
  const ids: string[] = [];
  for (const code of codes) {
    const found = services.find((service) => service.code === code);
    if (found && !ids.includes(found.id)) ids.push(found.id);
  }
  return ids;
}

export interface ServiceGroup {
  key: string;
  name: string;
  services: BranchService[];
}

/** Services under their category (categories in the order first met), cheapest first and then by name inside one. */
export function groupByCategory(
  services: readonly BranchService[],
  locale: 'vi' | 'en',
): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>();
  for (const service of services) {
    const name = locale === 'vi' ? service.categoryNameVi : service.categoryNameEn;
    const group = groups.get(service.categoryNameVi) ?? {
      key: service.categoryNameVi,
      name,
      services: [],
    };
    group.services.push(service);
    groups.set(service.categoryNameVi, group);
  }
  const label = (service: BranchService) => (locale === 'vi' ? service.nameVi : service.nameEn);
  for (const group of groups.values()) {
    group.services.sort((a, b) => {
      const byPrice = BigInt(a.priceMinVnd) - BigInt(b.priceMinVnd);
      if (byPrice !== 0n) return byPrice < 0n ? -1 : 1;
      return label(a).localeCompare(label(b), locale);
    });
  }
  return [...groups.values()];
}

export interface BookingTotals {
  count: number;
  minutes: number;
  /** The sum of the fixed-price services' reference prices; per-nail services are not in it. */
  fixedMinVnd: bigint;
  fixedMaxVnd: bigint;
  /** At least one chosen service is priced per nail (the count is settled at the shop). */
  hasPerNail: boolean;
}

export function bookingTotals(services: readonly BranchService[]): BookingTotals {
  let fixedMinVnd = 0n;
  let fixedMaxVnd = 0n;
  let minutes = 0;
  let hasPerNail = false;
  for (const service of services) {
    minutes += service.durationMinutes;
    if (service.pricingUnit === 'PER_NAIL') {
      hasPerNail = true;
    } else {
      fixedMinVnd += BigInt(service.priceMinVnd);
      fixedMaxVnd += BigInt(service.priceMaxVnd);
    }
  }
  return { count: services.length, minutes, fixedMinVnd, fixedMaxVnd, hasPerNail };
}

/** The "Tạm tính" figure: the fixed prices (a range when they differ), or null when only per-nail services are chosen. */
export function formatFixedTotal(totals: BookingTotals, locale: 'vi' | 'en'): string | null {
  if (totals.fixedMaxVnd === 0n && totals.hasPerNail) return null;
  const format = (value: bigint) =>
    `${new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(value)} ₫`;
  return totals.fixedMinVnd === totals.fixedMaxVnd
    ? format(totals.fixedMinVnd)
    : `${format(totals.fixedMinVnd)} – ${format(totals.fixedMaxVnd)}`;
}
