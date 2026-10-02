import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';

/**
 * UX/UI Step S3: how a popup or slide follows a season (design 20.6, Q-S2). Kept apart from the popup, slide and
 * season cores so none of them imports another.
 *
 * Lock order, always: `SEASON_LOCK`, then `POPUP_LOCK` or `SLIDE_LOCK`, then row locks. Every command that
 * writes a season, or writes a popup or slide that may follow one, takes `SEASON_LOCK` first, so a season edit and
 * a linked item's save can never wait on each other.
 */

export const SEASON_LOCK = 4_120_016_503n;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function lockSeasons(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SEASON_LOCK}::bigint)::text`;
}

/**
 * A linked item is live only while its season is enabled. Prisma `where` fragment for popups and slides:
 * unlinked items are unaffected.
 */
export const followsEnabledSeason = {
  OR: [{ seasonId: null }, { season: { is: { isEnabled: true } } }],
};

/** Enabled by its own switch and, when it follows a season, by the season's switch too. */
export const effectivelyEnabled = (
  isEnabled: boolean,
  season: { isEnabled: boolean } | null,
): boolean => isEnabled && (season === null || season.isEnabled);

export interface SeasonWindow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  isEnabled: boolean;
}

export function parseSeasonId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new AuthError('VALIDATION_FAILED', 'seasonId');
  }
  return value.toLowerCase();
}

/** The season an item asks to follow. Must be called after `lockSeasons`, so the answer holds until commit. */
export async function requireSeason(
  tx: Prisma.TransactionClient,
  seasonId: string,
): Promise<SeasonWindow> {
  const season = await tx.websiteSeason.findUnique({
    where: { id: seasonId },
    select: { id: true, startsAt: true, endsAt: true, isEnabled: true },
  });
  if (!season) throw new AuthError('VALIDATION_FAILED', 'seasonId');
  return season;
}
