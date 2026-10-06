import {
  FOOTER_SOCIAL_NETWORKS,
  SHOP_FACT_ICONS,
  WHY_ICONS,
  type FooterSocialNetwork,
  type PublicFact,
  type PublicFeaturedGroup,
  type PublicFooterBlock,
  type PublicHoursGroup,
  type PublicService,
  type PublicServiceDetailResponse,
  type PublicServiceGroup,
  type PublicServicesResponse,
  type PublicSiteResponse,
  type PublicSlide,
  type PublicWhy,
  type ShopFactIcon,
  type WhyIcon,
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

/** What the strip shows when the API does not send a list (a restart in progress): the three built-in facts. */
const DEFAULT_FACTS: PublicFact[] = [
  { kind: 'HOURS', icon: 'clock', text: null },
  { kind: 'ADDRESS', icon: 'map-pin', text: null },
  { kind: 'HOTLINE', icon: 'phone', text: null },
];

function parseFacts(value: unknown): PublicFact[] | null {
  if (value === undefined) return DEFAULT_FACTS;
  if (!Array.isArray(value)) return null;
  const facts: PublicFact[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isNullableString(item['text'])) return null;
    const kind = item['kind'];
    const icon = item['icon'];
    if (kind !== 'HOURS' && kind !== 'ADDRESS' && kind !== 'HOTLINE' && kind !== 'CUSTOM') {
      return null;
    }
    if (typeof icon !== 'string' || !(SHOP_FACT_ICONS as readonly string[]).includes(icon)) {
      return null;
    }
    // A custom fact is its text; a built-in one is drawn by the site from the profile, so it carries none.
    if (kind === 'CUSTOM' && (item['text'] === null || item['text'] === '')) return null;
    facts.push({ kind, icon: icon as ShopFactIcon, text: kind === 'CUSTOM' ? item['text'] : null });
  }
  return facts;
}

function parseFeatured(value: unknown): PublicFeaturedGroup[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const groups: PublicFeaturedGroup[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isString(item['code']) || !isNullableString(item['description'])) {
      return null;
    }
    groups.push({ code: item['code'], description: item['description'] });
  }
  return groups;
}

/** The optional "why choose us" section: absent or null while hidden; a bad shape hides it rather than breaking the home. */
function parseWhy(value: unknown): PublicWhy | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isString(value['title']) || !Array.isArray(value['cards'])) {
    return undefined;
  }
  const cards: PublicWhy['cards'] = [];
  for (const item of value['cards']) {
    if (
      !isRecord(item) ||
      !isString(item['heading']) ||
      !isString(item['description']) ||
      typeof item['icon'] !== 'string' ||
      !(WHY_ICONS as readonly string[]).includes(item['icon'])
    ) {
      return undefined;
    }
    cards.push({
      icon: item['icon'] as WhyIcon,
      heading: item['heading'],
      description: item['description'],
    });
  }
  return cards.length > 0 && value['title'] !== '' ? { title: value['title'], cards } : null;
}

/** A store or social link is drawn as a real link: https with a host, whatever the server says. */
const isHttpsLink = (value: unknown): value is string =>
  isString(value) && /^https:\/\/[^\s<>"'\\/]\S*$/.test(value) && !/[<>"'\\]/.test(value);
/** A link-list or image link: https, or an internal path of a language (`/vi/services`). */
const isSiteLink = (value: unknown): value is string =>
  isHttpsLink(value) || (isString(value) && /^\/(vi|en)(\/[^\s<>"'\\]*)?$/.test(value));

function parseFooterBlock(item: unknown): PublicFooterBlock | null {
  if (!isRecord(item) || !isString(item['id']) || !isString(item['type'])) return null;
  const id = item['id'];
  switch (item['type']) {
    case 'SOCIAL': {
      if (!Array.isArray(item['links'])) return null;
      const links: { network: FooterSocialNetwork; url: string }[] = [];
      for (const link of item['links']) {
        if (
          !isRecord(link) ||
          !(FOOTER_SOCIAL_NETWORKS as readonly string[]).includes(link['network'] as string) ||
          !isHttpsLink(link['url'])
        ) {
          continue;
        }
        links.push({ network: link['network'] as FooterSocialNetwork, url: link['url'] });
      }
      return links.length > 0 ? { id, type: 'SOCIAL', links } : null;
    }
    case 'APP': {
      const googlePlayUrl = isHttpsLink(item['googlePlayUrl']) ? item['googlePlayUrl'] : null;
      const appStoreUrl = isHttpsLink(item['appStoreUrl']) ? item['appStoreUrl'] : null;
      return googlePlayUrl !== null || appStoreUrl !== null
        ? { id, type: 'APP', googlePlayUrl, appStoreUrl }
        : null;
    }
    case 'TEXT':
      return isString(item['text']) && item['text'] !== ''
        ? { id, type: 'TEXT', text: item['text'] }
        : null;
    case 'LINKS': {
      if (!Array.isArray(item['items']) || !isNullableString(item['title'])) return null;
      const items: { label: string; url: string }[] = [];
      for (const entry of item['items']) {
        if (
          isRecord(entry) &&
          isString(entry['label']) &&
          entry['label'] !== '' &&
          isSiteLink(entry['url'])
        ) {
          items.push({ label: entry['label'], url: entry['url'] });
        }
      }
      return items.length > 0 ? { id, type: 'LINKS', title: item['title'] || null, items } : null;
    }
    case 'IMAGE': {
      const image = parseSiteImage(item['image']);
      if (!image || image.sources.length === 0) return null;
      return {
        id,
        type: 'IMAGE',
        image,
        linkUrl: isSiteLink(item['linkUrl']) ? item['linkUrl'] : null,
      };
    }
    case 'SLOGAN':
      return isString(item['text']) && item['text'] !== ''
        ? { id, type: 'SLOGAN', text: item['text'] }
        : null;
    default:
      return null;
  }
}

/**
 * The footer's brand-column blocks. An API that predates the field sends none (the footer then shows only the logo);
 * one block that is malformed or of an unknown type is left out, never the whole site.
 */
function parseFooterBlocks(value: unknown): PublicFooterBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const block = parseFooterBlock(item);
    return block ? [block] : [];
  });
}

/**
 * A contact link (Facebook page, Messenger, Zalo) is drawn as a real link, so only an https link on the network's own host
 * passes, whatever the server says; anything else (or an API that predates the field) means "no such contact".
 */
function contactLink(value: unknown, host: string): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === host &&
      url.username === '' &&
      url.password === ''
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function parsePublicSite(value: unknown): PublicSiteResponse | null {
  if (!isRecord(value)) return null;
  const hours = parseHours(value['hours']);
  const heroImage = parseSiteImage(value['heroImage']);
  const facts = parseFacts(value['facts']);
  const featuredGroups = parseFeatured(value['featuredGroups']);
  const why = parseWhy(value['why']);
  if (
    facts === null ||
    featuredGroups === null ||
    why === undefined ||
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
    footerBlocks: parseFooterBlocks(value['footerBlocks']),
    facts,
    featuredGroups,
    why,
    intro: value['intro'] ?? null,
    address: value['address'],
    hotline: value['hotline'],
    hotlineTel: value['hotlineTel'],
    mapUrl: mapUrl !== null && /^https:\/\/\S+$/.test(mapUrl) ? mapUrl : null,
    facebookUrl: contactLink(value['facebookUrl'], 'www.facebook.com'),
    messengerUrl: contactLink(value['messengerUrl'], 'm.me'),
    zaloUrl: contactLink(value['zaloUrl'], 'zalo.me'),
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
  return formatServicePrice(service, locale, false);
}

/**
 * The price on a home card, one short line: a per-nail price reads "từ 5.000 ₫/ngón" (the lowest price, "from"), never
 * the range the list and the detail page show.
 */
export function cardPrice(service: PublicService, locale: Locale): string {
  return formatServicePrice(service, locale, true);
}

function formatServicePrice(service: PublicService, locale: Locale, short: boolean): string {
  if (short && service.pricingUnit === 'PER_NAIL') {
    const from = formatVndRange(service.priceMinVnd, service.priceMinVnd, locale);
    return locale === 'vi' ? `từ ${from}/ngón` : `from ${from}/nail`;
  }
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

/** A group as the home card shows it: its Owner-written description (null when there is none) and its first services. */
export interface HomeGroup {
  group: PublicServiceGroup;
  description: string | null;
}

/**
 * The cards of "Nhóm dịch vụ nổi bật": the groups the Owner chose, in their order, each with its description. With none
 * chosen (or the shop profile unreadable) every live group of the catalogue is listed without a description. A chosen
 * group that no longer has a visible service is skipped.
 */
export function homeGroups(
  services: PublicServicesResponse,
  site: Pick<PublicSiteResponse, 'featuredGroups'> | null,
): HomeGroup[] {
  const chosen = site?.featuredGroups ?? [];
  if (chosen.length === 0) return services.groups.map((group) => ({ group, description: null }));
  const result: HomeGroup[] = [];
  for (const entry of chosen) {
    const group = services.groups.find((candidate) => candidate.code === entry.code);
    if (group) result.push({ group, description: entry.description });
  }
  return result;
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
