import type { Locale } from '../../i18n/locales';
import { siteDecorSpec, type SiteDecorSpec } from '../../lib/season-core';
import { fetchActiveSeason } from '../../lib/season-server';

export { SeasonSiteFrame, SiteLogo, SiteParticles, SiteSeasonStrip } from './site-frame-view';

/** The site-wide decoration for a language, or null (no season, not for customers, no site art, API down). */
export async function loadSiteDecor(locale: Locale): Promise<SiteDecorSpec | null> {
  return siteDecorSpec(await fetchActiveSeason(locale), locale);
}
