import {
  SeasonDivider,
  SeasonFooterScene,
  SeasonFxSwitch,
  SeasonHeaderRow,
  SeasonLogoAccent,
  SeasonSiteParticles,
  SeasonStrip,
  SeasonTintImage,
} from '@lucy-spa/ui';
import type { ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { seasonText } from '../../i18n/season';
import type { SiteDecorSpec } from '../../lib/season-core';

/**
 * The greeting strip with the per-device effects switch inside its trailing edge (when effects exist). An event that
 * switched the strip greeting off keeps only the switch, so a visitor can still turn the effects off.
 */
export function SiteSeasonStrip({ decor, locale }: { decor: SiteDecorSpec; locale: Locale }) {
  const text = seasonText(locale);
  return (
    <SeasonStrip
      greeting={decor.greetingStrip ? decor.greeting : null}
      label={text.band}
      tools={
        decor.particles ? (
          <SeasonFxSwitch labels={{ turnOff: text.fxOff, turnOn: text.fxOn }} />
        ) : undefined
      }
    />
  );
}

/** The wordmark with its seasonal accent, or the plain wordmark without a season (or with the logo slot off). */
export function SiteLogo({
  decor,
  children,
}: {
  decor: SiteDecorSpec | null;
  children: ReactNode;
}) {
  return decor ? (
    <SeasonLogoAccent kit={decor.kit} enabled={decor.slots.logo} image={decor.images.logo}>
      {children}
    </SeasonLogoAccent>
  ) : (
    children
  );
}

/**
 * The page's own particle layer (slot 1) for a spec; null when the slot is off, the schedule has none or the kit has
 * none. Shared by the public page and the member area.
 */
export function SiteParticles({
  decor,
  clearHeaderRow = false,
}: {
  decor: SiteDecorSpec;
  clearHeaderRow?: boolean;
}) {
  return decor.particles ? (
    <SeasonSiteParticles
      kit={decor.kit}
      density={decor.density}
      clearHeaderRow={clearHeaderRow && decor.slots.header}
      sprite={decor.images.particles}
    />
  ) : null;
}

/**
 * The public page with its seasonal slots (header row, dividers, strip, footer scene, tint and the particle layer
 * behind the content). `header` and `footer` are the normal site header and footer; the layout renders this frame
 * only when a season with site art applies, so a page without one keeps its exact structure. A slot the event
 * switched off draws nothing; the dividers keep their plain rule so the rhythm of the page does not change.
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
  const { slots, images } = decor;
  return (
    <div className="ls-site-page" data-tint={slots.tint ? undefined : 'off'}>
      {slots.tint ? <SeasonTintImage image={images.tint} /> : null}
      <SiteParticles decor={decor} clearHeaderRow />
      <SeasonHeaderRow
        kit={decor.kit}
        header={slots.header}
        corners={slots.corners}
        images={images}
      />
      <div className="site-shell">
        {header}
        <SeasonDivider kit={decor.kit} plain={!slots.dividers} image={images.dividers} />
        <SiteSeasonStrip decor={decor} locale={locale} />
        {children}
        <SeasonDivider kit={decor.kit} plain={!slots.dividers} image={images.dividers} />
      </div>
      <SeasonFooterScene
        kit={decor.kit}
        line={decor.footer.line}
        sub={decor.footer.sub}
        zodiac={decor.zodiac}
        art={slots.footer}
        greeting={decor.greetingFooter}
        corners={slots.corners}
        images={images}
      />
      <div className="site-shell site-shell-foot">{footer}</div>
    </div>
  );
}
