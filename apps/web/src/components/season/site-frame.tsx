import {
  SeasonDivider,
  SeasonFooterScene,
  SeasonFxSwitch,
  SeasonHeaderRow,
  SeasonLogoAccent,
  SeasonSiteParticles,
  SeasonStrip,
} from '@lucy-spa/ui';
import type { ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { seasonText } from '../../i18n/season';
import { fetchActiveSeason } from '../../lib/season-server';
import { siteDecorSpec, type SiteDecorSpec } from '../../lib/season-core';

/** The site-wide decoration for a language, or null (no season, not for customers, no site art, API down). */
export async function loadSiteDecor(locale: Locale): Promise<SiteDecorSpec | null> {
  return siteDecorSpec(await fetchActiveSeason(locale), locale);
}

/** The greeting strip with the per-device effects switch inside its trailing edge (when effects exist). */
export function SiteSeasonStrip({ decor, locale }: { decor: SiteDecorSpec; locale: Locale }) {
  const text = seasonText(locale);
  return (
    <SeasonStrip
      greeting={decor.greeting}
      label={text.band}
      tools={
        decor.particles ? (
          <SeasonFxSwitch labels={{ turnOff: text.fxOff, turnOn: text.fxOn }} />
        ) : undefined
      }
    />
  );
}

/** The wordmark with its seasonal accent, or the plain wordmark without a season. */
export function SiteLogo({
  decor,
  children,
}: {
  decor: SiteDecorSpec | null;
  children: ReactNode;
}) {
  return decor ? <SeasonLogoAccent kit={decor.kit}>{children}</SeasonLogoAccent> : children;
}

/**
 * The public page with its seasonal slots (header row, dividers, strip, footer scene, tint and the particle layer
 * behind the content). `header` and `footer` are the normal site header and footer; the layout renders this frame
 * only when a season with site art applies, so a page without one keeps its exact structure.
 */
export function SeasonSiteFrame({
  decor,
  locale,
  header,
  footer,
  children,
}: {
  decor: SiteDecorSpec;
  locale: Locale;
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ls-site-page">
      {decor.particles ? (
        <SeasonSiteParticles kit={decor.kit} density={decor.density} clearHeaderRow />
      ) : null}
      <SeasonHeaderRow kit={decor.kit} />
      <div className="site-shell">
        {header}
        <SeasonDivider kit={decor.kit} />
        <SiteSeasonStrip decor={decor} locale={locale} />
        {children}
        <SeasonDivider kit={decor.kit} />
      </div>
      <SeasonFooterScene
        kit={decor.kit}
        line={decor.footer.line}
        sub={decor.footer.sub}
        zodiac={decor.zodiac}
      />
      <div className="site-shell site-shell-foot">{footer}</div>
    </div>
  );
}
