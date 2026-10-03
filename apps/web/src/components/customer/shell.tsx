'use client';

import { Notice, PublicMain } from '@lucy-spa/ui';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccountTabs } from '../public/site-chrome-client';
import { useCustomer } from './session';

/**
 * The signed-in member area. The header, footer and phone tab bar are the shared site frame (account menu and bell
 * included); this adds the row of member pages and the "session lost" notice around the page's own content. The
 * booking page is its own full-width flow (steps, summary, action bar) and draws its own main landmark.
 */
export function CustomerShell({ children }: { children: ReactNode }) {
  const { t, locale, base, sessionLost } = useCustomer();
  const pathname = usePathname();
  if (pathname === `${base}/book` || pathname.startsWith(`${base}/book/`)) return <>{children}</>;
  return (
    <PublicMain>
      <div className="ls-container ls-container-narrow">
        <AccountTabs locale={locale} />
        {/* wf-app: the legacy control styles the not yet migrated member pages still rely on (P2-8 removes it). */}
        <div className="ls-member-page wf-app">
          {sessionLost ? <Notice tone="warning">{t.errors.sessionLost}</Notice> : null}
          {children}
        </div>
      </div>
    </PublicMain>
  );
}
