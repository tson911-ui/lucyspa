import type {
  PublicService,
  PublicServiceDetailResponse,
  PublicServiceGroup,
  PublicServicesResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { pick, type PublicLocale } from './popup.core.js';

/**
 * UX/UI Part 2 (P2-2): the service catalogue a visitor reads without signing in (docs/UXUI_REDESIGN_PART2_DESIGN.md
 * 6.2). Only what a menu needs: name, description, price (a range for per-nail work) and the customer-facing time
 * estimate. The internal scheduling duration, ids, skills and branch data never leave the API. A service is listed only
 * while it is active, its category is active and at least one active branch offers it.
 */
const visibleService = {
  isActive: true,
  category: { isActive: true },
  branches: { some: { isActive: true, branch: { isActive: true } } },
} satisfies Prisma.ServiceWhereInput;

const selectService = {
  code: true,
  nameVi: true,
  nameEn: true,
  descriptionVi: true,
  descriptionEn: true,
  priceVnd: true,
  priceMaxVnd: true,
  pricingUnit: true,
  estimatedMinMinutes: true,
  estimatedMaxMinutes: true,
} satisfies Prisma.ServiceSelect;

type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof selectService }>;

const publicService = (row: ServiceRow, locale: PublicLocale): PublicService => ({
  code: row.code,
  name: pick(row.nameVi, row.nameEn, locale) ?? row.code,
  description: pick(row.descriptionVi, row.descriptionEn, locale),
  priceMinVnd: row.priceVnd.toString(),
  priceMaxVnd: row.priceMaxVnd.toString(),
  pricingUnit: row.pricingUnit,
  estimatedMinMinutes: row.estimatedMinMinutes,
  estimatedMaxMinutes: row.estimatedMaxMinutes,
});

/** Cheapest first, then by name in the visitor's language: no per-service order exists (design Q-P2-8). */
function inMenuOrder(rows: readonly ServiceRow[], locale: PublicLocale): PublicService[] {
  return rows
    .map((row) => ({ row, service: publicService(row, locale) }))
    .sort(
      (a, b) =>
        (a.row.priceVnd < b.row.priceVnd ? -1 : a.row.priceVnd > b.row.priceVnd ? 1 : 0) ||
        a.service.name.localeCompare(b.service.name, locale) ||
        a.service.code.localeCompare(b.service.code),
    )
    .map((entry) => entry.service);
}

export async function publicServices(
  tx: Prisma.TransactionClient,
  locale: PublicLocale,
): Promise<PublicServicesResponse> {
  const categories = await tx.serviceCategory.findMany({
    where: { isActive: true, services: { some: visibleService } },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: {
      code: true,
      nameVi: true,
      nameEn: true,
      services: { where: visibleService, select: selectService },
    },
  });
  const groups: PublicServiceGroup[] = categories.map((category) => ({
    code: category.code,
    name: pick(category.nameVi, category.nameEn, locale) ?? category.code,
    services: inMenuOrder(category.services, locale),
  }));
  return { groups };
}

export async function publicServiceDetail(
  tx: Prisma.TransactionClient,
  locale: PublicLocale,
  code: string,
): Promise<PublicServiceDetailResponse> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) throw new AuthError('NOT_FOUND');
  const found = await tx.service.findFirst({
    where: { code, ...visibleService },
    select: {
      ...selectService,
      category: { select: { id: true, code: true, nameVi: true, nameEn: true } },
    },
  });
  if (!found) throw new AuthError('NOT_FOUND');
  const siblings = await tx.service.findMany({
    where: { categoryId: found.category.id, code: { not: found.code }, ...visibleService },
    select: selectService,
  });
  return {
    service: publicService(found, locale),
    group: {
      code: found.category.code,
      name: pick(found.category.nameVi, found.category.nameEn, locale) ?? found.category.code,
    },
    related: inMenuOrder(siblings, locale),
  };
}
