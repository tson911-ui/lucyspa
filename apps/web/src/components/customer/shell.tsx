'use client';

import { BrandWordmark } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Notice } from '../workforce/ui';
import { NotificationIndicator } from '../notifications/inbox';
import { useCustomer, useCustomerAccount } from './session';

/** The signed-in member area: brand, navigation (wraps on phones), language and sign-out. */
export function CustomerShell({ children }: { children: ReactNode }) {
  const { t, base, locale, sessionLost, api } = useCustomer();
  const { signOut } = useCustomerAccount();
  const pathname = usePathname();
  const other = locale === 'vi' ? 'en' : 'vi';
  const links = [
    { href: base, label: t.nav.home, exact: true },
    { href: `${base}/book`, label: t.nav.book, exact: false },
    { href: `${base}/bookings`, label: t.nav.bookings, exact: false },
  ];
  const current = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <div className="cu-shell">
      <header className="cu-header">
        <Link href={base} className="cu-brand" aria-label="Lucy Spa">
          <BrandWordmark />
        </Link>
        <nav aria-label={t.nav.menu} className="cu-nav">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current(link.href, link.exact) ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="cu-header-actions">
          <NotificationIndicator api={api} base={base} locale={locale} />
          <Link
            href={pathname.replace(`/${locale}/`, `/${other}/`)}
            hrefLang={other}
            lang={other}
            className="wf-lang"
          >
            {t.common.language}
          </Link>
          <button
            type="button"
            className="wf-button wf-button-quiet"
            onClick={() => void signOut()}
          >
            {t.nav.signOut}
          </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="cu-main">
        {sessionLost ? <Notice tone="warning">{t.errors.sessionLost}</Notice> : null}
        {children}
      </main>
    </div>
  );
}
