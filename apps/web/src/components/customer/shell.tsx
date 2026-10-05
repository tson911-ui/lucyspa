'use client';

import { Notice, PublicMain } from '@lucy-spa/ui';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageBack } from '../navigation/page-back';
import { useCustomer } from './session';

/**
 * The signed-in member area. The header (menu, bell, account menu), footer and phone tab bar are the shared site
 * frame; this adds the "Back" row and the "session lost" notice around the page's own content (each page is a `Page`
 * with its `PageHeader`). The booking page is its own full-width flow (steps, summary, action bar) and
 * draws its own main landmark.
 */
export function CustomerShell({ children }: { children: ReactNode }) {
  const { t, locale, base, sessionLost } = useCustomer();
  const pathname = usePathname();
  if (pathname === `${base}/book` || pathname.startsWith(`${base}/book/`)) return <>{children}</>;
  return (
    <PublicMain className="ls-main-tall">
      <div className="ls-container">
        <div className="ls-member-page">
          <PageBack root={base} publicHome={`/${locale}`} label={t.common.back} />
          {sessionLost ? <Notice tone="warning">{t.errors.sessionLost}</Notice> : null}
          {children}
        </div>
      </div>
    </PublicMain>
  );
}
