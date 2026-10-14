'use client';

import { Band, Icon, Notice, PublicMain, buttonClass } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { RequireCustomer, useCustomer } from '../customer/session';

/**
 * The frame of the cart and the checkout (Phase 6 P6-19): the member guard (a visitor who is not signed in goes to the sign-in
 * page and comes back here afterwards), then the page's `main`. Each screen draws its own title band and content with `ShopScreen`.
 */
export function ShopFrame({ children }: { children: ReactNode }) {
  return (
    <RequireCustomer>
      <PublicMain className="ls-main-tall">{children}</PublicMain>
    </RequireCustomer>
  );
}

/**
 * One screen of the shop (DESIGN.md 9.2): the title band (the "continue shopping" or "back to the cart" link, the page's one h1 and a
 * sentence) and the content band below it. The checkout goes back to the cart, the cart to the products. `narrow` holds the content to
 * one 720 px column (the checkout and the empty and closed states).
 */
export function ShopScreen({
  title,
  description,
  narrow = false,
  children,
}: {
  title: string;
  description?: string | undefined;
  narrow?: boolean;
  children: ReactNode;
}) {
  const { t, locale, sessionLost } = useCustomer();
  const pathname = usePathname();
  const parent = pathname?.endsWith('/checkout') ? `/${locale}/cart` : `/${locale}/products`;
  return (
    <>
      <Band tone="page" className="ls-band--alt ls-shop-title">
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
        <div className="ls-public-title">
          <h1 className="ls-h1-display">{title}</h1>
          {description ? <p className="ls-lead">{description}</p> : null}
        </div>
      </Band>
      <Band tone="page" className="ls-band--base ls-shop-body">
        <div className="ls-shop-content" data-narrow={narrow ? 'true' : undefined}>
          {sessionLost ? <Notice tone="warning">{t.errors.sessionLost}</Notice> : null}
          {children}
        </div>
      </Band>
    </>
  );
}
