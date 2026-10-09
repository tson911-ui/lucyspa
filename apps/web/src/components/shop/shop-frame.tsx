'use client';

import { Icon, Notice, PublicMain, buttonClass } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { RequireCustomer, useCustomer } from '../customer/session';

/**
 * The frame of the cart and the checkout (Phase 6 P6-19): the member guard (a visitor who is not signed in goes to the sign-in
 * page and comes back here afterwards), then the same page frame as the member area. The pages are not in the member area's
 * address, so they draw their own "continue shopping" and "back to the cart" links.
 */
export function ShopFrame({ children }: { children: ReactNode }) {
  return (
    <RequireCustomer>
      <ShopPage>{children}</ShopPage>
    </RequireCustomer>
  );
}

function ShopPage({ children }: { children: ReactNode }) {
  const { t, locale, sessionLost } = useCustomer();
  const pathname = usePathname();
  // The checkout goes back to the cart, the cart to the products (the member pages have their own Back row).
  const parent = pathname?.endsWith(`/checkout`) ? `/${locale}/cart` : `/${locale}/products`;
  return (
    <PublicMain className="ls-main-tall">
      <div className="ls-container">
        <div className="ls-member-page">
          <div className="ls-back-row">
            <Link
              href={parent}
              className={buttonClass('ghost', 'md', 'ls-back')}
              transitionTypes={NAV_TRANSITION}
            >
              <Icon name="arrow-left" />
              <span className="ls-btn-label">{t.common.back}</span>
            </Link>
          </div>
          {sessionLost ? <Notice tone="warning">{t.errors.sessionLost}</Notice> : null}
          {children}
        </div>
      </div>
    </PublicMain>
  );
}
