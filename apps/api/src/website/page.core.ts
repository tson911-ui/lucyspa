import {
  parseRichText,
  validPageSlug,
  validPageSlugFormat,
  WEBSITE_PAGE_LIMITS,
  WEBSITE_PAGE_ROLES,
  type PublicPageIndexResponse,
  type PublicPageLink,
  type PublicPageResponse,
  type WebsitePageInput,
  type WebsitePageListResponse,
  type WebsitePagePublishRequest,
  type WebsitePageResponse,
  type WebsitePageRole,
  type WebsitePageUpdateRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { requireWebsiteContent } from './media.core.js';
import { pick, textField, type PublicLocale } from './popup.core.js';

/**
 * Session 7b: the information pages (about, policies, terms, privacy). `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided inside
 * every command. A page is unpublished, never deleted. The footer's legal line names one published terms page and one published
 * privacy page; every save runs under one advisory lock, so the checks below cannot be raced, and the partial unique index
 * `website_pages_published_legal_key` is the last line of defence.
 */
export const PAGE_LOCK = 4_120_016_502n;
const MAX_VERSION = 2_147_483_647;
const LEGAL_ROLES: readonly WebsitePageRole[] = ['TERMS', 'PRIVACY'];

const selectPage = {
  id: true,
  slug: true,
  role: true,
  titleVi: true,
  titleEn: true,
  bodyVi: true,
  bodyEn: true,
  seoTitleVi: true,
  seoTitleEn: true,
  seoDescriptionVi: true,
  seoDescriptionEn: true,
  isPublished: true,
  rowVersion: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WebsitePageSelect;

type PageRow = Prisma.WebsitePageGetPayload<{ select: typeof selectPage }>;

interface PageFields {
  slug: string;
  role: WebsitePageRole;
  titleVi: string;
  titleEn: string | null;
  bodyVi: string;
  bodyEn: string | null;
  seoTitleVi: string | null;
  seoTitleEn: string | null;
  seoDescriptionVi: string | null;
  seoDescriptionEn: string | null;
  isPublished: boolean;
}

/**
 * One body in the small markup. The text is kept as written (NFC, `\n` line ends, no outer blank lines); it is refused, naming the
 * field, when it breaks the markup rules (raw HTML, an image, a heading level other than `##` and `###`, a link outside the link
 * rule) or the size limit. The same parse draws the page, so what saves is what shows.
 */
function bodyField(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
  if (text === '') return null;
  const parsed = parseRichText(text);
  if (!parsed.ok) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}

export function parsePageFields(input: WebsitePageInput): PageFields {
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
  if (!validPageSlug(slug)) throw new AuthError('VALIDATION_FAILED', 'slug');
  if (!WEBSITE_PAGE_ROLES.includes(input.role)) throw new AuthError('VALIDATION_FAILED', 'role');
  const titleVi = textField(input.titleVi, 'titleVi', WEBSITE_PAGE_LIMITS.title);
  if (titleVi === null) throw new AuthError('VALIDATION_FAILED', 'titleVi');
  const bodyVi = bodyField(input.bodyVi, 'bodyVi');
  if (bodyVi === null) throw new AuthError('VALIDATION_FAILED', 'bodyVi');
  if (typeof input.isPublished !== 'boolean')
    throw new AuthError('VALIDATION_FAILED', 'isPublished');
  return {
    slug,
    role: input.role,
    titleVi,
    titleEn: textField(input.titleEn, 'titleEn', WEBSITE_PAGE_LIMITS.title),
    bodyVi,
    bodyEn: bodyField(input.bodyEn, 'bodyEn'),
    seoTitleVi: textField(input.seoTitleVi, 'seoTitleVi', WEBSITE_PAGE_LIMITS.seoTitle),
    seoTitleEn: textField(input.seoTitleEn, 'seoTitleEn', WEBSITE_PAGE_LIMITS.seoTitle),
    seoDescriptionVi: textField(
      input.seoDescriptionVi,
      'seoDescriptionVi',
      WEBSITE_PAGE_LIMITS.seoDescription,
    ),
    seoDescriptionEn: textField(
      input.seoDescriptionEn,
      'seoDescriptionEn',
      WEBSITE_PAGE_LIMITS.seoDescription,
    ),
    isPublished: input.isPublished,
  };
}

const response = (row: PageRow): WebsitePageResponse => ({
  id: row.id,
  slug: row.slug,
  role: row.role,
  titleVi: row.titleVi,
  titleEn: row.titleEn,
  bodyVi: row.bodyVi,
  bodyEn: row.bodyEn,
  seoTitleVi: row.seoTitleVi,
  seoTitleEn: row.seoTitleEn,
  seoDescriptionVi: row.seoDescriptionVi,
  seoDescriptionEn: row.seoDescriptionEn,
  isPublished: row.isPublished,
  version: row.rowVersion,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** The permanent record of a save: the full text, because the words of a policy are history. */
const record = (row: PageFields | PageRow): Prisma.InputJsonObject => ({
  slug: row.slug,
  role: row.role,
  isPublished: row.isPublished,
  titleVi: row.titleVi,
  titleEn: row.titleEn,
  bodyVi: row.bodyVi,
  bodyEn: row.bodyEn,
});

async function lockPages(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${PAGE_LOCK}::bigint)::text`;
}

async function requireFreeSlug(
  tx: Prisma.TransactionClient,
  slug: string,
  exceptId: string | null,
): Promise<void> {
  const taken = await tx.websitePage.findUnique({ where: { slug }, select: { id: true } });
  if (taken && taken.id !== exceptId) throw new AuthError('CONFLICT', 'slug');
}

/** A published terms or privacy page is unique: another one already holds the role (its id is named so the editor can say which). */
async function requireFreeRole(
  tx: Prisma.TransactionClient,
  fields: Pick<PageFields, 'role' | 'isPublished'>,
  exceptId: string | null,
): Promise<void> {
  if (!fields.isPublished || !LEGAL_ROLES.includes(fields.role)) return;
  const holder = await tx.websitePage.findFirst({
    where: { role: fields.role, isPublished: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (holder) throw new AuthError('PAGE_ROLE_TAKEN', holder.id);
}

export async function listPages(context: AdminContext): Promise<WebsitePageListResponse> {
  requireWebsiteContent(context);
  const rows = await context.tx.websitePage.findMany({
    select: selectPage,
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      role: row.role,
      titleVi: row.titleVi,
      titleEn: row.titleEn,
      isPublished: row.isPublished,
      version: row.rowVersion,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

export async function getPage(context: AdminContext, id: string): Promise<WebsitePageResponse> {
  requireWebsiteContent(context);
  const row = await context.tx.websitePage.findUnique({ where: { id }, select: selectPage });
  if (!row) throw new AuthError('NOT_FOUND');
  return response(row);
}

export async function createPage(
  context: AdminContext,
  input: WebsitePageInput,
): Promise<WebsitePageResponse> {
  requireWebsiteContent(context);
  const fields = parsePageFields(input);
  await lockPages(context.tx);
  await requireFreeSlug(context.tx, fields.slug, null);
  await requireFreeRole(context.tx, fields, null);
  const created = await context.tx.websitePage.create({
    data: {
      ...fields,
      createdByUserId: context.actor.userId,
      updatedByUserId: context.actor.userId,
    },
    select: selectPage,
  });
  await appendAdminAudit(context, {
    action: fields.isPublished ? 'PAGE_CREATED_PUBLISHED' : 'PAGE_CREATED',
    entityType: 'WebsitePage',
    entityId: created.id,
    after: record(fields),
  });
  return response(created);
}

async function lockPage(context: AdminContext, id: string, expectedVersion: unknown) {
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    expectedVersion > MAX_VERSION
  ) {
    throw new AuthError('VALIDATION_FAILED', 'expectedVersion');
  }
  const [locked] = await context.tx.$queryRaw<{ row_version: number }[]>`
    SELECT row_version FROM website_pages WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  if (locked.row_version !== expectedVersion) throw new AuthError('CONFLICT');
  return context.tx.websitePage.findUniqueOrThrow({ where: { id }, select: selectPage });
}

export async function updatePage(
  context: AdminContext,
  id: string,
  request: WebsitePageUpdateRequest,
): Promise<WebsitePageResponse> {
  requireWebsiteContent(context);
  const fields = parsePageFields(request);
  await lockPages(context.tx);
  const before = await lockPage(context, id, request.expectedVersion);
  await requireFreeSlug(context.tx, fields.slug, id);
  await requireFreeRole(context.tx, fields, id);
  const updated = await context.tx.websitePage.update({
    where: { id },
    data: { ...fields, updatedByUserId: context.actor.userId, rowVersion: { increment: 1 } },
    select: selectPage,
  });
  await appendAdminAudit(context, {
    action: 'PAGE_UPDATED',
    entityType: 'WebsitePage',
    entityId: id,
    before: record(before),
    after: record(fields),
  });
  return response(updated);
}

export async function setPagePublished(
  context: AdminContext,
  id: string,
  request: WebsitePagePublishRequest,
): Promise<WebsitePageResponse> {
  requireWebsiteContent(context);
  if (typeof request.isPublished !== 'boolean') {
    throw new AuthError('VALIDATION_FAILED', 'isPublished');
  }
  await lockPages(context.tx);
  const before = await lockPage(context, id, request.expectedVersion);
  if (before.isPublished === request.isPublished) return response(before);
  await requireFreeRole(context.tx, { role: before.role, isPublished: request.isPublished }, id);
  const updated = await context.tx.websitePage.update({
    where: { id },
    data: {
      isPublished: request.isPublished,
      updatedByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    },
    select: selectPage,
  });
  await appendAdminAudit(context, {
    action: request.isPublished ? 'PAGE_PUBLISHED' : 'PAGE_UNPUBLISHED',
    entityType: 'WebsitePage',
    entityId: id,
    before: { slug: before.slug, role: before.role, isPublished: before.isPublished },
    after: { slug: before.slug, role: before.role, isPublished: request.isPublished },
  });
  return response(updated);
}

// ------------------------------------------------------------------ public

/** The language a visitor is served: English only when the page has English text, otherwise the Vietnamese text. */
const servedLanguage = (row: Pick<PageRow, 'bodyEn'>, locale: PublicLocale): PublicLocale =>
  locale === 'en' && row.bodyEn !== null ? 'en' : 'vi';

/** The footer's links: published policy, terms and privacy pages, in the visitor's language, by title. */
export async function publicPageLinks(
  tx: Prisma.TransactionClient,
  locale: PublicLocale,
): Promise<PublicPageLink[]> {
  const rows = await tx.websitePage.findMany({
    where: { isPublished: true, role: { in: ['POLICY', 'TERMS', 'PRIVACY'] } },
    select: { slug: true, role: true, titleVi: true, titleEn: true },
    orderBy: [{ titleVi: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => ({
    slug: row.slug,
    role: row.role,
    title: pick(row.titleVi, row.titleEn, locale) ?? row.titleVi,
  }));
}

/** One published page. A draft, an unpublished page and an unknown address are all the same 404. */
export async function publicPage(
  tx: Prisma.TransactionClient,
  locale: PublicLocale,
  slug: string,
): Promise<PublicPageResponse> {
  if (!validPageSlugFormat(slug)) throw new AuthError('NOT_FOUND');
  const row = await tx.websitePage.findFirst({
    where: { slug, isPublished: true },
    select: selectPage,
  });
  if (!row) throw new AuthError('NOT_FOUND');
  const language = servedLanguage(row, locale);
  const english = language === 'en';
  return {
    slug: row.slug,
    role: row.role,
    title: english ? (row.titleEn ?? row.titleVi) : row.titleVi,
    body: english ? (row.bodyEn ?? row.bodyVi) : row.bodyVi,
    language,
    seoTitle: english ? row.seoTitleEn : row.seoTitleVi,
    seoDescription: english ? row.seoDescriptionEn : row.seoDescriptionVi,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The published pages, for the sitemap. */
export async function publicPageIndex(
  tx: Prisma.TransactionClient,
): Promise<PublicPageIndexResponse> {
  const rows = await tx.websitePage.findMany({
    where: { isPublished: true },
    select: { slug: true, updatedAt: true, bodyEn: true },
    orderBy: [{ slug: 'asc' }],
  });
  return {
    items: rows.map((row) => ({
      slug: row.slug,
      updatedAt: row.updatedAt.toISOString(),
      englishAvailable: row.bodyEn !== null,
    })),
  };
}
