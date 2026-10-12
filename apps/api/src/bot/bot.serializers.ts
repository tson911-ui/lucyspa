import type {
  PublicHoursGroup,
  PublicProductsResponse,
  PublicServicesResponse,
  PublicSiteResponse,
} from '@lucy-spa/contracts';

/**
 * Claude integration Wave A (CI-B1): what the chat bot may read (design `PHASE_CLAUDE_INTEGRATION.md` section 6.2). Every shape here is an
 * allow-list: a field exists in the answer only because it is written below, never because it exists in the source (the sources are the
 * public site's own readers, which already carry no cost, quantity, branch id, internal id, supplier price or customer data). The tests
 * serialize every answer and fail on any key outside `BOT_ALLOWED_KEYS`, and on any text that looks like a code, an e-mail or a comment.
 */

export type BotLocale = 'vi' | 'en';

const WEEKDAYS: Record<BotLocale, readonly string[]> = {
  vi: ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
const TEXT = {
  vi: { everyDay: 'Mỗi ngày', closed: 'Nghỉ', to: 'đến' },
  en: { everyDay: 'Every day', closed: 'Closed', to: 'to' },
} as const;

/** The only keys any bot answer may contain. */
export const BOT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  // envelope
  'ok',
  'version',
  'locale',
  'items',
  'page',
  'pageSize',
  'total',
  // shop
  'shop',
  'name',
  'tagline',
  'address',
  'hotline',
  'mapUrl',
  'facebookUrl',
  'zaloUrl',
  'messengerUrl',
  'timezone',
  'hours',
  'days',
  'opensAt',
  'closesAt',
  'closed',
  'openNow',
  'branches',
  'code',
  // services
  'services',
  'groups',
  'description',
  'priceMinVnd',
  'priceMaxVnd',
  'perNail',
  'durationMinutesMin',
  'durationMinutesMax',
  // promotions
  'promotions',
  'conditions',
  'validFrom',
  'validUntil',
  // products
  'products',
  'brand',
  'category',
  'priceVnd',
  'listPriceVnd',
  'discountPercent',
  'inStock',
  'preOrder',
  'url',
  'isNew',
  // availability
  'availability',
  'branch',
  'date',
  'starts',
  'bookingUrl',
]);

export function hoursLines(groups: readonly PublicHoursGroup[], locale: BotLocale) {
  const names = WEEKDAYS[locale];
  const word = TEXT[locale];
  const label = (days: readonly number[]): string => {
    if (days.length === 7) return word.everyDay;
    const sorted = [...days].sort((a, b) => a - b);
    const runs: number[][] = [];
    for (const day of sorted) {
      const last = runs[runs.length - 1];
      if (last && day === (last[last.length - 1] ?? 0) + 1) last.push(day);
      else runs.push([day]);
    }
    const name = (day: number) => names[day - 1] ?? String(day);
    return runs
      .map((run) => {
        const first = run[0] ?? 0;
        const end = run[run.length - 1] ?? first;
        return run.length === 1
          ? name(first)
          : run.length === 2
            ? `${name(first)}, ${name(end)}`
            : `${name(first)} – ${name(end)}`;
      })
      .join(', ');
  };
  return groups.map((group) => ({
    days: label(group.weekdays),
    closed: group.closed,
    opensAt: group.closed ? null : group.opensAt,
    closesAt: group.closed ? null : group.closesAt,
  }));
}

/** Whether the shop is open at `now` in its own time zone, from the grouped hours; null when the hours are unknown. */
export function openNow(
  groups: readonly PublicHoursGroup[],
  timezone: string,
  now: Date,
): boolean | null {
  if (groups.length === 0) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const group = groups.find((entry) => entry.weekdays.includes(weekday));
  if (!group || group.closed || group.opensAt === null || group.closesAt === null) return false;
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  return minutes >= toMinutes(group.opensAt) && minutes < toMinutes(group.closesAt);
}

export function botShop(
  site: PublicSiteResponse,
  locale: BotLocale,
  branches: readonly { code: string; name: string }[],
  now: Date,
) {
  return {
    name: 'Lucy Spa',
    tagline: site.tagline,
    address: site.address,
    hotline: site.hotline,
    mapUrl: site.mapUrl,
    facebookUrl: site.facebookUrl,
    zaloUrl: site.zaloUrl,
    messengerUrl: site.messengerUrl,
    timezone: site.timezone,
    hours: hoursLines(site.hours, locale),
    openNow: openNow(site.hours, site.timezone, now),
    branches: branches.map((branch) => ({ code: branch.code, name: branch.name })),
  };
}

export function botServices(catalogue: PublicServicesResponse) {
  return {
    groups: catalogue.groups.map((group) => ({
      code: group.code,
      name: group.name,
      services: group.services.map((service) => ({
        code: service.code,
        name: service.name,
        description: service.description,
        priceMinVnd: service.priceMinVnd,
        priceMaxVnd: service.priceMaxVnd,
        perNail: service.pricingUnit === 'PER_NAIL',
        durationMinutesMin: service.estimatedMinMinutes,
        durationMinutesMax: service.estimatedMaxMinutes,
      })),
    })),
  };
}

export function botProducts(result: PublicProductsResponse, locale: BotLocale, origin: string) {
  return {
    items: result.items.map((card) => ({
      code: card.code,
      name: card.name,
      brand: card.brand,
      category: card.category?.name ?? null,
      priceVnd: card.price.priceVnd,
      priceMaxVnd: card.priceMaxVnd,
      listPriceVnd: card.price.listPriceVnd,
      discountPercent: card.price.discountPercent,
      inStock: card.stock.state === 'IN_STOCK',
      preOrder: card.stock.state === 'PRE_ORDER',
      isNew: card.isNew,
      url: `${origin}/${locale}/products/${encodeURIComponent(card.code)}`,
    })),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  };
}

const money = (value: bigint, locale: BotLocale): string =>
  `${value.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')} ₫`;

const day = (value: Date, locale: BotLocale, timezone: string): string =>
  new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);

export interface PromotionSource {
  code: string;
  nameVi: string;
  nameEn: string;
  version: {
    kind: 'PERCENT' | 'FIXED_AMOUNT';
    percentBp: number | null;
    fixedAmountVnd: bigint | null;
    minSpendVnd: bigint;
    scope: 'SERVICES' | 'PRODUCTS' | 'BOTH';
    validFrom: Date;
    validUntil: Date;
  };
}

/** The conditions of a program in plain words; never a code, a limit, a customer or an internal rule. */
export function promotionConditions(
  source: PromotionSource,
  locale: BotLocale,
  timezone: string,
): string {
  const v = source.version;
  const benefit =
    v.kind === 'PERCENT'
      ? locale === 'vi'
        ? `Giảm ${(v.percentBp ?? 0) / 100}%`
        : `${(v.percentBp ?? 0) / 100}% off`
      : locale === 'vi'
        ? `Giảm ${money(v.fixedAmountVnd ?? 0n, locale)}`
        : `${money(v.fixedAmountVnd ?? 0n, locale)} off`;
  const scope =
    locale === 'vi'
      ? v.scope === 'SERVICES'
        ? 'dịch vụ'
        : v.scope === 'PRODUCTS'
          ? 'mỹ phẩm'
          : 'dịch vụ và mỹ phẩm'
      : v.scope === 'SERVICES'
        ? 'services'
        : v.scope === 'PRODUCTS'
          ? 'cosmetics'
          : 'services and cosmetics';
  const minimum =
    v.minSpendVnd > 0n
      ? locale === 'vi'
        ? `, cho hóa đơn từ ${money(v.minSpendVnd, locale)}`
        : `, on a bill from ${money(v.minSpendVnd, locale)}`
      : '';
  const window =
    locale === 'vi'
      ? `. Từ ${day(v.validFrom, locale, timezone)} đến ${day(v.validUntil, locale, timezone)}.`
      : `. From ${day(v.validFrom, locale, timezone)} to ${day(v.validUntil, locale, timezone)}.`;
  return `${benefit} ${locale === 'vi' ? 'cho' : 'on'} ${scope}${minimum}${window}`;
}

export function botPromotions(
  sources: readonly PromotionSource[],
  locale: BotLocale,
  timezone: string,
) {
  return {
    items: sources.map((source) => ({
      name: locale === 'vi' ? source.nameVi : source.nameEn,
      conditions: promotionConditions(source, locale, timezone),
      validFrom: source.version.validFrom.toISOString(),
      validUntil: source.version.validUntil.toISOString(),
    })),
  };
}

/** Every key anywhere in `value` that is not allowed (a test and a development guard use it). */
export function foreignKeys(
  value: unknown,
  allowed: ReadonlySet<string> = BOT_ALLOWED_KEYS,
): string[] {
  const found = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
    } else if (typeof node === 'object' && node !== null) {
      for (const [key, entry] of Object.entries(node)) {
        if (!allowed.has(key)) found.add(key);
        walk(entry);
      }
    }
  };
  walk(value);
  return [...found];
}
