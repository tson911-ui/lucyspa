import type {
  PublicSlide,
  PublicSlideImage,
  WebsiteSlideEnabledRequest,
  WebsiteSlideInput,
  WebsiteSlideListResponse,
  WebsiteSlideReorderRequest,
  WebsiteSlideResponse,
  WebsiteSlideStatus,
  WebsiteSlideUpdateRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { requireWebsiteContent } from './media.core.js';
import {
  instant,
  pick,
  publicImageSources,
  requireUsableMedia,
  textField,
  UUID,
  validPopupUrl,
  type PublicLocale,
} from './popup.core.js';

/**
 * UX/UI Step 13: the homepage slider (design 16.6). `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided inside
 * every command. A slide is marketing content, not history: a real delete is allowed, at any time. The order
 * is dense (`sortOrder` 0..n-1) and rewritten in one transaction; at most 8 slides may be visible at once.
 */

export const SLIDE_LIMITS = Object.freeze({
  title: 120,
  subtitle: 200,
  linkLabel: 40,
  linkUrl: 500,
  alt: 300,
});
/** Q-CM7: the most slides that may be visible at the same instant. */
export const MAX_VISIBLE_SLIDES = 8;
/**
 * One fixed key serializes every slider command (order, count and the visible limit all depend on the whole
 * set). It is always taken FIRST, before any row lock, so two commands can never wait on each other.
 */
const SLIDE_LOCK = 4_120_016_502n;
const MAX_VERSION = 2_147_483_647;

/** Hidden is "not enabled"; an enabled slide is Scheduled until it starts, Visible while live, then Ended. */
export function slideStatus(
  isEnabled: boolean,
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date,
): WebsiteSlideStatus {
  if (!isEnabled) return 'HIDDEN';
  if (startsAt !== null && now.getTime() < startsAt.getTime()) return 'SCHEDULED';
  if (endsAt !== null && now.getTime() >= endsAt.getTime()) return 'ENDED';
  return 'VISIBLE';
}

export interface SlideWindow {
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * The most slides that are visible at one instant, given the windows of the enabled slides (an open end
 * means "always"). A window that has already ended can never be visible again, so it is ignored. Windows are
 * half-open `[startsAt, endsAt)`: one that ends when another starts does not overlap it.
 */
export function maxConcurrentSlides(windows: readonly SlideWindow[], now: Date): number {
  const events: [number, 1 | -1][] = [];
  for (const window of windows) {
    if (window.endsAt !== null && window.endsAt.getTime() <= now.getTime()) continue;
    events.push([window.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY, 1]);
    events.push([window.endsAt?.getTime() ?? Number.POSITIVE_INFINITY, -1]);
  }
  // At the same instant the ends come first: [a, b) and [b, c) never count together.
  events.sort((x, y) => (x[0] === y[0] ? x[1] - y[1] : x[0] < y[0] ? -1 : 1));
  let open = 0;
  let most = 0;
  for (const [, change] of events) {
    open += change;
    if (open > most) most = open;
  }
  return most;
}

interface SlideFields {
  mediaId: string;
  mobileMediaId: string | null;
  titleVi: string | null;
  titleEn: string | null;
  subtitleVi: string | null;
  subtitleEn: string | null;
  linkUrl: string | null;
  linkLabelVi: string | null;
  linkLabelEn: string | null;
  altVi: string | null;
  altEn: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isEnabled: boolean;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AuthError('VALIDATION_FAILED', field);
  return value.toLowerCase();
}

function optionalInstant(value: unknown, field: string): Date | null {
  return value === null || value === undefined ? null : instant(value, field);
}

/** Everything the DB would refuse, refused first with a field name the form can show. */
export function parseSlideFields(input: WebsiteSlideInput): SlideFields {
  const { title, subtitle, linkLabel, alt } = SLIDE_LIMITS;
  const mediaId = uuid(input.mediaId, 'mediaId');
  const mobileMediaId =
    input.mobileMediaId === null || input.mobileMediaId === undefined
      ? null
      : uuid(input.mobileMediaId, 'mobileMediaId');
  // The same image twice is not a phone image: it is the main image.
  if (mobileMediaId === mediaId) throw new AuthError('VALIDATION_FAILED', 'mobileMediaId');
  const fields: SlideFields = {
    mediaId,
    mobileMediaId,
    titleVi: textField(input.titleVi, 'titleVi', title),
    titleEn: textField(input.titleEn, 'titleEn', title),
    subtitleVi: textField(input.subtitleVi, 'subtitleVi', subtitle),
    subtitleEn: textField(input.subtitleEn, 'subtitleEn', subtitle),
    linkUrl: null,
    linkLabelVi: textField(input.linkLabelVi, 'linkLabelVi', linkLabel),
    linkLabelEn: textField(input.linkLabelEn, 'linkLabelEn', linkLabel),
    altVi: textField(input.altVi, 'altVi', alt),
    altEn: textField(input.altEn, 'altEn', alt),
    startsAt: optionalInstant(input.startsAt, 'startsAt'),
    endsAt: optionalInstant(input.endsAt, 'endsAt'),
    isEnabled: input.isEnabled,
  };
  if (typeof input.isEnabled !== 'boolean') throw new AuthError('VALIDATION_FAILED', 'isEnabled');
  if (input.linkUrl !== null && input.linkUrl !== undefined) {
    if (typeof input.linkUrl !== 'string') throw new AuthError('VALIDATION_FAILED', 'linkUrl');
    const url = input.linkUrl.trim();
    if (url !== '') {
      if (!validPopupUrl(url)) throw new AuthError('VALIDATION_FAILED', 'linkUrl');
      fields.linkUrl = url;
    }
  }
  if (
    fields.startsAt !== null &&
    fields.endsAt !== null &&
    fields.endsAt.getTime() <= fields.startsAt.getTime()
  ) {
    throw new AuthError('VALIDATION_FAILED', 'endsAt');
  }
  const hasLabel = fields.linkLabelVi !== null || fields.linkLabelEn !== null;
  if (fields.linkUrl !== null && !hasLabel) throw new AuthError('VALIDATION_FAILED', 'linkLabel');
  if (fields.linkUrl === null && hasLabel) throw new AuthError('VALIDATION_FAILED', 'linkUrl');
  return fields;
}

const selectMedia = {
  id: true,
  originalFilename: true,
  width: true,
  height: true,
  altVi: true,
  altEn: true,
} as const;

const selectSlide = {
  id: true,
  mediaId: true,
  mobileMediaId: true,
  titleVi: true,
  titleEn: true,
  subtitleVi: true,
  subtitleEn: true,
  linkUrl: true,
  linkLabelVi: true,
  linkLabelEn: true,
  altVi: true,
  altEn: true,
  sortOrder: true,
  startsAt: true,
  endsAt: true,
  isEnabled: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  media: { select: selectMedia },
  mobileMedia: { select: selectMedia },
} as const;

type SlideRow = Prisma.WebsiteSlideGetPayload<{ select: typeof selectSlide }>;
type MediaRow = Prisma.MediaAssetGetPayload<{ select: typeof selectMedia }>;

const mediaOf = (row: MediaRow) => ({
  id: row.id,
  filename: row.originalFilename,
  width: row.width,
  height: row.height,
  altVi: row.altVi,
  altEn: row.altEn,
});

function response(row: SlideRow, now: Date): WebsiteSlideResponse {
  return {
    id: row.id,
    mediaId: row.mediaId,
    media: mediaOf(row.media),
    mobileMediaId: row.mobileMediaId,
    mobileMedia: row.mobileMedia ? mediaOf(row.mobileMedia) : null,
    titleVi: row.titleVi,
    titleEn: row.titleEn,
    subtitleVi: row.subtitleVi,
    subtitleEn: row.subtitleEn,
    linkUrl: row.linkUrl,
    linkLabelVi: row.linkLabelVi,
    linkLabelEn: row.linkLabelEn,
    altVi: row.altVi,
    altEn: row.altEn,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    isEnabled: row.isEnabled,
    position: row.sortOrder + 1,
    status: slideStatus(row.isEnabled, row.startsAt, row.endsAt, now),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What an audit event records: the content, schedule and order, never image bytes. */
function summary(fields: SlideFields, position?: number): Prisma.InputJsonObject {
  return {
    mediaId: fields.mediaId,
    mobileMediaId: fields.mobileMediaId,
    titleVi: fields.titleVi,
    titleEn: fields.titleEn,
    subtitleVi: fields.subtitleVi,
    subtitleEn: fields.subtitleEn,
    linkUrl: fields.linkUrl,
    linkLabelVi: fields.linkLabelVi,
    linkLabelEn: fields.linkLabelEn,
    altVi: fields.altVi,
    altEn: fields.altEn,
    startsAt: fields.startsAt?.toISOString() ?? null,
    endsAt: fields.endsAt?.toISOString() ?? null,
    isEnabled: fields.isEnabled,
    ...(position === undefined ? {} : { position }),
  };
}

const fieldsOf = (row: SlideRow): SlideFields => ({
  mediaId: row.mediaId,
  mobileMediaId: row.mobileMediaId,
  titleVi: row.titleVi,
  titleEn: row.titleEn,
  subtitleVi: row.subtitleVi,
  subtitleEn: row.subtitleEn,
  linkUrl: row.linkUrl,
  linkLabelVi: row.linkLabelVi,
  linkLabelEn: row.linkLabelEn,
  altVi: row.altVi,
  altEn: row.altEn,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  isEnabled: row.isEnabled,
});

async function lockSlides(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SLIDE_LOCK}::bigint)::text`;
}

/** Both images must exist and carry Vietnamese alt text (Q-CM10), locked against a concurrent delete. */
async function requireUsableImages(tx: Prisma.TransactionClient, fields: SlideFields) {
  await requireUsableMedia(tx, fields.mediaId);
  if (fields.mobileMediaId !== null) await requireUsableMedia(tx, fields.mobileMediaId);
}

/**
 * Refuses an enabled slide that would put more than 8 slides on screen at the same instant (Q-CM7). Slides
 * that are hidden, or whose window has ended, do not count.
 */
async function requireVisibleLimit(
  context: AdminContext,
  self: string | null,
  fields: Pick<SlideFields, 'isEnabled' | 'startsAt' | 'endsAt'>,
): Promise<void> {
  if (!fields.isEnabled) return;
  const others = await context.tx.websiteSlide.findMany({
    where: { isEnabled: true, ...(self === null ? {} : { id: { not: self } }) },
    select: { startsAt: true, endsAt: true },
  });
  if (maxConcurrentSlides([...others, fields], context.now) > MAX_VISIBLE_SLIDES) {
    throw new AuthError('SLIDE_LIMIT');
  }
}

const orderedSlides = (tx: Prisma.TransactionClient) =>
  tx.websiteSlide.findMany({ select: selectSlide, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });

export async function listSlides(context: AdminContext): Promise<WebsiteSlideListResponse> {
  requireWebsiteContent(context);
  const rows = await orderedSlides(context.tx);
  return {
    items: rows.map((row) => response(row, context.now)),
    now: context.now.toISOString(),
    maxVisible: MAX_VISIBLE_SLIDES,
  };
}

export async function getSlide(context: AdminContext, id: string): Promise<WebsiteSlideResponse> {
  requireWebsiteContent(context);
  const row = await context.tx.websiteSlide.findUnique({ where: { id }, select: selectSlide });
  if (!row) throw new AuthError('NOT_FOUND');
  return response(row, context.now);
}

export async function createSlide(
  context: AdminContext,
  input: WebsiteSlideInput,
): Promise<WebsiteSlideResponse> {
  requireWebsiteContent(context);
  const fields = parseSlideFields(input);
  await lockSlides(context.tx);
  await requireUsableImages(context.tx, fields);
  await requireVisibleLimit(context, null, fields);
  const last = await context.tx.websiteSlide.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (last._max.sortOrder ?? -1) + 1;
  const created = await context.tx.websiteSlide.create({
    data: {
      ...fields,
      sortOrder,
      createdByUserId: context.actor.userId,
      updatedByUserId: context.actor.userId,
    },
    select: selectSlide,
  });
  await appendAdminAudit(context, {
    action: 'SLIDE_CREATED',
    entityType: 'WebsiteSlide',
    entityId: created.id,
    after: summary(fields, sortOrder + 1),
  });
  return response(created, context.now);
}

async function lockSlide(context: AdminContext, id: string, expectedVersion: unknown) {
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    expectedVersion > MAX_VERSION
  ) {
    throw new AuthError('VALIDATION_FAILED', 'expectedVersion');
  }
  const [locked] = await context.tx.$queryRaw<{ row_version: number }[]>`
    SELECT row_version FROM website_slides WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  if (locked.row_version !== expectedVersion) throw new AuthError('CONFLICT');
  return context.tx.websiteSlide.findUniqueOrThrow({ where: { id }, select: selectSlide });
}

export async function updateSlide(
  context: AdminContext,
  id: string,
  request: WebsiteSlideUpdateRequest,
): Promise<WebsiteSlideResponse> {
  requireWebsiteContent(context);
  const fields = parseSlideFields(request);
  await lockSlides(context.tx);
  const before = await lockSlide(context, id, request.expectedVersion);
  // The image check only matters for an image that changes: a slide keeps working if an image's alt was
  // removed meanwhile (the media API refuses that while the image is in use anyway).
  if (fields.mediaId !== before.mediaId) await requireUsableMedia(context.tx, fields.mediaId);
  if (fields.mobileMediaId !== null && fields.mobileMediaId !== before.mobileMediaId) {
    await requireUsableMedia(context.tx, fields.mobileMediaId);
  }
  await requireVisibleLimit(context, id, fields);
  const updated = await context.tx.websiteSlide.update({
    where: { id },
    data: { ...fields, updatedByUserId: context.actor.userId, rowVersion: { increment: 1 } },
    select: selectSlide,
  });
  await appendAdminAudit(context, {
    action: 'SLIDE_UPDATED',
    entityType: 'WebsiteSlide',
    entityId: id,
    before: summary(fieldsOf(before), before.sortOrder + 1),
    after: summary(fields, before.sortOrder + 1),
  });
  return response(updated, context.now);
}

export async function setSlideEnabled(
  context: AdminContext,
  id: string,
  request: WebsiteSlideEnabledRequest,
): Promise<WebsiteSlideResponse> {
  requireWebsiteContent(context);
  if (typeof request.isEnabled !== 'boolean') throw new AuthError('VALIDATION_FAILED', 'isEnabled');
  await lockSlides(context.tx);
  const before = await lockSlide(context, id, request.expectedVersion);
  if (before.isEnabled === request.isEnabled) return response(before, context.now);
  await requireVisibleLimit(context, id, { ...fieldsOf(before), isEnabled: request.isEnabled });
  const updated = await context.tx.websiteSlide.update({
    where: { id },
    data: {
      isEnabled: request.isEnabled,
      updatedByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    },
    select: selectSlide,
  });
  await appendAdminAudit(context, {
    action: request.isEnabled ? 'SLIDE_ENABLED' : 'SLIDE_DISABLED',
    entityType: 'WebsiteSlide',
    entityId: id,
    before: { isEnabled: before.isEnabled },
    after: { isEnabled: request.isEnabled },
  });
  return response(updated, context.now);
}

/**
 * One call, one transaction: the whole slider in its new order. The list must be exactly the slides that
 * exist, so a slide added or deleted by someone else meanwhile is a `CONFLICT` (reload and arrange again)
 * instead of a silently wrong order.
 */
export async function reorderSlides(
  context: AdminContext,
  request: WebsiteSlideReorderRequest,
): Promise<WebsiteSlideListResponse> {
  requireWebsiteContent(context);
  const requested = request.orderedIds;
  if (!Array.isArray(requested) || requested.length > 1_000) {
    throw new AuthError('VALIDATION_FAILED', 'orderedIds');
  }
  const orderedIds = requested.map((id) => uuid(id, 'orderedIds'));
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new AuthError('VALIDATION_FAILED', 'orderedIds');
  }
  await lockSlides(context.tx);
  const current = await context.tx.websiteSlide.findMany({
    select: { id: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const known = new Set(current.map((slide) => slide.id));
  if (current.length !== orderedIds.length || orderedIds.some((id) => !known.has(id))) {
    throw new AuthError('CONFLICT');
  }
  const changed = orderedIds.filter((id, index) => current[index]?.id !== id);
  if (changed.length > 0) {
    for (const [index, id] of orderedIds.entries()) {
      if (current[index]?.id === id && current[index].sortOrder === index) continue;
      await context.tx.websiteSlide.update({
        where: { id },
        data: { sortOrder: index, updatedByUserId: context.actor.userId },
      });
    }
    await appendAdminAudit(context, {
      action: 'SLIDES_REORDERED',
      entityType: 'WebsiteSlide',
      entityId: orderedIds[0] ?? 'none',
      before: { orderedIds: current.map((slide) => slide.id) },
      after: { orderedIds },
    });
  }
  const rows = await orderedSlides(context.tx);
  return {
    items: rows.map((row) => response(row, context.now)),
    now: context.now.toISOString(),
    maxVisible: MAX_VISIBLE_SLIDES,
  };
}

/** A real delete, allowed at any time (16.8); the order closes up and the audit event keeps what was removed. */
export async function deleteSlide(context: AdminContext, id: string): Promise<void> {
  requireWebsiteContent(context);
  await lockSlides(context.tx);
  const [locked] = await context.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM website_slides WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  const before = await context.tx.websiteSlide.findUniqueOrThrow({
    where: { id },
    select: selectSlide,
  });
  await context.tx.websiteSlide.delete({ where: { id } });
  const rest = await context.tx.websiteSlide.findMany({
    select: { id: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  for (const [index, slide] of rest.entries()) {
    if (slide.sortOrder !== index) {
      await context.tx.websiteSlide.update({ where: { id: slide.id }, data: { sortOrder: index } });
    }
  }
  await appendAdminAudit(context, {
    action: 'SLIDE_DELETED',
    entityType: 'WebsiteSlide',
    entityId: id,
    before: summary(fieldsOf(before), before.sortOrder + 1),
  });
}

// -------------------------------------------------------------------------------------------- public

const selectPublicImage = {
  id: true,
  altVi: true,
  altEn: true,
  width: true,
  height: true,
  variants: { where: { kind: { in: ['MD', 'LG'] } }, select: { kind: true, width: true } },
} satisfies Prisma.MediaAssetSelect;

type PublicImageRow = Prisma.MediaAssetGetPayload<{ select: typeof selectPublicImage }>;

function publicImage(media: PublicImageRow, alt: string): PublicSlideImage {
  return {
    alt,
    width: media.width,
    height: media.height,
    sources: publicImageSources(media.id, media.variants),
  };
}

/**
 * The slides that are visible at `now` (enabled and inside their optional window), in slider order and in the
 * visitor's language, at most 8. The slide's own description wins over the image's.
 */
export async function visibleSlides(
  tx: Prisma.TransactionClient,
  now: Date,
  locale: PublicLocale,
): Promise<PublicSlide[]> {
  const rows = await tx.websiteSlide.findMany({
    where: {
      isEnabled: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: MAX_VISIBLE_SLIDES,
    select: {
      id: true,
      titleVi: true,
      titleEn: true,
      subtitleVi: true,
      subtitleEn: true,
      linkUrl: true,
      linkLabelVi: true,
      linkLabelEn: true,
      altVi: true,
      altEn: true,
      media: { select: selectPublicImage },
      mobileMedia: { select: selectPublicImage },
    },
  });
  return rows.map((row) => {
    const label = pick(row.linkLabelVi, row.linkLabelEn, locale);
    const url =
      row.linkUrl === null || label === null
        ? null
        : row.linkUrl.replace(/^\/\{locale\}(?=\/|$)/, `/${locale}`);
    const alt =
      pick(row.altVi, row.altEn, locale) ?? pick(row.media.altVi, row.media.altEn, locale) ?? '';
    return {
      id: row.id,
      title: pick(row.titleVi, row.titleEn, locale),
      subtitle: pick(row.subtitleVi, row.subtitleEn, locale),
      linkLabel: url === null ? null : label,
      linkUrl: url,
      image: publicImage(row.media, alt),
      mobileImage: row.mobileMedia ? publicImage(row.mobileMedia, alt) : null,
    };
  });
}
