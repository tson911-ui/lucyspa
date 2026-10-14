import type { PublicSiteResponse } from '@lucy-spa/contracts';
import { buttonClass, ContactPage, DescriptionList, Notice, PublicMain } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { directionsUrl, telHref } from '../../lib/public-site-core';
import { hoursLines } from '../../lib/hours';

/**
 * The address on a map with no key and no paid service: Google's own embed of a search for the address
 * (`maps?q=...&output=embed`). It only loads when the visitor scrolls to it, and "Mở trong Google Maps" below it is the same place
 * as a plain link for anyone whose browser blocks the frame.
 */
export function mapEmbedUrl(address: string, locale: Locale): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(address)}&hl=${locale}&output=embed`;
}

/**
 * The contact page (DESIGN.md 9.2): the address on a map at the leading side; the hotline, the opening hours and the contact
 * pills at the other. The shop's own data (address, hotline, hours, Zalo, Messenger) comes from the shop profile, so the Owner edits it in
 * one place; without the profile the page says so instead of showing a map of nothing.
 */
export function ContactView({ locale, site }: { locale: Locale; site: PublicSiteResponse | null }) {
  const text = getSiteText(locale);
  const page = text.contactPage;
  if (!site) {
    return (
      <PublicMain>
        <div className="ls-site-state">
          <Notice tone="warning">{page.loadError}</Notice>
        </div>
      </PublicMain>
    );
  }
  const hours = hoursLines(site.hours, locale, text.home.closed);
  const newTab = text.infoPage.newTab;
  return (
    <ContactPage
      title={page.title}
      lead={page.lead}
      place={
        <div className="ls-contact-place">
          <div className="ls-contact-map">
            <iframe
              title={page.mapTitle}
              src={mapEmbedUrl(site.address, locale)}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
          <div className="ls-contact-address">
            <p className="ls-place-label">{page.address}</p>
            <p>{site.address}</p>
          </div>
          <a
            className={buttonClass('secondary', 'md', 'ls-contact-open')}
            href={directionsUrl(site)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {page.openMap}
            <span className="ls-visually-hidden"> ({newTab})</span>
          </a>
        </div>
      }
      details={
        <DescriptionList
          items={[
            { label: page.hotline, value: <a href={telHref(site)}>{site.hotline}</a> },
            {
              label: page.hours,
              value:
                hours.length === 0 ? null : (
                  <ul className="ls-contact-hours">
                    {hours.map((line) => (
                      <li key={line.label}>
                        {line.label}: {line.value}
                      </li>
                    ))}
                  </ul>
                ),
            },
          ]}
        />
      }
      actions={
        <>
          <a className={buttonClass('primary', 'lg')} href={telHref(site)}>
            {page.call}
          </a>
          {site.zaloUrl ? (
            <a
              className={buttonClass('secondary', 'lg')}
              href={site.zaloUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {page.zalo}
              <span className="ls-visually-hidden"> ({newTab})</span>
            </a>
          ) : null}
          {site.messengerUrl ? (
            <a
              className={buttonClass('secondary', 'lg')}
              href={site.messengerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {page.messenger}
              <span className="ls-visually-hidden"> ({newTab})</span>
            </a>
          ) : null}
        </>
      }
    />
  );
}
