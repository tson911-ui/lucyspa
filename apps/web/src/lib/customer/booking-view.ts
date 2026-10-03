import type { CustomerBookingBranchResponse } from '@lucy-spa/contracts';

/**
 * Pure helpers of the booking page's list and summary (Part 2 contract 5.5). The server still plans, prices and
 * checks everything; these only arrange what it returned and read the deep link.
 */
export type BranchService = CustomerBookingBranchResponse['services'][number];

const MAX_PRESELECT = 10;

/** The codes of `?service=A,B` (also repeated `service=` parameters): trimmed, without repeats, at most ten. */
export function serviceCodesFromSearch(search: string): string[] {
  const codes: string[] = [];
  for (const value of new URLSearchParams(search).getAll('service')) {
    for (const part of value.split(',')) {
      const code = part.trim();
      if (code && code.length <= 64 && !codes.includes(code)) codes.push(code);
    }
  }
  return codes.slice(0, MAX_PRESELECT);
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
