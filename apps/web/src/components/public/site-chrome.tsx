import type { PublicSiteResponse } from '@lucy-spa/contracts';
import Link from 'next/link';
import { BrandWordmark, SiteFooter, SiteHeader, type FooterColumn } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { hoursHeadline, telHref } from '../../lib/public-site-core';
import { footerDiscoverItems } from '../../lib/site-nav';
import type { SiteDecorSpec } from '../../lib/season-core';
import { SiteLogo } from '../season/site-frame-view';
import { PublicHeaderCta, PublicNav, PublicTools } from './site-chrome-client';

/**
 * The shared site header (Part 2 contract 3, 5.1): brand, menu, language/theme/account tools and the booking call to
 * action. The public layout, the member area and the admin's season preview draw the same piece, so what the Owner
 * previews is the page a visitor gets.
 */
export function PublicHeader({
  locale,
  decor,
}: {
  locale: Locale;
  /** The season's site decoration (logo accent), or null for the plain wordmark. */
  decor: SiteDecorSpec | null;
}) {
  const text = getSiteText(locale);
  return (
    <SiteHeader
      brand={
        <Link href={`/${locale}`} aria-label={text.header.brand}>
          <SiteLogo decor={decor}>
            <BrandWordmark />
          </SiteLogo>
        </Link>
      }
      nav={<PublicNav locale={locale} />}
      tools={<PublicTools locale={locale} />}
      cta={<PublicHeaderCta locale={locale} />}
    />
  );
}

export function PublicFooter({
  locale,
  site,
  year,
}: {
  locale: Locale;
  /** The shop profile; null when it could not be read (the footer then has no contact column). */
  site: PublicSiteResponse | null;
  year?: number;
}) {
  const text = getSiteText(locale);
  const hours = site ? hoursHeadline(site.hours, locale, getSiteText(locale).home.closed) : null;
  const columns: FooterColumn[] = [
    ...(site
      ? [
          {
            key: 'contact',
            title: text.footer.contact,
            items: [
              site.address,
              <a key="tel" href={telHref(site)}>
                {site.hotline}
              </a>,
              ...(hours ? [`${hours.label}: ${hours.value}`] : []),
            ],
          },
        ]
      : []),
    {
      key: 'discover',
      title: text.footer.discover,
      items: footerDiscoverItems(locale, text.nav).map((item) => (
        <Link key={item.key} href={item.href}>
          {item.label}
        </Link>
      )),
    },
    {
      key: 'member',
      title: text.footer.member,
      items: [
        <Link key="in" href={`/${locale}/account/login`}>
          {text.footer.signIn}
        </Link>,
        <Link key="up" href={`/${locale}/account/register`}>
          {text.footer.register}
        </Link>,
      ],
    },
  ];
  return (
    <SiteFooter
      brand={
        <Link href={`/${locale}`} aria-label={text.header.brand} className="ls-site-footer-logo">
          <BrandWordmark />
        </Link>
      }
      tagline={site?.tagline ?? null}
      columns={columns}
      base={text.footer.rights.replace('{year}', String(year ?? new Date().getFullYear()))}
    />
  );
}
