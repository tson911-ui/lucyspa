import type { PublicService } from '@lucy-spa/contracts';
import { buttonClass, Icon, ImageFrame } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { frameImage } from '../../lib/public-image';
import {
  bookServiceHref,
  cardPrice,
  serviceEstimate,
  serviceHref,
} from '../../lib/public-site-core';
import { SharedPhoto } from './shared-photo';

/**
 * One service as a card (DESIGN.md 9.2, 17.2; Owner answer 2): the photo the Owner chose (the flat placeholder while there is none), the
 * name, the estimated time and the price ("from" for a per-nail price), and "Đặt lịch" as the secondary (outline) button. The whole card
 * opens the service: the name's link is stretched over the card (its `::after`), and the button is a sibling above that layer, never
 * inside the link. The name link carries the navigation transition type, so the page fades while the photo travels to the service page
 * (`sharePhoto`, the list page only: the name must be unique on a page). A card is a list item; `className` lets a row of cards (the
 * related services) add its snap item class. A server component: the list page's search only shows or hides finished cards.
 */
export function ServiceCard({
  locale,
  service,
  className,
  sharePhoto = false,
}: {
  locale: Locale;
  service: PublicService;
  className?: string;
  /** The photo travels to the service's page. */
  sharePhoto?: boolean;
}) {
  const text = getSiteText(locale).services;
  const photo = (
    <ImageFrame
      {...frameImage(service.image, '(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw')}
      alt=""
      ratio="4/3"
      loading="lazy"
      className="ls-svc-media"
    />
  );
  return (
    <li className={className ? `ls-svc-item ${className}` : 'ls-svc-item'}>
      <article className="ls-svc-card">
        {sharePhoto ? (
          <SharedPhoto name={`ls-photo-svc-${service.code}`}>{photo}</SharedPhoto>
        ) : (
          photo
        )}
        <div className="ls-svc-card-body">
          <h3 className="ls-svc-card-name">
            <Link href={serviceHref(locale, service.code)} transitionTypes={NAV_TRANSITION}>
              {service.name}
            </Link>
          </h3>
          <p className="ls-svc-card-meta">
            <Icon name="clock" size={16} aria-hidden="true" />
            {serviceEstimate(service, locale)}
          </p>
          <p className="ls-svc-card-price">{cardPrice(service, locale)}</p>
        </div>
        <Link
          className={buttonClass('secondary', 'md', 'ls-svc-card-book')}
          href={bookServiceHref(locale, service.code)}
          transitionTypes={NAV_TRANSITION}
          aria-label={`${text.book}: ${service.name}`}
        >
          {text.book}
        </Link>
      </article>
    </li>
  );
}
