'use client';

import { Notice, PublicMain } from '@lucy-spa/ui';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageBack } from '../navigation/page-back';
import { AccountTabs } from '../public/site-chrome-client';
import { useCustomer } from './session';

/**
 * The signed-in member area. The header, footer and phone tab bar are the shared site frame (account menu and bell
 * included); this adds the row of member pages and the "session lost" notice around the page's own content (each page
 * is a `Page` with its `PageHeader`). The booking page is its own full-width flow (steps, summary, action bar) and
 * draws its own main landmark.
 */
export function CustomerShell({ children }: { children: ReactNode }) {
  const { t, locale, base, sessionLost } = useCustomer();
  const pathname = usePathname();
  if (pathname === `${base}/book` || pathname.startsWith(`${base}/book/`)) return <>{children}</>;
  return (
    <PublicMain className="ls-main-tall">
      <div className="ls-container">
        <AccountTabs locale={locale} />
        <div className="ls-member-page">
          <PageBack root={base} publicHome={`/${locale}`} label={t.common.back} />
          {sessionLost ? <Notice tone="warning">{t.errors.sessionLost}</Notice> : null}
          {children}
        </div>
      </div>
    </PublicMain>
  );
}
