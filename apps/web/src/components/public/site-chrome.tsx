import type { PublicSiteResponse } from '@lucy-spa/contracts';
import Link from 'next/link';
import { BrandIcon, BrandWordmark, buttonClass, SiteFooter, type FooterColumn } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { fill } from '../../lib/fill';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { hoursHeadline, telHref } from '../../lib/public-site-core';
import { footerDiscoverItems } from '../../lib/site-nav';
import type { SiteDecorSpec } from '../../lib/season-core';
import { SiteLogo } from '../season/site-frame-view';
import { footerBlockItems } from './footer-blocks';
import { PublicHeaderCta, PublicNav, PublicSiteHeader, PublicTools } from './site-chrome-client';

/**
 * The shared site header (Part 2 contract 3, 5.1): brand, menu, language/theme/account tools and the booking call to
 * action. The public layout, the member area and the admin's season preview draw the same piece, so what the Owner
 * previews is the page a visitor gets.
 */
export function PublicHeader({
  locale,
  decor,
  hasProducts = true,
}: {
  locale: Locale;
  /** The season's site decoration (logo accent), or null for the plain wordmark. */
  decor: SiteDecorSpec | null;
  /** False while no product is published: the Mỹ phẩm menu entry is left out. */
  hasProducts?: boolean;
}) {
  const text = getSiteText(locale);
  return (
    <PublicSiteHeader
      brand={
        <Link
          href={`/${locale}`}
          aria-label={text.header.brand}
          prefetch
          transitionTypes={NAV_TRANSITION}
        >
          <SiteLogo decor={decor}>
            <BrandWordmark serif />
          </SiteLogo>
        </Link>
      }
      nav={<PublicNav locale={locale} hasProducts={hasProducts} />}
      tools={<PublicTools locale={locale} />}
      cta={<PublicHeaderCta locale={locale} />}
    />
  );
}

export function PublicFooter({
  locale,
  site,
  year,
  hasProducts = true,
}: {
  locale: Locale;
  /** The shop profile; null when it could not be read (the footer then has no contact column). */
  site: PublicSiteResponse | null;
  year?: number;
  hasProducts?: boolean;
}) {
  const text = getSiteText(locale);
  const hours = site ? hoursHeadline(site.hours, locale, getSiteText(locale).home.closed) : null;
  // The shop's real data, in the order of the reference: brand and tagline, contact, links.
  const [phoneBefore = '', phoneAfter = ''] = text.footer.phone.split('{value}');
  // The Facebook page and Zalo icons next to the contact lines (Owner request 2026-10-06): monochrome like the other footer
  // links, the official colour on hover; an empty link leaves its icon out.
  const newTab = (name: string) => fill(text.footer.newTab, { name });
  const contactIcons =
    site && (site.facebookUrl || site.zaloUrl) ? (
      <span key="icons" className="ls-footer-icons" role="group" aria-label={text.footer.social}>
        {site.facebookUrl ? (
          <a
            className="ls-footer-icon"
            data-network="facebook"
            href={site.facebookUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={newTab(text.footer.networks.facebook)}
          >
            <BrandIcon name="facebook" size={24} />
          </a>
        ) : null}
        {site.zaloUrl ? (
          <a
            className="ls-footer-icon"
            data-network="zalo"
            href={site.zaloUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={newTab(text.footer.networks.zalo)}
          >
            <BrandIcon name="zalo" size={32} />
          </a>
        ) : null}
      </span>
    ) : null;
  const columns: FooterColumn[] = [
    ...(site
      ? [
          {
            key: 'contact',
            title: text.footer.contact,
            items: [
              site.address,
              <span key="tel">
                {phoneBefore}
                <a href={telHref(site)}>{site.hotline}</a>
                {phoneAfter}
              </span>,
              ...(hours ? [`${hours.label}: ${hours.value}`] : []),
              ...(contactIcons ? [contactIcons] : []),
            ],
          },
        ]
      : []),
    {
      key: 'links',
      title: text.footer.links,
      items: [
        ...footerDiscoverItems(locale, text.nav, hasProducts).map((item) => (
          <Link key={item.key} href={item.href} prefetch transitionTypes={NAV_TRANSITION}>
            {item.label}
          </Link>
        )),
        <Link key="in" href={`/${locale}/account/login`} prefetch transitionTypes={NAV_TRANSITION}>
          {text.footer.signInUp}
        </Link>,
      ],
    },
  ];
  return (
    <SiteFooter
      brand={
        <>
          <Link
            href={`/${locale}`}
            aria-label={text.header.brand}
            className="ls-site-footer-logo"
            prefetch
            transitionTypes={NAV_TRANSITION}
          >
            <BrandWordmark serif />
          </Link>
          {/* The shop's own tagline (Admin > Website > Shop info), nothing written here. */}
          {site?.tagline ? <p className="ls-footer-tagline">{site.tagline}</p> : null}
          {/* The one booking call to action closes the page (the same words as the header and the tab bar). */}
          <Link
            className={buttonClass('secondary', 'md', 'ls-site-footer-cta')}
            href={`/${locale}/account/book`}
            prefetch
            transitionTypes={NAV_TRANSITION}
          >
            {text.header.bookNow}
          </Link>
        </>
      }
      blocks={footerBlockItems(site?.footerBlocks ?? [], locale)}
      columns={columns}
      base={text.footer.rights.replace('{year}', String(year ?? new Date().getFullYear()))}
    />
  );
}
