import type {
  ProductCommitmentLine,
  ProductPublicPageCopy,
  ProductSettingsEditRequest,
  ProductSettingsResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { requireUsableMedia } from '../website/popup.core.js';
import * as input from './product-catalog.input.js';
import { requireManage, requireRead } from './product-catalog.present.js';

/**
 * Phase 6 (P6-3b, P6-4 and P6-6): the one settings row of the product module (`product_settings`, id 1). Reading needs
 * `MANAGE_PRODUCTS` or `MANAGE_PRODUCT_PRICES` (the catalog screens); changing needs `MANAGE_PRODUCTS`. Only the keys present change
 * (the waiting-time pair together; the public page copy as a whole); a stale `expectedRowVersion` is a conflict; every change is
 * audited with before and after.
 */

const SETTINGS_ID = 1;

export const PUBLIC_PAGE_LIMITS = Object.freeze({
  heroTitle: 120,
  heroText: 300,
  commitmentTitle: 80,
  commitmentLine: 120,
  commitmentLines: 6,
  newBadgeDaysMax: 365,
});

const select = {
  leadTimeDaysMin: true,
  leadTimeDaysMax: true,
  expiryWarningDays: true,
  newBadgeDays: true,
  heroMediaId: true,
  heroTitleVi: true,
  heroTitleEn: true,
  heroTextVi: true,
  heroTextEn: true,
  commitmentTitleVi: true,
  commitmentTitleEn: true,
  commitmentItems: true,
  rowVersion: true,
} as const;

type Row = Prisma.ProductSettingsGetPayload<{ select: typeof select }>;

function expiryDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 730) {
    throw new AuthError('VALIDATION_FAILED', 'expiryWarningDays');
  }
  return value;
}

function badgeDays(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > PUBLIC_PAGE_LIMITS.newBadgeDaysMax
  ) {
    throw new AuthError('VALIDATION_FAILED', 'newBadgeDays');
  }
  return value;
}

/** The stored lines, read defensively: a malformed element is dropped, never thrown at a reader. */
export function readCommitmentItems(value: unknown): ProductCommitmentLine[] {
  if (!Array.isArray(value)) return [];
  const lines: ProductCommitmentLine[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { textVi, textEn } = item as Record<string, unknown>;
    if (typeof textVi === 'string' && typeof textEn === 'string') lines.push({ textVi, textEn });
  }
  return lines;
}

export function presentPublicPage(row: Row): ProductPublicPageCopy {
  return {
    heroMediaId: row.heroMediaId,
    heroTitleVi: row.heroTitleVi,
    heroTitleEn: row.heroTitleEn,
    heroTextVi: row.heroTextVi,
    heroTextEn: row.heroTextEn,
    commitmentTitleVi: row.commitmentTitleVi,
    commitmentTitleEn: row.commitmentTitleEn,
    commitmentItems: readCommitmentItems(row.commitmentItems),
  };
}

/** A blank text means "nothing" (null); anything else is checked like every other text. */
function copyText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  if (value.trim() === '') return null;
  return input.optionalText(value, field, max);
}

/** Both languages or neither: a visitor must never meet the other language's text in a block of the page. */
function pair(
  vi: unknown,
  en: unknown,
  field: string,
  max: number,
): { vi: string | null; en: string | null } {
  const result = {
    vi: copyText(vi, `${field}Vi`, max),
    en: copyText(en, `${field}En`, max),
  };
  if ((result.vi === null) !== (result.en === null)) {
    throw new AuthError('VALIDATION_FAILED', result.vi === null ? `${field}Vi` : `${field}En`);
  }
  return result;
}

export function parsePublicPage(value: unknown): ProductPublicPageCopy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthError('VALIDATION_FAILED', 'publicPage');
  }
  const raw = value as Record<string, unknown>;
  const title = pair(
    raw['heroTitleVi'],
    raw['heroTitleEn'],
    'heroTitle',
    PUBLIC_PAGE_LIMITS.heroTitle,
  );
  const text = pair(raw['heroTextVi'], raw['heroTextEn'], 'heroText', PUBLIC_PAGE_LIMITS.heroText);
  const commitment = pair(
    raw['commitmentTitleVi'],
    raw['commitmentTitleEn'],
    'commitmentTitle',
    PUBLIC_PAGE_LIMITS.commitmentTitle,
  );
  const items = raw['commitmentItems'];
  if (!Array.isArray(items) || items.length > PUBLIC_PAGE_LIMITS.commitmentLines) {
    throw new AuthError('VALIDATION_FAILED', 'commitmentItems');
  }
  const lines = (items as unknown[]).map((item): ProductCommitmentLine => {
    const wrong = () => new AuthError('VALIDATION_FAILED', 'commitmentItems');
    if (typeof item !== 'object' || item === null) throw wrong();
    let line;
    try {
      line = pair(
        (item as Record<string, unknown>)['textVi'],
        (item as Record<string, unknown>)['textEn'],
        'commitmentItem',
        PUBLIC_PAGE_LIMITS.commitmentLine,
      );
    } catch {
      throw wrong();
    }
    // A line is written in both languages: an empty one is a form mistake, not a line to skip.
    if (line.vi === null || line.en === null) throw wrong();
    return { textVi: line.vi, textEn: line.en };
  });
  return {
    heroMediaId: input.optionalUuid(raw['heroMediaId'], 'heroMediaId'),
    heroTitleVi: title.vi,
    heroTitleEn: title.en,
    heroTextVi: text.vi,
    heroTextEn: text.en,
    commitmentTitleVi: commitment.vi,
    commitmentTitleEn: commitment.en,
    commitmentItems: lines,
  };
}

/** The copy as plain JSON for the audit record (an interface has no index signature, a spread of it does). */
const auditCopy = (copy: ProductPublicPageCopy) => ({
  ...copy,
  commitmentItems: copy.commitmentItems.map((line) => ({ ...line })),
});

const respond = (row: Row, access: ProductSettingsResponse['access']): ProductSettingsResponse => ({
  leadTimeDaysMin: row.leadTimeDaysMin,
  leadTimeDaysMax: row.leadTimeDaysMax,
  expiryWarningDays: row.expiryWarningDays,
  newBadgeDays: row.newBadgeDays,
  publicPage: presentPublicPage(row),
  rowVersion: row.rowVersion,
  access,
});

export async function getSettings(context: AdminContext): Promise<ProductSettingsResponse> {
  const access = requireRead(context);
  const row = await context.tx.productSettings.findUniqueOrThrow({
    where: { id: SETTINGS_ID },
    select,
  });
  return respond(row, access);
}

export async function editSettings(
  context: AdminContext,
  request: ProductSettingsEditRequest,
): Promise<ProductSettingsResponse> {
  const access = requireManage(context);
  const expected = input.rowVersion(request.expectedRowVersion);
  const lead = input.leadTime(request.leadTimeDaysMin, request.leadTimeDaysMax);
  if (lead && (lead.min === null || lead.max === null)) {
    // The settings default always has a value: it cannot be cleared.
    throw new AuthError('VALIDATION_FAILED', 'leadTimeDays');
  }
  const expiry =
    request.expiryWarningDays === undefined ? undefined : expiryDays(request.expiryWarningDays);
  const newBadge = request.newBadgeDays === undefined ? undefined : badgeDays(request.newBadgeDays);
  const page = request.publicPage === undefined ? undefined : parsePublicPage(request.publicPage);
  const { tx } = context;
  const locked = await tx.$queryRaw<
    { id: number }[]
  >`SELECT id FROM product_settings WHERE id = ${SETTINGS_ID} FOR UPDATE`;
  if (locked.length === 0) throw new AuthError('NOT_FOUND');
  const current = await tx.productSettings.findUniqueOrThrow({
    where: { id: SETTINGS_ID },
    select,
  });
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
  const currentPage = presentPublicPage(current);
  const nextPage = page ?? currentPage;
  const next = {
    leadTimeDaysMin: lead?.min ?? current.leadTimeDaysMin,
    leadTimeDaysMax: lead?.max ?? current.leadTimeDaysMax,
    expiryWarningDays: expiry ?? current.expiryWarningDays,
    newBadgeDays: newBadge ?? current.newBadgeDays,
  };
  const changed =
    next.leadTimeDaysMin !== current.leadTimeDaysMin ||
    next.leadTimeDaysMax !== current.leadTimeDaysMax ||
    next.expiryWarningDays !== current.expiryWarningDays ||
    next.newBadgeDays !== current.newBadgeDays ||
    JSON.stringify(nextPage) !== JSON.stringify(currentPage);
  if (!changed) return respond(current, access);
  // A hero image must exist and carry Vietnamese alt text (media rules); the row is share-locked against a concurrent delete.
  if (nextPage.heroMediaId !== null && nextPage.heroMediaId !== currentPage.heroMediaId) {
    await requireUsableMedia(tx, nextPage.heroMediaId);
  }
  const saved = await tx.productSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      ...next,
      heroMediaId: nextPage.heroMediaId,
      heroTitleVi: nextPage.heroTitleVi,
      heroTitleEn: nextPage.heroTitleEn,
      heroTextVi: nextPage.heroTextVi,
      heroTextEn: nextPage.heroTextEn,
      commitmentTitleVi: nextPage.commitmentTitleVi,
      commitmentTitleEn: nextPage.commitmentTitleEn,
      commitmentItems: nextPage.commitmentItems as unknown as Prisma.InputJsonValue,
      updatedByUserId: context.actor.userId,
      rowVersion: current.rowVersion + 1,
    },
    select,
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_SETTINGS_UPDATED',
    entityType: 'ProductSettings',
    entityId: String(SETTINGS_ID),
    before: {
      leadTimeDaysMin: current.leadTimeDaysMin,
      leadTimeDaysMax: current.leadTimeDaysMax,
      expiryWarningDays: current.expiryWarningDays,
      newBadgeDays: current.newBadgeDays,
      publicPage: auditCopy(currentPage),
    },
    after: { ...next, publicPage: auditCopy(nextPage) },
  });
  return respond(saved, access);
}
