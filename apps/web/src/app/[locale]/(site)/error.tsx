'use client';

import { buttonClass, Button, PublicPage } from '@lucy-spa/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { isLocale } from '../../../i18n/locales';
import { getSiteText } from '../../../i18n/site';

/**
 * A page of the customer side that failed while it was drawn: the site frame stays and the visitor is told what to do, in
 * the visitor's language, without the technical message (it is not shown, the server already logged it).
 */
export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ locale?: string }>();
  const locale = params.locale && isLocale(params.locale) ? params.locale : 'vi';
  const text = getSiteText(locale).errors;
  return (
    <PublicPage title={text.errorTitle} lead={text.errorBody}>
      <div className="ls-site-actions">
        <Button variant="primary" size="lg" onClick={reset}>
          {text.retry}
        </Button>
        <Link className={buttonClass('secondary', 'lg')} href={`/${locale}`}>
          {text.home}
        </Link>
      </div>
    </PublicPage>
  );
}
