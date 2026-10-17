import { Band, buttonClass, Card, PublicMain } from '@lucy-spa/ui';
import Link from 'next/link';
import { customerProfileDictionary } from '../../../i18n/customer-profile';
import type { Locale } from '../../../i18n/locales';
import { NAV_TRANSITION } from '../../../lib/nav-transition';

/**
 * Session 10 A2: after the deletion the session is gone, so this page sits outside the member area. A server component (nothing here
 * reacts to the person): one heading, one sentence and the way home as the outline button.
 */
export function AccountDeletedScreen({ locale }: { locale: Locale }) {
  const text = customerProfileDictionary(locale).deletion;
  return (
    <PublicMain className="ls-main-tall">
      <Band tone="page" className="ls-auth-panel">
        <div className="ls-auth-stack">
          <Card as="section" aria-labelledby="account-deleted-title" className="ls-member-card">
            <div className="ls-member-head">
              <h1 id="account-deleted-title" className="ls-member-title">
                {text.deletedTitle}
              </h1>
              <p>{text.deletedBody}</p>
            </div>
            <Link
              href={`/${locale}`}
              className={buttonClass('secondary')}
              transitionTypes={NAV_TRANSITION}
            >
              {text.home}
            </Link>
          </Card>
        </div>
      </Band>
    </PublicMain>
  );
}
