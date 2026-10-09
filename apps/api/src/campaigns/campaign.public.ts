import type {
  PublicCampaign,
  PublicCampaignRef,
  PublicCampaignsResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { pick, publicMediaUrl, type PublicLocale } from '../website/popup.core.js';

/**
 * Phase 6 Wave 4 (P6-23): what a visitor learns of a campaign. Anonymous and read-only; only a campaign that is RUNNING NOW is ever shown
 * (published, started, not ended): a draft, a scheduled or an ended campaign does not exist for the public. The internal note, the author and
 * the rules are never part of an answer.
 */
type Tx = Prisma.TransactionClient;

/** The SQL condition of "running now" for the alias `c`; the instant is bound by the caller. */
export const RUNNING = (at: Date) => ({
  publishedAt: { not: null, lte: at },
  startsAt: { lte: at },
  endsAt: { gt: at },
  OR: [{ endedEarlyAt: null }, { endedEarlyAt: { gt: at } }],
});

const select = {
  id: true,
  slug: true,
  nameVi: true,
  nameEn: true,
  badgeVi: true,
  badgeEn: true,
  headlineVi: true,
  headlineEn: true,
  messageVi: true,
  messageEn: true,
  ctaLabelVi: true,
  ctaLabelEn: true,
  bannerMediaId: true,
  endsAt: true,
  endedEarlyAt: true,
} satisfies Prisma.ProductCampaignSelect;

type Row = Prisma.ProductCampaignGetPayload<{ select: typeof select }>;

function refOf(row: Row, locale: PublicLocale): PublicCampaignRef {
  return {
    slug: row.slug,
    name: pick(row.nameVi, row.nameEn, locale) ?? row.slug,
    badge: pick(row.badgeVi, row.badgeEn, locale),
  };
}

export async function runningCampaigns(
  tx: Tx,
  now: Date,
  locale: PublicLocale,
): Promise<PublicCampaignsResponse> {
  const rows = await tx.productCampaign.findMany({
    where: RUNNING(now),
    orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    take: 20,
    select,
  });
  return {
    campaigns: rows.map((row): PublicCampaign => ({
      ...refOf(row, locale),
      headline: pick(row.headlineVi, row.headlineEn, locale),
      message: pick(row.messageVi, row.messageEn, locale),
      ctaLabel: pick(row.ctaLabelVi, row.ctaLabelEn, locale),
      bannerUrl: row.bannerMediaId ? publicMediaUrl(row.bannerMediaId, 'lg') : null,
      endsAt: (row.endedEarlyAt ?? row.endsAt).toISOString(),
    })),
  };
}

/** The badge data of the campaigns that gave the prices of a page of products. */
export async function campaignRefs(
  tx: Tx,
  ids: readonly string[],
  locale: PublicLocale,
): Promise<Map<string, PublicCampaignRef>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.productCampaign.findMany({ where: { id: { in: [...ids] } }, select });
  return new Map(rows.map((row) => [row.id, refOf(row, locale)]));
}

/** The id of a running campaign by its address name, or null. */
export async function runningCampaignId(tx: Tx, slug: string, now: Date): Promise<string | null> {
  const row = await tx.productCampaign.findFirst({
    where: { slug, ...RUNNING(now) },
    select: { id: true },
  });
  return row?.id ?? null;
}
