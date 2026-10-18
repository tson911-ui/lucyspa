import type { PublicCampaign, PublicProductPrice } from '@lucy-spa/contracts';
import { Badge, buttonClass, EmptyState, Icon } from '@lucy-spa/ui';
import Link from 'next/link';
import { getCampaignsPublicText } from '../../i18n/campaigns-public';
import type { Locale } from '../../i18n/locales';
import { fill } from '../../lib/fill';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import {
  campaignBanner,
  campaignCtaLabel,
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
      <Link
        href={campaignHref(locale, price.campaign.slug)}
        title={price.campaign.name}
        transitionTypes={NAV_TRANSITION}
      >
        {price.campaign.name}
      </Link>
      {after}
    </p>
  );
}

/**
 * One quiet line for each running campaign (two at most) above the plain list: a tag icon, the campaign's headline in ink and a text link
 * to its sale view (no tinted box, no eyebrow badge: the accent stays on the link). The link names the campaign for assistive technology,
 * so two lines never read as two identical links.
 */
export function CampaignStrips({
  locale,
  campaigns,
  onlineOpen = false,
}: {
  locale: Locale;
  campaigns: readonly PublicCampaign[] | null | undefined;
  /** "Bán online" is ON: only then may the button use the Owner's words ("Mua ngay"). */
  onlineOpen?: boolean;
}) {
  const shown = stripCampaigns(campaigns);
  if (shown.length === 0) return null;
  const text = getCampaignsPublicText(locale);
  return (
    <ul className="ls-camp-strips" aria-label={text.stripsLabel}>
      {shown.map((campaign) => {
        const headline = campaign.headline ?? campaign.name;
        const cta = campaignCtaLabel(campaign, onlineOpen, text.stripCta);
        return (
          <li key={campaign.slug} className="ls-camp-line">
            <Icon name="tag" size={20} aria-hidden="true" />
            <span className="ls-camp-line-text">{headline}</span>
            <Link
              className="ls-link ls-camp-line-link"
              href={campaignHref(locale, campaign.slug)}
              transitionTypes={NAV_TRANSITION}
              aria-label={`${cta}: ${headline}`}
            >
              {cta}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The running offer on the home page: the most recent running campaign, in the Owner's words (badge, headline, message, last day,
 * button) on one neutral card (the accent is never a background: D5, A3), with the campaign's own banner beside the words when the Owner
 * chose one (Admin > Website > Campaigns). The button is the secondary: the hero holds the home page's one filled button (Owner answer 2). The button leads to the sale view and says "Xem ưu đãi" while "Bán online" is OFF (the Owner's own words only when ON).
 * It shows only while the campaign runs (the API only sends the running ones), so it follows the campaign's own schedule.
 */
export function HomeOffer({
  locale,
  campaigns,
  onlineOpen = false,
}: {
  locale: Locale;
  campaigns: readonly PublicCampaign[] | null | undefined;
  /** "Bán online" is ON: the button may use the Owner's words ("Mua ngay"); otherwise it says "Xem ưu đãi". */
  onlineOpen?: boolean;
}) {
  const [campaign] = stripCampaigns(campaigns);
  if (!campaign) return null;
  const text = getCampaignsPublicText(locale);
  const banner = campaignBanner(campaign);
  return (
    <section className="ls-offer-wrap" aria-label={text.stripsLabel}>
      <div className="ls-container">
        <div className="ls-offer-card" data-picture={banner ? 'true' : 'false'}>
          <div className="ls-offer-body">
            <h2 className="ls-offer-title">{campaign.headline ?? campaign.name}</h2>
            {campaign.message ? <p className="ls-offer-message">{campaign.message}</p> : null}
            {/* The badge follows the words (no eyebrow above the title), as on the campaign hero. */}
            {campaign.badge ? <span className="ls-offer-badge">{campaign.badge}</span> : null}
            <p className="ls-offer-until">
              {fill(text.until, { date: campaignEndText(campaign.endsAt, locale) })}
            </p>
            <Link
              className={buttonClass('secondary', 'lg')}
              href={campaignHref(locale, campaign.slug)}
              transitionTypes={NAV_TRANSITION}
            >
              {campaignCtaLabel(campaign, onlineOpen, text.stripCta)}
            </Link>
          </div>
          {banner ? (
            <div className="ls-offer-picture">
              <ProductImage image={banner} sizes="(min-width: 900px) 40vw, 100vw" />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * A campaign link that matches no running campaign (it ended, or the link is stale): the list band says so plainly, with one way on to all
 * cosmetics, instead of an empty filtered list that looks like a search with no result.
 */
export function CampaignEnded({ locale }: { locale: Locale }) {
  const text = getCampaignsPublicText(locale);
  return (
    <EmptyState
      icon="tag"
      title={text.endedTitle}
      action={
        <Link
          className={buttonClass('secondary')}
          href={`/${locale}/products`}
          transitionTypes={NAV_TRANSITION}
        >
          {text.endedAction}
        </Link>
      }
    >
      {text.endedBody}
    </EmptyState>
  );
}

/**
 * The top section of a campaign's sale view: the Owner's banner, headline (the page's one h1), message, badge and last day, and the
 * hero's one filled button (to the list below) with the secondary to all products. It reuses the catalog hero, so the picture sits above
 * the words on a phone and beside them from 768 px.
 */
export function CampaignHero({
  locale,
  campaign,
  onlineOpen = false,
}: {
  locale: Locale;
  campaign: PublicCampaign;
  onlineOpen?: boolean;
}) {
  const text = getCampaignsPublicText(locale);
  const banner = campaignBanner(campaign);
  return (
    <section
      className={`ls-prod-hero${banner ? ' ls-prod-hero-image' : ''}`}
      aria-labelledby="products-title-h1"
    >
      <div className="ls-prod-hero-copy">
        <h1 className="ls-site-display" id="products-title-h1">
          {campaign.headline ?? campaign.name}
        </h1>
        {campaign.message ? <p className="ls-lead">{campaign.message}</p> : null}
        {/* The badge and the last day follow the words (no eyebrow above the title); the badge is neutral, never the accent (B18). */}
        <p className="ls-camp-hero-meta">
          {campaign.badge ? <Badge tone="neutral">{campaign.badge}</Badge> : null}
          <span>{fill(text.until, { date: campaignEndText(campaign.endsAt, locale) })}</span>
        </p>
        <div className="ls-site-actions">
          <a className={buttonClass('primary')} href={`#${PRODUCTS_LIST_ID}`}>
            {campaignCtaLabel(campaign, onlineOpen, text.saleCta)}
          </a>
          <Link
            className={buttonClass('secondary')}
            href={`/${locale}/products`}
            transitionTypes={NAV_TRANSITION}
          >
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
