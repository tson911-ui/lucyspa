import type { PublicSiteResponse } from '@lucy-spa/contracts';
import { buttonClass, ContactPage, Icon, Notice, PublicMain } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { directionsUrl, telHref } from '../../lib/public-site-core';
import { hoursLines } from '../../lib/hours';

/**
 * The address on a map with no key and no paid service: Google's own embed of a search for the address
 * (`maps?q=...&output=embed`). It only loads when the visitor scrolls to it, and "Chỉ đường" under it is the same place as a plain link
 * for anyone whose browser blocks the frame.
 */
export function mapEmbedUrl(address: string, locale: Locale): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(address)}&hl=${locale}&output=embed`;
}

/**
 * The contact page (DESIGN.md 9.2, contact plan): an editorial split, the words leading and the framed map trailing (stacked on a phone,
 * words first). The address reads as a heading-weight line; the phone and the opening hours are plain lines with their icons (no small
 * labels above the values: the labels are spoken only); the ways to reach the spa are one row of pills of one size, "Gọi ngay" the one
 * filled button, Zalo and Messenger secondaries (new tab, said so); "Chỉ đường" sits under the map. The phone number stays selectable
 * text (the call button dials it). The shop's own data comes from the shop profile; without it the page says so under its h1.
 */
export function ContactView({ locale, site }: { locale: Locale; site: PublicSiteResponse | null }) {
  const text = getSiteText(locale);
  const page = text.contactPage;
  if (!site) {
    return (
      <PublicMain>
        <div className="ls-site-state">
          <h1 className="ls-h1-display">{page.title}</h1>
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
      className="ls-contact-band"
      place={
        <div className="ls-contact-text">
          <p className="ls-contact-address">
            <span className="ls-visually-hidden">{page.address}: </span>
            {site.address}
          </p>
          <ul className="ls-contact-lines">
            <li>
              <Icon name="phone" size={20} aria-hidden="true" />
              <span>
                <span className="ls-visually-hidden">{page.hotline}: </span>
                <span translate="no">{site.hotline}</span>
              </span>
            </li>
            {hours.length > 0 ? (
              <li>
                <Icon name="clock" size={20} aria-hidden="true" />
                <span>
                  <span className="ls-visually-hidden">{page.hours}: </span>
                  <ul className="ls-contact-hours">
                    {hours.map((line) => (
                      <li key={line.label}>
                        {line.label}: {line.value}
                      </li>
                    ))}
                  </ul>
                </span>
              </li>
            ) : null}
          </ul>
          <nav className="ls-info-actions ls-contact-actions" aria-label={page.quickContact}>
            <a className={buttonClass('primary', 'lg')} href={telHref(site)}>
              <Icon name="phone" size={20} aria-hidden="true" />
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
          </nav>
        </div>
      }
      details={
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
          <a
            className={buttonClass('secondary', 'lg', 'ls-contact-open')}
            href={directionsUrl(site)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="map-pin" size={20} aria-hidden="true" />
            {page.openMap}
            <span className="ls-visually-hidden"> ({newTab})</span>
          </a>
        </div>
      }
    />
  );
}
