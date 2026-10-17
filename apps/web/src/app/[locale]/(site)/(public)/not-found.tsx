'use client';

import { buttonClass, PublicPage } from '@lucy-spa/ui';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { isLocale } from '../../../../i18n/locales';
import { getSiteText } from '../../../../i18n/site';
import { NAV_TRANSITION } from '../../../../lib/nav-transition';

/**
 * A public page that does not exist (a paused service, a product that is no longer sold, a wrong address): the site chrome stays, a
 * centred title, one sentence and the way on (DESIGN.md 9.2 404): "Về trang chủ" is the one filled button, "Đặt lịch" the secondary.
 * The words all come from the site dictionary, so the 404 loads no shop dictionary (rbp not-found.tsx:7).
 */
export default function PublicNotFound() {
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname();
  const locale = params.locale && isLocale(params.locale) ? params.locale : 'vi';
  const site = getSiteText(locale);
  if (pathname.startsWith(`/${locale}/ticket`)) {
    // A pre-order ticket link that is wrong or was revoked: nothing is revealed about why.
    return (
      <PublicPage
        title={site.errors.ticketTitle}
        lead={site.errors.ticketBody}
        width="narrow"
        centered
      >
        <div className="ls-site-actions">
          <Link
            className={buttonClass('primary', 'lg')}
            href={`/${locale}`}
            transitionTypes={NAV_TRANSITION}
          >
            {site.errors.home}
          </Link>
        </div>
      </PublicPage>
    );
  }
  const isProduct = pathname.startsWith(`/${locale}/products`);
  const isService = pathname.startsWith(`/${locale}/services`);
  if (!isProduct && !isService) {
    // Any other address that does not exist: the same chrome, a plain explanation and two ways on.
    return (
      <PublicPage title={site.errors.notFoundTitle} lead={site.errors.notFoundBody} centered>
        <div className="ls-site-actions">
          <Link
            className={buttonClass('primary', 'lg')}
            href={`/${locale}`}
            transitionTypes={NAV_TRANSITION}
          >
            {site.errors.home}
          </Link>
          <Link
            className={buttonClass('secondary', 'lg')}
            href={`/${locale}/account/book`}
            transitionTypes={NAV_TRANSITION}
          >
            {site.header.bookNow}
          </Link>
        </div>
      </PublicPage>
    );
  }
  const text = isProduct ? site.products : site.services;
  return (
    <PublicPage title={text.notFoundTitle} lead={text.notFoundBody} centered>
      <div className="ls-site-actions">
        <Link
          className={buttonClass('primary', 'lg')}
          href={`/${locale}/${isProduct ? 'products' : 'services'}`}
          transitionTypes={NAV_TRANSITION}
        >
          {text.back}
        </Link>
      </div>
    </PublicPage>
  );
}
