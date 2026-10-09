'use client';

import { buttonClass, PublicPage } from '@lucy-spa/ui';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { isLocale } from '../../../../i18n/locales';
import { productOrdersDictionary } from '../../../../i18n/product-orders';
import { getSiteText } from '../../../../i18n/site';

/** A public page that does not exist (a paused service, a product that is no longer sold): the site chrome stays, the way on is clear. */
export default function PublicNotFound() {
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname();
  const locale = params.locale && isLocale(params.locale) ? params.locale : 'vi';
  const site = getSiteText(locale);
  if (pathname.startsWith(`/${locale}/ticket`)) {
    // A pre-order ticket link that is wrong or was revoked: nothing is revealed about why.
    const ticket = productOrdersDictionary(locale).publicTicket;
    return (
      <PublicPage title={ticket.notFoundTitle} lead={ticket.notFoundBody} width="narrow" centered>
        <div className="ls-site-actions">
          <Link className={buttonClass('primary', 'lg')} href={`/${locale}`}>
            {ticket.home}
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
          <Link className={buttonClass('primary', 'lg')} href={`/${locale}`}>
            {site.errors.home}
          </Link>
          <Link className={buttonClass('secondary', 'lg')} href={`/${locale}/services`}>
            {site.errors.services}
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
        >
          {text.back}
        </Link>
      </div>
    </PublicPage>
  );
}
