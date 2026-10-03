import type {
  PublicHoursGroup,
  PublicSiteResponse,
  WebsiteShopInfoBranchOption,
  WebsiteShopInfoInput,
  WebsiteShopInfoResponse,
  WebsiteShopInfoUpdateRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { requireWebsiteContent } from './media.core.js';
import {
  pick,
  publicImageSources,
  requireUsableMedia,
  textField,
  UUID,
  validPopupUrl,
  type PublicLocale,
} from './popup.core.js';

/**
 * UX/UI Part 2 (P2-2): the public shop profile (docs/UXUI_REDESIGN_PART2_DESIGN.md 6.1). One row. The Owner edits the
 * tagline, address, hotline, map link and hero image here; the opening hours are never stored here, they are read from
 * the operating hours of the chosen branch (the rows the booking engine uses).
 * `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided inside the command like the rest of the website content.
 */
export const SHOP_INFO_LIMITS = Object.freeze({
  tagline: 120,
  intro: 200,
  address: 300,
  hotlineMin: 6,
  hotlineMax: 30,
  hotlineDigitsMin: 8,
  mapUrl: 500,
});
const MAX_VERSION = 2_147_483_647;
const HOTLINE = /^[0-9+().\s-]+$/;

interface ShopInfoFields {
  taglineVi: string;
  taglineEn: string;
  introVi: string | null;
  introEn: string | null;
  address: string;
  hotline: string;
  mapUrl: string | null;
  hoursBranchId: string | null;
  heroMediaId: string | null;
}

const selectShopInfo = {
  taglineVi: true,
  taglineEn: true,
  introVi: true,
  introEn: true,
  address: true,
  hotline: true,
  mapUrl: true,
  hoursBranchId: true,
  heroMediaId: true,
  rowVersion: true,
  updatedAt: true,
} satisfies Prisma.WebsiteShopInfoSelect;

type ShopInfoRow = Prisma.WebsiteShopInfoGetPayload<{ select: typeof selectShopInfo }>;

function required(value: unknown, field: string, max: number): string {
  const text = textField(value, field, max);
  if (text === null) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}

function optionalId(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AuthError('VALIDATION_FAILED', field);
  return value.toLowerCase();
}

/** Digits with a leading plus for `tel:`; a Vietnamese local number (leading 0) becomes `+84...`. */
export function hotlineTel(hotline: string): string {
  const digits = hotline.replace(/\D/g, '');
  if (hotline.trim().startsWith('+')) return `+${digits}`;
  if (digits.startsWith('0')) return `+84${digits.slice(1)}`;
  return `+${digits}`;
}

/** Everything the DB would refuse, refused first with a field name the form can show. */
export function parseShopInfoFields(input: WebsiteShopInfoInput): ShopInfoFields {
  const limits = SHOP_INFO_LIMITS;
  const hotline = required(input.hotline, 'hotline', limits.hotlineMax);
  if (
    [...hotline].length < limits.hotlineMin ||
    !HOTLINE.test(hotline) ||
    hotline.replace(/\D/g, '').length < limits.hotlineDigitsMin
  ) {
    throw new AuthError('VALIDATION_FAILED', 'hotline');
  }
  const mapUrl = textField(input.mapUrl, 'mapUrl', limits.mapUrl);
  // A link to a map: https only (the popup rule also allows internal paths, which make no sense here).
  if (mapUrl !== null && (!/^https:\/\//.test(mapUrl) || !validPopupUrl(mapUrl))) {
    throw new AuthError('VALIDATION_FAILED', 'mapUrl');
  }
  return {
    taglineVi: required(input.taglineVi, 'taglineVi', limits.tagline),
    taglineEn: required(input.taglineEn, 'taglineEn', limits.tagline),
    // Optional: empty becomes null, and the website then shows its built-in sentence.
    introVi: textField(input.introVi, 'introVi', limits.intro),
    introEn: textField(input.introEn, 'introEn', limits.intro),
    address: required(input.address, 'address', limits.address),
    hotline,
    mapUrl,
    hoursBranchId: optionalId(input.hoursBranchId, 'hoursBranchId'),
    heroMediaId: optionalId(input.heroMediaId, 'heroMediaId'),
  };
}

const fieldsOf = (row: ShopInfoRow): ShopInfoFields => ({
  taglineVi: row.taglineVi,
  taglineEn: row.taglineEn,
  introVi: row.introVi,
  introEn: row.introEn,
  address: row.address,
  hotline: row.hotline,
  mapUrl: row.mapUrl,
  hoursBranchId: row.hoursBranchId,
  heroMediaId: row.heroMediaId,
});

// ---------------------------------------------------------------------------------------------------------------
// Opening hours

export interface OperatingDay {
  isoWeekday: number;
  isClosed: boolean;
  opensAtMinute: number | null;
  closesAtMinute: number | null;
}

const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/**
 * Days with the same hours become one group (closed days form their own group), groups ordered by their first day.
 * A weekday with no row counts as closed: the booking engine treats it as not bookable too.
 */
export function groupOperatingHours(days: readonly OperatingDay[]): PublicHoursGroup[] {
  const byDay = new Map(days.map((day) => [day.isoWeekday, day]));
  const groups = new Map<string, PublicHoursGroup>();
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const day = byDay.get(weekday);
    const open =
      day !== undefined &&
      !day.isClosed &&
      day.opensAtMinute !== null &&
      day.closesAtMinute !== null;
    const opensAt = open ? clock(day.opensAtMinute as number) : null;
    const closesAt = open ? clock(day.closesAtMinute as number) : null;
    const key = open ? `${opensAt}-${closesAt}` : 'closed';
    const group = groups.get(key);
    if (group) group.weekdays.push(weekday);
    else groups.set(key, { weekdays: [weekday], closed: !open, opensAt, closesAt });
  }
  return [...groups.values()];
}

/** The branch the hours come from: the chosen active one, else the first active branch (oldest first). */
async function hoursBranch(
  tx: Prisma.TransactionClient,
  chosen: string | null,
): Promise<{ id: string; code: string; name: string; timezone: string } | null> {
  const select = { id: true, code: true, name: true, timezone: true } as const;
  if (chosen !== null) {
    const branch = await tx.branch.findFirst({ where: { id: chosen, isActive: true }, select });
    if (branch) return branch;
  }
  return tx.branch.findFirst({
    where: { isActive: true },
    orderBy: [{ createdAt: 'asc' }, { code: 'asc' }],
    select,
  });
}

async function hoursOf(
  tx: Prisma.TransactionClient,
  branchId: string,
): Promise<PublicHoursGroup[]> {
  const rows = await tx.branchOperatingHours.findMany({
    where: { branchId },
    select: { isoWeekday: true, isClosed: true, opensAtMinute: true, closesAtMinute: true },
  });
  return groupOperatingHours(rows);
}

// ---------------------------------------------------------------------------------------------------------------
// Admin

async function response(
  tx: Prisma.TransactionClient,
  row: ShopInfoRow,
): Promise<WebsiteShopInfoResponse> {
  const branches: WebsiteShopInfoBranchOption[] = await tx.branch.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, name: true },
  });
  const branch = await hoursBranch(tx, row.hoursBranchId);
  return {
    ...fieldsOf(row),
    rowVersion: row.rowVersion,
    updatedAt: row.updatedAt.toISOString(),
    branches,
    hoursBranch: branch ? { id: branch.id, code: branch.code, name: branch.name } : null,
    hours: branch ? await hoursOf(tx, branch.id) : [],
    timezone: branch?.timezone ?? null,
  };
}

export async function getShopInfo(context: AdminContext): Promise<WebsiteShopInfoResponse> {
  requireWebsiteContent(context);
  const row = await context.tx.websiteShopInfo.findUniqueOrThrow({
    where: { id: 'shop' },
    select: selectShopInfo,
  });
  return response(context.tx, row);
}

export async function updateShopInfo(
  context: AdminContext,
  request: WebsiteShopInfoUpdateRequest,
): Promise<WebsiteShopInfoResponse> {
  requireWebsiteContent(context);
  const { expectedVersion } = request;
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    expectedVersion > MAX_VERSION
  ) {
    throw new AuthError('VALIDATION_FAILED', 'expectedVersion');
  }
  const fields = parseShopInfoFields(request);
  const [locked] = await context.tx.$queryRaw<{ row_version: number }[]>`
    SELECT row_version FROM website_shop_info WHERE id = 'shop' FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  if (locked.row_version !== expectedVersion) throw new AuthError('CONFLICT');
  const before = await context.tx.websiteShopInfo.findUniqueOrThrow({
    where: { id: 'shop' },
    select: selectShopInfo,
  });
  if (fields.hoursBranchId !== null) {
    const branch = await context.tx.branch.findFirst({
      where: { id: fields.hoursBranchId, isActive: true },
      select: { id: true },
    });
    if (!branch) throw new AuthError('VALIDATION_FAILED', 'hoursBranchId');
  }
  // The image check only matters when the image changes (design 16.8, as for popups).
  if (fields.heroMediaId !== null && fields.heroMediaId !== before.heroMediaId) {
    try {
      await requireUsableMedia(context.tx, fields.heroMediaId);
    } catch (error) {
      // The popup helper names its own field; the form here calls it heroMediaId.
      if (error instanceof AuthError && error.field === 'mediaId') {
        throw new AuthError(error.code, 'heroMediaId');
      }
      throw error;
    }
  }
  const updated = await context.tx.websiteShopInfo.update({
    where: { id: 'shop' },
    data: { ...fields, updatedByUserId: context.actor.userId, rowVersion: { increment: 1 } },
    select: selectShopInfo,
  });
  await appendAdminAudit(context, {
    action: 'SHOP_INFO_UPDATED',
    entityType: 'WebsiteShopInfo',
    entityId: 'shop',
    before: { ...fieldsOf(before) },
    after: { ...fields },
  });
  return response(context.tx, updated);
}

// ---------------------------------------------------------------------------------------------------------------
// Public

/** What the public site shows about the shop, in the visitor's language. Nothing here is personal or a draft. */
export async function publicSite(
  tx: Prisma.TransactionClient,
  locale: PublicLocale,
): Promise<PublicSiteResponse> {
  const row = await tx.websiteShopInfo.findUniqueOrThrow({
    where: { id: 'shop' },
    select: {
      ...selectShopInfo,
      heroMedia: {
        select: {
          id: true,
          altVi: true,
          altEn: true,
          width: true,
          height: true,
          variants: { where: { kind: { in: ['MD', 'LG'] } }, select: { kind: true, width: true } },
        },
      },
    },
  });
  const branch = await hoursBranch(tx, row.hoursBranchId);
  const media = row.heroMedia;
  return {
    tagline: pick(row.taglineVi, row.taglineEn, locale) ?? '',
    // Never the other language's sentence: null lets the site use its own text in the visitor's language.
    intro: locale === 'vi' ? row.introVi : row.introEn,
    address: row.address,
    hotline: row.hotline,
    hotlineTel: hotlineTel(row.hotline),
    mapUrl: row.mapUrl,
    timezone: branch?.timezone ?? 'Asia/Ho_Chi_Minh',
    hours: branch ? await hoursOf(tx, branch.id) : [],
    heroImage: media
      ? {
          alt: pick(media.altVi, media.altEn, locale) ?? '',
          width: media.width,
          height: media.height,
          sources: publicImageSources(media.id, media.variants),
        }
      : null,
  };
}
