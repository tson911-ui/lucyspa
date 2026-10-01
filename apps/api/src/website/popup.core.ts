import type {
  PublicPopupResponse,
  WebsitePopupEnabledRequest,
  WebsitePopupInput,
  WebsitePopupListResponse,
  WebsitePopupResponse,
  WebsitePopupStatus,
  WebsitePopupUpdateRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { requireWebsiteContent } from './media.core.js';

/**
 * UX/UI Step 12: the promotional popup (design 16.5). `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided inside
 * every command. A popup is marketing content, not history: a real delete is allowed, at any time. At most one
 * ENABLED popup may cover any instant; a save that would break that is refused naming the other popup.
 */

export const POPUP_LIMITS = Object.freeze({ title: 120, body: 300, ctaLabel: 40, ctaUrl: 500 });
/** One fixed key serializes every save that enables a popup, so two saves cannot both pass the overlap check. */
const POPUP_LOCK = 4_120_016_501n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_URL = /^\/(vi|en|\{locale\})(\/[^\s<>"'\\]*)?$/;
const MAX_VERSION = 2_147_483_647;

/** Draft is "not enabled"; an enabled popup is Scheduled until it starts, Active while live, then Ended. */
export function popupStatus(
  isEnabled: boolean,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): WebsitePopupStatus {
  if (!isEnabled) return 'DRAFT';
  if (now.getTime() < startsAt.getTime()) return 'SCHEDULED';
  if (now.getTime() >= endsAt.getTime()) return 'ENDED';
  return 'ACTIVE';
}

/**
 * The link rule of design 16.2: an internal `/vi/...`, `/en/...` or `/{locale}/...` path, or an `https://` URL
 * with a host and no credentials. Never `javascript:`, `data:`, `http:` or a protocol-relative `//host`.
 */
export function validPopupUrl(value: string): boolean {
  if ([...value].length > POPUP_LIMITS.ctaUrl) return false;
  if (INTERNAL_URL.test(value)) return true;
  if (!/^https:\/\/[^\s<>"'\\/]/.test(value) || /[\s<>"'\\]/.test(value)) return false;
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === 'https:' && url.username === '' && url.password === '' && url.hostname !== ''
  );
}

/** Plain text only: NFC, trimmed, empty becomes null. Single-line fields collapse whitespace; the body keeps line breaks. */
function textField(value: unknown, field: string, max: number, multiline = false): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  let text = value.normalize('NFC').replace(/\r\n?/g, '\n');
  text = multiline
    ? text
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : text.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  if ([...text].length > max || /[\p{Cc}]/u.test(text.replace(/\n/g, ''))) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return text;
}

function instant(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  // An instant must name its zone; a bare local time would silently depend on the server's clock.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new AuthError('VALIDATION_FAILED', field);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AuthError('VALIDATION_FAILED', field);
  return date;
}

interface PopupFields {
  mediaId: string | null;
  titleVi: string | null;
  titleEn: string | null;
  bodyVi: string | null;
  bodyEn: string | null;
  ctaLabelVi: string | null;
  ctaLabelEn: string | null;
  ctaUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  isEnabled: boolean;
}

/** Everything the DB would refuse, refused first with a field name the form can show. */
export function parsePopupFields(input: WebsitePopupInput): PopupFields {
  const { title, body, ctaLabel } = POPUP_LIMITS;
  let mediaId: string | null = null;
  if (input.mediaId !== null && input.mediaId !== undefined) {
    if (typeof input.mediaId !== 'string' || !UUID.test(input.mediaId)) {
      throw new AuthError('VALIDATION_FAILED', 'mediaId');
    }
    mediaId = input.mediaId.toLowerCase();
  }
  const fields: PopupFields = {
    mediaId,
    titleVi: textField(input.titleVi, 'titleVi', title),
    titleEn: textField(input.titleEn, 'titleEn', title),
    bodyVi: textField(input.bodyVi, 'bodyVi', body, true),
    bodyEn: textField(input.bodyEn, 'bodyEn', body, true),
    ctaLabelVi: textField(input.ctaLabelVi, 'ctaLabelVi', ctaLabel),
    ctaLabelEn: textField(input.ctaLabelEn, 'ctaLabelEn', ctaLabel),
    ctaUrl: null,
    startsAt: instant(input.startsAt, 'startsAt'),
    endsAt: instant(input.endsAt, 'endsAt'),
    isEnabled: input.isEnabled,
  };
  if (typeof input.isEnabled !== 'boolean') throw new AuthError('VALIDATION_FAILED', 'isEnabled');
  if (input.ctaUrl !== null && input.ctaUrl !== undefined) {
    if (typeof input.ctaUrl !== 'string') throw new AuthError('VALIDATION_FAILED', 'ctaUrl');
    const url = input.ctaUrl.trim();
    if (url !== '') {
      if (!validPopupUrl(url)) throw new AuthError('VALIDATION_FAILED', 'ctaUrl');
      fields.ctaUrl = url;
    }
  }
  if (fields.endsAt.getTime() <= fields.startsAt.getTime()) {
    throw new AuthError('VALIDATION_FAILED', 'endsAt');
  }
  if (fields.mediaId === null && fields.titleVi === null && fields.titleEn === null) {
    throw new AuthError('VALIDATION_FAILED', 'title');
  }
  const hasLabel = fields.ctaLabelVi !== null || fields.ctaLabelEn !== null;
  if (fields.ctaUrl !== null && !hasLabel) throw new AuthError('VALIDATION_FAILED', 'ctaLabel');
  if (fields.ctaUrl === null && hasLabel) throw new AuthError('VALIDATION_FAILED', 'ctaUrl');
  return fields;
}

const selectPopup = {
  id: true,
  mediaId: true,
  titleVi: true,
  titleEn: true,
  bodyVi: true,
  bodyEn: true,
  ctaLabelVi: true,
  ctaLabelEn: true,
  ctaUrl: true,
  startsAt: true,
  endsAt: true,
  isEnabled: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  media: {
    select: {
      id: true,
      originalFilename: true,
      width: true,
      height: true,
      altVi: true,
      altEn: true,
    },
  },
} as const;

type PopupRow = Prisma.WebsitePopupGetPayload<{ select: typeof selectPopup }>;

function response(row: PopupRow, now: Date): WebsitePopupResponse {
  return {
    id: row.id,
    mediaId: row.mediaId,
    media: row.media
      ? {
          id: row.media.id,
          filename: row.media.originalFilename,
          width: row.media.width,
          height: row.media.height,
          altVi: row.media.altVi,
          altEn: row.media.altEn,
        }
      : null,
    titleVi: row.titleVi,
    titleEn: row.titleEn,
    bodyVi: row.bodyVi,
    bodyEn: row.bodyEn,
    ctaLabelVi: row.ctaLabelVi,
    ctaLabelEn: row.ctaLabelEn,
    ctaUrl: row.ctaUrl,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    isEnabled: row.isEnabled,
    status: popupStatus(row.isEnabled, row.startsAt, row.endsAt, now),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What an audit event records: the content and schedule, never image bytes. */
function summary(fields: PopupFields): Prisma.InputJsonObject {
  return {
    mediaId: fields.mediaId,
    titleVi: fields.titleVi,
    titleEn: fields.titleEn,
    bodyVi: fields.bodyVi,
    bodyEn: fields.bodyEn,
    ctaLabelVi: fields.ctaLabelVi,
    ctaLabelEn: fields.ctaLabelEn,
    ctaUrl: fields.ctaUrl,
    startsAt: fields.startsAt.toISOString(),
    endsAt: fields.endsAt.toISOString(),
    isEnabled: fields.isEnabled,
  };
}

const fieldsOf = (row: PopupRow): PopupFields => ({
  mediaId: row.mediaId,
  titleVi: row.titleVi,
  titleEn: row.titleEn,
  bodyVi: row.bodyVi,
  bodyEn: row.bodyEn,
  ctaLabelVi: row.ctaLabelVi,
  ctaLabelEn: row.ctaLabelEn,
  ctaUrl: row.ctaUrl,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  isEnabled: row.isEnabled,
});

/**
 * The picked image must exist and carry Vietnamese alt text (Q-CM10: "required before use"). The row is
 * locked `FOR SHARE`, so a concurrent delete of the image waits for this save instead of racing it.
 */
async function requireUsableMedia(tx: Prisma.TransactionClient, mediaId: string): Promise<void> {
  const [asset] = await tx.$queryRaw<{ alt_vi: string | null }[]>`
    SELECT alt_vi FROM media_assets WHERE id = ${mediaId}::uuid FOR SHARE`;
  if (!asset) throw new AuthError('VALIDATION_FAILED', 'mediaId');
  if (asset.alt_vi === null) throw new AuthError('MEDIA_ALT_REQUIRED', 'mediaId');
}

/**
 * Refuses an enabled popup whose `[startsAt, endsAt)` overlaps another enabled popup (Q-CM2), naming the
 * other popup by id. Windows that only touch (one ends when the next starts) are fine. The lock is held to
 * the end of the transaction, so a second enabling save sees this one.
 */
async function requireNoOverlap(
  tx: Prisma.TransactionClient,
  self: string | null,
  fields: PopupFields,
): Promise<void> {
  if (!fields.isEnabled) return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${POPUP_LOCK}::bigint)::text`;
  const other = await tx.websitePopup.findFirst({
    where: {
      isEnabled: true,
      ...(self === null ? {} : { id: { not: self } }),
      startsAt: { lt: fields.endsAt },
      endsAt: { gt: fields.startsAt },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (other) throw new AuthError('POPUP_OVERLAP', other.id);
}

export async function listPopups(context: AdminContext): Promise<WebsitePopupListResponse> {
  requireWebsiteContent(context);
  const rows = await context.tx.websitePopup.findMany({
    select: selectPopup,
    orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
  });
  return { items: rows.map((row) => response(row, context.now)), now: context.now.toISOString() };
}

export async function getPopup(context: AdminContext, id: string): Promise<WebsitePopupResponse> {
  requireWebsiteContent(context);
  const row = await context.tx.websitePopup.findUnique({ where: { id }, select: selectPopup });
  if (!row) throw new AuthError('NOT_FOUND');
  return response(row, context.now);
}

export async function createPopup(
  context: AdminContext,
  input: WebsitePopupInput,
): Promise<WebsitePopupResponse> {
  requireWebsiteContent(context);
  const fields = parsePopupFields(input);
  if (fields.mediaId !== null) await requireUsableMedia(context.tx, fields.mediaId);
  await requireNoOverlap(context.tx, null, fields);
  const created = await context.tx.websitePopup.create({
    data: {
      ...fields,
      createdByUserId: context.actor.userId,
      updatedByUserId: context.actor.userId,
    },
    select: selectPopup,
  });
  await appendAdminAudit(context, {
    action: 'POPUP_CREATED',
    entityType: 'WebsitePopup',
    entityId: created.id,
    after: summary(fields),
  });
  return response(created, context.now);
}

async function lockPopup(context: AdminContext, id: string, expectedVersion: unknown) {
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    expectedVersion > MAX_VERSION
  ) {
    throw new AuthError('VALIDATION_FAILED', 'expectedVersion');
  }
  const [locked] = await context.tx.$queryRaw<{ row_version: number }[]>`
    SELECT row_version FROM website_popups WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  if (locked.row_version !== expectedVersion) throw new AuthError('CONFLICT');
  return context.tx.websitePopup.findUniqueOrThrow({ where: { id }, select: selectPopup });
}

export async function updatePopup(
  context: AdminContext,
  id: string,
  request: WebsitePopupUpdateRequest,
): Promise<WebsitePopupResponse> {
  requireWebsiteContent(context);
  const fields = parsePopupFields(request);
  const before = await lockPopup(context, id, request.expectedVersion);
  // The image check only matters when the image changes: a popup keeps working if its image's alt was
  // removed meanwhile (the media API refuses that while the image is in use anyway).
  if (fields.mediaId !== null && fields.mediaId !== before.mediaId) {
    await requireUsableMedia(context.tx, fields.mediaId);
  }
  await requireNoOverlap(context.tx, id, fields);
  const updated = await context.tx.websitePopup.update({
    where: { id },
    data: { ...fields, updatedByUserId: context.actor.userId, rowVersion: { increment: 1 } },
    select: selectPopup,
  });
  await appendAdminAudit(context, {
    action: 'POPUP_UPDATED',
    entityType: 'WebsitePopup',
    entityId: id,
    before: summary(fieldsOf(before)),
    after: summary(fields),
  });
  return response(updated, context.now);
}

export async function setPopupEnabled(
  context: AdminContext,
  id: string,
  request: WebsitePopupEnabledRequest,
): Promise<WebsitePopupResponse> {
  requireWebsiteContent(context);
  if (typeof request.isEnabled !== 'boolean') throw new AuthError('VALIDATION_FAILED', 'isEnabled');
  const before = await lockPopup(context, id, request.expectedVersion);
  if (before.isEnabled === request.isEnabled) return response(before, context.now);
  const fields = { ...fieldsOf(before), isEnabled: request.isEnabled };
  await requireNoOverlap(context.tx, id, fields);
  const updated = await context.tx.websitePopup.update({
    where: { id },
    data: {
      isEnabled: request.isEnabled,
      updatedByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    },
    select: selectPopup,
  });
  await appendAdminAudit(context, {
    action: request.isEnabled ? 'POPUP_ENABLED' : 'POPUP_DISABLED',
    entityType: 'WebsitePopup',
    entityId: id,
    before: { isEnabled: before.isEnabled },
    after: { isEnabled: request.isEnabled },
  });
  return response(updated, context.now);
}

/** A real delete, allowed at any time (16.8); the audit event keeps what was removed. */
export async function deletePopup(context: AdminContext, id: string): Promise<void> {
  requireWebsiteContent(context);
  const [locked] = await context.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM website_popups WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  const before = await context.tx.websitePopup.findUniqueOrThrow({
    where: { id },
    select: selectPopup,
  });
  await context.tx.websitePopup.delete({ where: { id } });
  await appendAdminAudit(context, {
    action: 'POPUP_DELETED',
    entityType: 'WebsitePopup',
    entityId: id,
    before: summary(fieldsOf(before)),
  });
}

// -------------------------------------------------------------------------------------------- public

export type PublicLocale = 'vi' | 'en';

/** The visitor's language, then the other one, then nothing (design 16.5). */
const pick = (vi: string | null, en: string | null, locale: PublicLocale): string | null =>
  (locale === 'vi' ? (vi ?? en) : (en ?? vi)) ?? null;

export const publicMediaUrl = (id: string, variant: 'thumb' | 'md' | 'lg') =>
  `/api/v1/public/media/${id}/${variant}`;

/**
 * The one popup that is live at `now` (enabled and inside `[startsAt, endsAt)`), in the visitor's language,
 * or null. If bad data ever let two overlap, the one that started last wins so the answer stays stable.
 */
export async function activePopup(
  tx: Prisma.TransactionClient,
  now: Date,
  locale: PublicLocale,
): Promise<PublicPopupResponse | null> {
  const row = await tx.websitePopup.findFirst({
    where: { isEnabled: true, startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      rowVersion: true,
      titleVi: true,
      titleEn: true,
      bodyVi: true,
      bodyEn: true,
      ctaLabelVi: true,
      ctaLabelEn: true,
      ctaUrl: true,
      media: {
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
  if (!row) return null;
  const ctaLabel = pick(row.ctaLabelVi, row.ctaLabelEn, locale);
  const ctaUrl =
    row.ctaUrl === null || ctaLabel === null
      ? null
      : row.ctaUrl.replace(/^\/\{locale\}(?=\/|$)/, `/${locale}`);
  const media = row.media;
  return {
    id: row.id,
    rowVersion: row.rowVersion,
    title: pick(row.titleVi, row.titleEn, locale),
    body: pick(row.bodyVi, row.bodyEn, locale),
    ctaLabel: ctaUrl === null ? null : ctaLabel,
    ctaUrl,
    image: media
      ? {
          alt: pick(media.altVi, media.altEn, locale) ?? '',
          width: media.width,
          height: media.height,
          // Narrowest first; a small image has the same width in both renditions, so keep only the first.
          sources: media.variants
            .slice()
            .sort((a, b) => a.width - b.width || (a.kind === 'MD' ? -1 : 1))
            .filter((variant, index, all) => index === 0 || variant.width !== all[index - 1]?.width)
            .map((variant) => ({
              url: publicMediaUrl(media.id, variant.kind === 'MD' ? 'md' : 'lg'),
              width: variant.width,
            })),
        }
      : null,
  };
}

/** Is this image shown on the public site right now? (Slides join this check in Step 13.) */
export async function isPubliclyServed(
  tx: Prisma.TransactionClient,
  assetId: string,
  now: Date,
): Promise<boolean> {
  const live = await tx.websitePopup.findFirst({
    where: { mediaId: assetId, isEnabled: true, startsAt: { lte: now }, endsAt: { gt: now } },
    select: { id: true },
  });
  return live !== null;
}
