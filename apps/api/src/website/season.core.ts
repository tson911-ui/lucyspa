import {
  getSeasonPreset,
  isSeasonPresetKey,
  SEASON_GREETING_MAX_LENGTH,
  type PublicSeasonResponse,
  type WebsiteSeasonEnabledRequest,
  type WebsiteSeasonInput,
  type WebsiteSeasonListResponse,
  type WebsiteSeasonResponse,
  type WebsiteSeasonStatus,
  type WebsiteSeasonUpdateRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { requireWebsiteContent } from './media.core.js';
import {
  instant,
  lockPopups,
  requireNoOverlap as requireNoPopupOverlap,
  textField,
  type PublicLocale,
} from './popup.core.js';
import { lockSeasons } from './season.link.js';
import { lockSlides, requireVisibleLimitAll } from './slide.core.js';

/**
 * UX/UI Step S3: scheduled seasonal themes (design 20.4). `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided inside
 * every command. A season is marketing content, not history: a real delete is allowed, at any time. At most one
 * ENABLED season may cover any instant; a save that would break that is refused naming the other season.
 *
 * Popups and slides may follow a season (design 20.6): their stored window is the season's window, kept in step
 * by every season save, and they are public only while the season is enabled.
 */

export const SEASON_LABEL_MAX = 80;
const MAX_VERSION = 2_147_483_647;

/** Draft is "not enabled"; an enabled season is Scheduled until it starts, Active while live, then Ended. */
export function seasonStatus(
  isEnabled: boolean,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): WebsiteSeasonStatus {
  if (!isEnabled) return 'DRAFT';
  if (now.getTime() < startsAt.getTime()) return 'SCHEDULED';
  if (now.getTime() >= endsAt.getTime()) return 'ENDED';
  return 'ACTIVE';
}

interface SeasonFields {
  presetKey: string;
  label: string;
  startsAt: Date;
  endsAt: Date;
  greetingVi: string | null;
  greetingEn: string | null;
  applyCustomer: boolean;
  applyAdmin: boolean;
  particlesEnabled: boolean;
  isEnabled: boolean;
}

function flag(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new AuthError('VALIDATION_FAILED', field);
  return value;
}

/** Everything the DB would refuse, refused first with a field name the form can show. */
export function parseSeasonFields(input: WebsiteSeasonInput): SeasonFields {
  if (!isSeasonPresetKey(input.presetKey)) throw new AuthError('VALIDATION_FAILED', 'presetKey');
  const label = textField(input.label, 'label', SEASON_LABEL_MAX);
  if (label === null) throw new AuthError('VALIDATION_FAILED', 'label');
  const fields: SeasonFields = {
    presetKey: input.presetKey,
    label,
    startsAt: instant(input.startsAt, 'startsAt'),
    endsAt: instant(input.endsAt, 'endsAt'),
    greetingVi: textField(input.greetingVi, 'greetingVi', SEASON_GREETING_MAX_LENGTH),
    greetingEn: textField(input.greetingEn, 'greetingEn', SEASON_GREETING_MAX_LENGTH),
    applyCustomer: flag(input.applyCustomer, 'applyCustomer'),
    applyAdmin: flag(input.applyAdmin, 'applyAdmin'),
    particlesEnabled: flag(input.particlesEnabled, 'particlesEnabled'),
    isEnabled: flag(input.isEnabled, 'isEnabled'),
  };
  if (fields.endsAt.getTime() <= fields.startsAt.getTime()) {
    throw new AuthError('VALIDATION_FAILED', 'endsAt');
  }
  return fields;
}

const selectSeason = {
  id: true,
  presetKey: true,
  label: true,
  startsAt: true,
  endsAt: true,
  greetingVi: true,
  greetingEn: true,
  applyCustomer: true,
  applyAdmin: true,
  particlesEnabled: true,
  isEnabled: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
  popups: { select: { id: true, isEnabled: true, startsAt: true, endsAt: true, rowVersion: true } },
  slides: { select: { id: true, isEnabled: true, startsAt: true, endsAt: true, rowVersion: true } },
} as const;

type SeasonRow = Prisma.WebsiteSeasonGetPayload<{ select: typeof selectSeason }>;

const byId = <T extends { id: string }>(items: readonly T[]) => items.map((item) => item.id).sort();

function response(row: SeasonRow, now: Date): WebsiteSeasonResponse {
  return {
    id: row.id,
    presetKey: row.presetKey,
    label: row.label,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    greetingVi: row.greetingVi,
    greetingEn: row.greetingEn,
    applyCustomer: row.applyCustomer,
    applyAdmin: row.applyAdmin,
    particlesEnabled: row.particlesEnabled,
    isEnabled: row.isEnabled,
    status: seasonStatus(row.isEnabled, row.startsAt, row.endsAt, now),
    popupIds: byId(row.popups),
    slideIds: byId(row.slides),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What an audit event records: the schedule and the look, nothing personal. */
function summary(fields: SeasonFields): Prisma.InputJsonObject {
  return {
    presetKey: fields.presetKey,
    label: fields.label,
    startsAt: fields.startsAt.toISOString(),
    endsAt: fields.endsAt.toISOString(),
    greetingVi: fields.greetingVi,
    greetingEn: fields.greetingEn,
    applyCustomer: fields.applyCustomer,
    applyAdmin: fields.applyAdmin,
    particlesEnabled: fields.particlesEnabled,
    isEnabled: fields.isEnabled,
  };
}

const fieldsOf = (row: SeasonRow): SeasonFields => ({
  presetKey: row.presetKey,
  label: row.label,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  greetingVi: row.greetingVi,
  greetingEn: row.greetingEn,
  applyCustomer: row.applyCustomer,
  applyAdmin: row.applyAdmin,
  particlesEnabled: row.particlesEnabled,
  isEnabled: row.isEnabled,
});

/**
 * Refuses an enabled season whose `[startsAt, endsAt)` overlaps another enabled season (Q-S11), naming the
 * other season by id. Windows that only touch (one ends when the next starts) are fine. Needs `lockSeasons`
 * first, which is held to the end of the transaction, so a second enabling save sees this one.
 */
async function requireNoOverlap(
  tx: Prisma.TransactionClient,
  self: string | null,
  fields: Pick<SeasonFields, 'isEnabled' | 'startsAt' | 'endsAt'>,
): Promise<void> {
  if (!fields.isEnabled) return;
  const other = await tx.websiteSeason.findFirst({
    where: {
      isEnabled: true,
      ...(self === null ? {} : { id: { not: self } }),
      startsAt: { lt: fields.endsAt },
      endsAt: { gt: fields.startsAt },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (other) throw new AuthError('SEASON_OVERLAP', other.id);
}

export async function listSeasons(context: AdminContext): Promise<WebsiteSeasonListResponse> {
  requireWebsiteContent(context);
  const rows = await context.tx.websiteSeason.findMany({
    select: selectSeason,
    orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
  });
  return { items: rows.map((row) => response(row, context.now)), now: context.now.toISOString() };
}

export async function getSeason(context: AdminContext, id: string): Promise<WebsiteSeasonResponse> {
  requireWebsiteContent(context);
  const row = await context.tx.websiteSeason.findUnique({ where: { id }, select: selectSeason });
  if (!row) throw new AuthError('NOT_FOUND');
  return response(row, context.now);
}

export async function createSeason(
  context: AdminContext,
  input: WebsiteSeasonInput,
): Promise<WebsiteSeasonResponse> {
  requireWebsiteContent(context);
  const fields = parseSeasonFields(input);
  await lockSeasons(context.tx);
  await requireNoOverlap(context.tx, null, fields);
  const created = await context.tx.websiteSeason.create({
    data: {
      ...fields,
      createdByUserId: context.actor.userId,
      updatedByUserId: context.actor.userId,
    },
    select: selectSeason,
  });
  await appendAdminAudit(context, {
    action: 'SEASON_CREATED',
    entityType: 'WebsiteSeason',
    entityId: created.id,
    after: summary(fields),
  });
  return response(created, context.now);
}

async function lockSeason(context: AdminContext, id: string, expectedVersion: unknown) {
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    expectedVersion > MAX_VERSION
  ) {
    throw new AuthError('VALIDATION_FAILED', 'expectedVersion');
  }
  const [locked] = await context.tx.$queryRaw<{ row_version: number }[]>`
    SELECT row_version FROM website_seasons WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  if (locked.row_version !== expectedVersion) throw new AuthError('CONFLICT');
  return context.tx.websiteSeason.findUniqueOrThrow({ where: { id }, select: selectSeason });
}

/**
 * Brings the popups and slides that follow a season in step with it, then re-checks them under the season's new
 * state. Their stored window becomes the season's window (and their version moves, so a form opened on the old
 * window gets a conflict). If the season is enabled, the popup overlap rule and the visible-slide limit are
 * checked as if each item had just been saved; a failure rolls the whole season save back, naming the conflict
 * (`POPUP_OVERLAP`, `SLIDE_LIMIT`). The audit event records which items moved.
 */
async function followersCatchUp(
  context: AdminContext,
  season: SeasonRow,
  recheck: boolean,
): Promise<{ popupIds: string[]; slideIds: string[] }> {
  const { tx } = context;
  const stale = <T extends { startsAt: Date | null; endsAt: Date | null }>(item: T) =>
    item.startsAt?.getTime() !== season.startsAt.getTime() ||
    item.endsAt?.getTime() !== season.endsAt.getTime();
  const popups = season.popups;
  const slides = season.slides;
  if (popups.length === 0 && slides.length === 0) return { popupIds: [], slideIds: [] };
  await lockPopups(tx);
  await lockSlides(tx);
  const window = { startsAt: season.startsAt, endsAt: season.endsAt };
  const movedPopups = popups.filter(stale).map((popup) => popup.id);
  const movedSlides = slides.filter(stale).map((slide) => slide.id);
  const touch = { updatedByUserId: context.actor.userId, rowVersion: { increment: 1 } };
  if (movedPopups.length > 0) {
    await tx.websitePopup.updateMany({
      where: { id: { in: movedPopups } },
      data: { ...window, ...touch },
    });
  }
  if (movedSlides.length > 0) {
    await tx.websiteSlide.updateMany({
      where: { id: { in: movedSlides } },
      data: { ...window, ...touch },
    });
  }
  if (season.isEnabled && (recheck || movedPopups.length > 0 || movedSlides.length > 0)) {
    for (const popup of popups.filter((candidate) => candidate.isEnabled)) {
      await requireNoPopupOverlap(tx, popup.id, { isEnabled: true, ...window }, season);
    }
    if (slides.some((slide) => slide.isEnabled)) await requireVisibleLimitAll(context);
  }
  return { popupIds: movedPopups, slideIds: movedSlides };
}

export async function updateSeason(
  context: AdminContext,
  id: string,
  request: WebsiteSeasonUpdateRequest,
): Promise<WebsiteSeasonResponse> {
  requireWebsiteContent(context);
  const fields = parseSeasonFields(request);
  await lockSeasons(context.tx);
  const before = await lockSeason(context, id, request.expectedVersion);
  await requireNoOverlap(context.tx, id, fields);
  await context.tx.websiteSeason.update({
    where: { id },
    data: { ...fields, updatedByUserId: context.actor.userId, rowVersion: { increment: 1 } },
  });
  const updated = await context.tx.websiteSeason.findUniqueOrThrow({
    where: { id },
    select: selectSeason,
  });
  const moved = await followersCatchUp(context, updated, !before.isEnabled && fields.isEnabled);
  await appendAdminAudit(context, {
    action: 'SEASON_UPDATED',
    entityType: 'WebsiteSeason',
    entityId: id,
    before: summary(fieldsOf(before)),
    after: { ...summary(fields), ...followersNote(moved) },
  });
  return response(updated, context.now);
}

const followersNote = (moved: {
  popupIds: string[];
  slideIds: string[];
}): Prisma.InputJsonObject =>
  moved.popupIds.length === 0 && moved.slideIds.length === 0
    ? {}
    : { syncedPopupIds: moved.popupIds, syncedSlideIds: moved.slideIds };

export async function setSeasonEnabled(
  context: AdminContext,
  id: string,
  request: WebsiteSeasonEnabledRequest,
): Promise<WebsiteSeasonResponse> {
  requireWebsiteContent(context);
  if (typeof request.isEnabled !== 'boolean') throw new AuthError('VALIDATION_FAILED', 'isEnabled');
  await lockSeasons(context.tx);
  const before = await lockSeason(context, id, request.expectedVersion);
  if (before.isEnabled === request.isEnabled) return response(before, context.now);
  await requireNoOverlap(context.tx, id, { ...fieldsOf(before), isEnabled: request.isEnabled });
  await context.tx.websiteSeason.update({
    where: { id },
    data: {
      isEnabled: request.isEnabled,
      updatedByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    },
  });
  const updated = await context.tx.websiteSeason.findUniqueOrThrow({
    where: { id },
    select: selectSeason,
  });
  await followersCatchUp(context, updated, request.isEnabled);
  await appendAdminAudit(context, {
    action: request.isEnabled ? 'SEASON_ENABLED' : 'SEASON_DISABLED',
    entityType: 'WebsiteSeason',
    entityId: id,
    before: { isEnabled: before.isEnabled },
    after: { isEnabled: request.isEnabled },
  });
  return response(updated, context.now);
}

/**
 * A real delete, allowed at any time (16.8, Owner rule A). The popups and slides that follow the season are
 * unlinked and hidden first, so nothing stays public by surprise; the audit events keep what was removed and
 * which items were hidden.
 */
export async function deleteSeason(context: AdminContext, id: string): Promise<void> {
  requireWebsiteContent(context);
  const { tx } = context;
  await lockSeasons(tx);
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM website_seasons WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  const before = await tx.websiteSeason.findUniqueOrThrow({ where: { id }, select: selectSeason });
  const popupIds = byId(before.popups);
  const slideIds = byId(before.slides);
  if (popupIds.length > 0 || slideIds.length > 0) {
    await lockPopups(tx);
    await lockSlides(tx);
    const unlink = {
      seasonId: null,
      isEnabled: false,
      updatedByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    };
    await tx.websitePopup.updateMany({ where: { seasonId: id }, data: unlink });
    await tx.websiteSlide.updateMany({ where: { seasonId: id }, data: unlink });
    for (const popup of before.popups.filter((item) => item.isEnabled)) {
      await appendAdminAudit(context, {
        action: 'POPUP_DISABLED',
        entityType: 'WebsitePopup',
        entityId: popup.id,
        reason: 'SEASON_DELETED',
        before: { isEnabled: true, seasonId: id },
        after: { isEnabled: false, seasonId: null },
      });
    }
    for (const slide of before.slides.filter((item) => item.isEnabled)) {
      await appendAdminAudit(context, {
        action: 'SLIDE_DISABLED',
        entityType: 'WebsiteSlide',
        entityId: slide.id,
        reason: 'SEASON_DELETED',
        before: { isEnabled: true, seasonId: id },
        after: { isEnabled: false, seasonId: null },
      });
    }
  }
  await tx.websiteSeason.delete({ where: { id } });
  await appendAdminAudit(context, {
    action: 'SEASON_DELETED',
    entityType: 'WebsiteSeason',
    entityId: id,
    before: {
      ...summary(fieldsOf(before)),
      unlinkedPopupIds: popupIds,
      unlinkedSlideIds: slideIds,
    },
  });
}

// -------------------------------------------------------------------------------------------- public

/**
 * The one season that is live at `now` (enabled and inside `[startsAt, endsAt)`), in the visitor's language, or
 * null. A season that switches both sides off, or whose preset is no longer in the registry, answers null. If
 * bad data ever let two overlap, the one that started last wins so the answer stays stable.
 */
export async function activeSeason(
  tx: Prisma.TransactionClient,
  now: Date,
  locale: PublicLocale,
): Promise<PublicSeasonResponse | null> {
  const row = await tx.websiteSeason.findFirst({
    where: { isEnabled: true, startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    select: {
      presetKey: true,
      endsAt: true,
      greetingVi: true,
      greetingEn: true,
      applyCustomer: true,
      applyAdmin: true,
      particlesEnabled: true,
    },
  });
  if (!row || !isSeasonPresetKey(row.presetKey)) return null;
  if (!row.applyCustomer && !row.applyAdmin) return null;
  const preset = getSeasonPreset(row.presetKey);
  const own = locale === 'vi' ? row.greetingVi : row.greetingEn;
  return {
    presetKey: row.presetKey,
    greeting: own ?? preset.greeting[locale],
    endsAt: row.endsAt.toISOString(),
    // Particles are customer decoration only: the admin side never has any.
    particles: row.particlesEnabled && row.applyCustomer,
    customer: row.applyCustomer,
    admin: row.applyAdmin,
  };
}
