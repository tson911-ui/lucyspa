import type {
  PublicHoursGroup,
  PublicService,
  PublicServiceDetailResponse,
  PublicServiceGroup,
  PublicServicesResponse,
  PublicSiteResponse,
  PublicSlide,
} from '@lucy-spa/contracts';
import { hoursLines, type HoursLine } from './hours';
import { formatVndRange } from './customer/booking';

// The public site's data and wording rules (Part 2 contract 2, 5.2): what the API sends is checked before a page
// trusts it, and prices, estimates and links are formatted in one place. Pure, so every rule is unit-tested.

/** What the home page needs; a part that could not be read is null (that section shows a notice, the rest still renders). */
export interface HomeData {
  site: PublicSiteResponse | null;
  services: PublicServicesResponse | null;
  slides: PublicSlide[];
}

type Locale = 'vi' | 'en';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isMoney = (value: unknown): value is string => isString(value) && /^\d{1,15}$/.test(value);

function parseHours(value: unknown): PublicHoursGroup[] | null {
  if (!Array.isArray(value)) return null;
  const groups: PublicHoursGroup[] = [];
  for (const item of value) {
    if (!isRecord(item) || !Array.isArray(item['weekdays'])) return null;
    const weekdays = item['weekdays'];
    if (!weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) return null;
    if (typeof item['closed'] !== 'boolean') return null;
    if (!isNullableString(item['opensAt']) || !isNullableString(item['closesAt'])) return null;
    groups.push({
      weekdays: weekdays as number[],
      closed: item['closed'],
      opensAt: item['opensAt'],
      closesAt: item['closesAt'],
    });
  }
  return groups;
}

function parseSiteImage(value: unknown): PublicSiteResponse['heroImage'] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isString(value['alt']) || !isCount(value['width'])) return undefined;
  if (!isCount(value['height']) || !Array.isArray(value['sources'])) return undefined;
  const sources: { url: string; width: number }[] = [];
  for (const source of value['sources']) {
    // Only same-origin image paths of the public media route are ever drawn.
    if (
      !isRecord(source) ||
      !isString(source['url']) ||
      !/^\/api\/v1\/public\/media\/[0-9a-f-]{36}\/(md|lg)$/i.test(source['url']) ||
      !isCount(source['width'])
    ) {
      return undefined;
    }
    sources.push({ url: source['url'], width: source['width'] });
  }
  return { alt: value['alt'], width: value['width'], height: value['height'], sources };
}

export function parsePublicSite(value: unknown): PublicSiteResponse | null {
  if (!isRecord(value)) return null;
  const hours = parseHours(value['hours']);
  const heroImage = parseSiteImage(value['heroImage']);
  if (
    !isString(value['tagline']) ||
    // An API that predates the field (a restart in progress) sends none: the site then uses its own sentence.
    !(value['intro'] === undefined || isNullableString(value['intro'])) ||
    !isString(value['address']) ||
    !isString(value['hotline']) ||
    !isString(value['hotlineTel']) ||
    !/^\+\d{6,20}$/.test(value['hotlineTel']) ||
    !isNullableString(value['mapUrl']) ||
    !isString(value['timezone']) ||
    hours === null ||
    heroImage === undefined
  ) {
    return null;
  }
  // The map link is drawn as a real link: https only, whatever the server says.
  const mapUrl = value['mapUrl'];
  return {
    tagline: value['tagline'],
    intro: value['intro'] ?? null,
    address: value['address'],
    hotline: value['hotline'],
    hotlineTel: value['hotlineTel'],
    mapUrl: mapUrl !== null && /^https:\/\/\S+$/.test(mapUrl) ? mapUrl : null,
    timezone: value['timezone'],
    hours,
    heroImage,
  };
}

function parseService(value: unknown): PublicService | null {
  if (!isRecord(value)) return null;
  if (
    !isString(value['code']) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(value['code']) ||
    !isString(value['name']) ||
    !isNullableString(value['description']) ||
    !isMoney(value['priceMinVnd']) ||
    !isMoney(value['priceMaxVnd']) ||
    (value['pricingUnit'] !== 'PER_SERVICE' && value['pricingUnit'] !== 'PER_NAIL') ||
    !isCount(value['estimatedMinMinutes']) ||
    !isCount(value['estimatedMaxMinutes'])
  ) {
    return null;
  }
  return {
    code: value['code'],
    name: value['name'],
    description: value['description'],
    priceMinVnd: value['priceMinVnd'],
    priceMaxVnd: value['priceMaxVnd'],
    pricingUnit: value['pricingUnit'],
    estimatedMinMinutes: value['estimatedMinMinutes'],
    estimatedMaxMinutes: value['estimatedMaxMinutes'],
  };
}

function parseServiceList(value: unknown): PublicService[] | null {
  if (!Array.isArray(value)) return null;
  const services: PublicService[] = [];
  for (const item of value) {
    const service = parseService(item);
    if (!service) return null;
    services.push(service);
  }
  return services;
}

export function parsePublicServices(value: unknown): PublicServicesResponse | null {
  if (!isRecord(value) || !Array.isArray(value['groups'])) return null;
  const groups: PublicServiceGroup[] = [];
  for (const item of value['groups']) {
    if (!isRecord(item) || !isString(item['code']) || !isString(item['name'])) return null;
    const services = parseServiceList(item['services']);
    if (!services) return null;
    groups.push({ code: item['code'], name: item['name'], services });
  }
  return { groups };
}

export function parseServiceDetail(value: unknown): PublicServiceDetailResponse | null {
  if (!isRecord(value) || !isRecord(value['group'])) return null;
  const service = parseService(value['service']);
  const related = parseServiceList(value['related']);
  if (!service || !related) return null;
  const group = value['group'];
  if (!isString(group['code']) || !isString(group['name'])) return null;
  return { service, group: { code: group['code'], name: group['name'] }, related };
}

// ---------------------------------------------------------------------------------------------------------------
// Wording

/** The price as the menu shows it: "80.000 ₫", "5.000 – 30.000 ₫/ngón". */
export function servicePrice(service: PublicService, locale: Locale): string {
  const price = formatVndRange(service.priceMinVnd, service.priceMaxVnd, locale);
  return service.pricingUnit === 'PER_NAIL'
    ? `${price}${locale === 'vi' ? '/ngón' : '/nail'}`
    : price;
}

/** The customer-facing estimate ("60 phút", "60–90 phút"); never the internal scheduling duration. */
export function serviceEstimate(service: PublicService, locale: Locale): string {
  const unit = locale === 'vi' ? 'phút' : 'min';
  const { estimatedMinMinutes: min, estimatedMaxMinutes: max } = service;
  return min === max ? `${min} ${unit}` : `${min}–${max} ${unit}`;
}

/** The first services of a group for the home cards. */
export const featuredServices = (group: PublicServiceGroup, count = 3): PublicService[] =>
  group.services.slice(0, count);

/** One line for the facts strip: the first open group ("Mỗi ngày: 09:00 – 21:00"), or null when the shop is never open. */
export function hoursHeadline(
  groups: readonly PublicHoursGroup[],
  locale: Locale,
  closedLabel: string,
): HoursLine | null {
  const firstOpen = groups.find((group) => !group.closed);
  if (!firstOpen) return null;
  return hoursLines([firstOpen], locale, closedLabel)[0] ?? null;
}

/** "Chỉ đường": the Owner's map link, else a search for the address. A plain link: no embedded map, no third-party script. */
export function directionsUrl(site: Pick<PublicSiteResponse, 'mapUrl' | 'address'>): string {
  return (
    site.mapUrl ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}`
  );
}

export const telHref = (site: Pick<PublicSiteResponse, 'hotlineTel'>): string =>
  `tel:${site.hotlineTel}`;

export function serviceHref(locale: Locale, code: string): string {
  return `/${locale}/services/${encodeURIComponent(code)}`;
}

/** The booking entry for a service: the member booking page with the service preselected (handled there). */
export function bookServiceHref(locale: Locale, code: string): string {
  return `/${locale}/account/book?service=${encodeURIComponent(code)}`;
}

/** A group filter value from the address bar: a known group code, or '' for all. */
export function groupFilter(
  value: string | string[] | undefined,
  groups: readonly PublicServiceGroup[],
): string {
  const code = Array.isArray(value) ? value[0] : value;
  return code !== undefined && groups.some((group) => group.code === code) ? code : '';
}
