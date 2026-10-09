import type { PublicCampaign, PublicProductPrice } from '@lucy-spa/contracts';
import { Badge, buttonClass, Icon } from '@lucy-spa/ui';
import Link from 'next/link';
import { getCampaignsPublicText } from '../../i18n/campaigns-public';
import type { Locale } from '../../i18n/locales';
import { fill } from '../../lib/fill';
import {
  campaignBanner,
  campaignEndText,
  campaignHref,
  PRODUCTS_LIST_ID,
  stripCampaigns,
} from '../../lib/public-products-core';
import { ProductImage } from './product-image';

/**
 * The public side of promotion campaigns (Wave 4 / P6-23): the line under a price that names the campaign, the slim strips above the
 * plain list and the top section of a campaign's sale view. Every word of a campaign is the Owner's; nothing here is drawn for a campaign
 * that is not running (the API only ever sends the running ones).
 */

/** "Khuyến mãi: <name>" under a price, the name linking to the campaign's sale view. Nothing when the price is not a campaign price. */
export function PriceCampaignLine({
  locale,
  price,
}: {
  locale: Locale;
  price: PublicProductPrice;
}) {
  if (!price.campaign) return null;
  const text = getCampaignsPublicText(locale);
  const [before = '', after = ''] = text.priceFrom.split('{name}');
  return (
    <p className="ls-prod-campaign">
      {before}
      <Link href={campaignHref(locale, price.campaign.slug)} title={price.campaign.name}>
        {price.campaign.name}
      </Link>
      {after}
    </p>
  );
}

/** One slim strip for each running campaign (two at most) above the plain list, each linking to its sale view. */
export function CampaignStrips({
  locale,
  campaigns,
}: {
  locale: Locale;
  campaigns: readonly PublicCampaign[] | null | undefined;
}) {
  const shown = stripCampaigns(campaigns);
  if (shown.length === 0) return null;
  const text = getCampaignsPublicText(locale);
  return (
    <ul className="ls-camp-strips" aria-label={text.stripsLabel}>
      {shown.map((campaign) => (
        <li key={campaign.slug}>
          <Link className="ls-camp-strip" href={campaignHref(locale, campaign.slug)}>
            {campaign.badge ? <Badge tone="brand">{campaign.badge}</Badge> : null}
            <span className="ls-camp-strip-text" title={campaign.headline ?? campaign.name}>
              {campaign.headline ?? campaign.name}
            </span>
            <span className="ls-camp-strip-cta">
              {campaign.ctaLabel ?? text.stripCta}
              <Icon name="chevron-right" size={16} aria-hidden="true" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The top section of a campaign's sale view: the Owner's banner, headline (the page's one h1), message and button. It reuses the
 * catalog hero, so the picture sits above the words on a phone and beside them from 768 px.
 */
export function CampaignHero({ locale, campaign }: { locale: Locale; campaign: PublicCampaign }) {
  const text = getCampaignsPublicText(locale);
  const banner = campaignBanner(campaign);
  return (
    <section
      className={`ls-prod-hero${banner ? ' ls-prod-hero-image' : ''}`}
      aria-labelledby="products-title-h1"
    >
      <div className="ls-prod-hero-copy">
        <p className="ls-camp-hero-meta">
          {campaign.badge ? <Badge tone="brand">{campaign.badge}</Badge> : null}
          <span>{fill(text.until, { date: campaignEndText(campaign.endsAt, locale) })}</span>
        </p>
        <h1 className="ls-site-display" id="products-title-h1">
          {campaign.headline ?? campaign.name}
        </h1>
        {campaign.message ? <p className="ls-lead">{campaign.message}</p> : null}
        <div className="ls-site-actions">
          <a className={buttonClass('primary')} href={`#${PRODUCTS_LIST_ID}`}>
            {campaign.ctaLabel ?? text.saleCta}
          </a>
          <Link className={buttonClass('secondary')} href={`/${locale}/products`}>
            {text.allProducts}
          </Link>
        </div>
      </div>
      {banner ? (
        <div className="ls-prod-hero-picture">
          <ProductImage image={banner} sizes="(min-width: 768px) 50vw, 100vw" priority />
        </div>
      ) : null}
    </section>
  );
}
