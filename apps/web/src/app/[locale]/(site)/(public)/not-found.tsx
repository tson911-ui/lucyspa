'use client';

import { buttonClass, PublicPage } from '@lucy-spa/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { isLocale } from '../../../../i18n/locales';
import { getSiteText } from '../../../../i18n/site';

/** A public page that does not exist (for example a service that is paused): the site chrome stays, the way on is clear. */
export default function PublicNotFound() {
  const params = useParams<{ locale?: string }>();
  const locale = params.locale && isLocale(params.locale) ? params.locale : 'vi';
  const text = getSiteText(locale).services;
  return (
    <PublicPage title={text.notFoundTitle} lead={text.notFoundBody}>
      <div className="ls-site-actions">
        <Link className={buttonClass('primary', 'lg')} href={`/${locale}/services`}>
          {text.back}
        </Link>
      </div>
    </PublicPage>
  );
}
