'use client';

import { Band, Icon, Notice, PublicMain, ToastProvider, buttonClass } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { getShopText } from '../../i18n/online-shop';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { RequireCustomer, useCustomer } from '../customer/session';

/**
 * The frame of the cart and the checkout (Phase 6 P6-19): the member guard (a visitor who is not signed in goes to the sign-in
 * page and comes back here afterwards), then the page's `main`. Each screen draws its own title band and content with `ShopScreen`.
 */
export function ShopFrame({ children }: { children: ReactNode }) {
  const { locale } = useCustomer();
  const cart = getShopText(locale).cart;
  // The toast region of the cart and the checkout: removing a line answers with a toast that can undo it (C72).
  return (
    <RequireCustomer>
      <ToastProvider regionLabel={cart.toastRegion} dismissLabel={cart.dismiss}>
        <PublicMain className="ls-main-tall">{children}</PublicMain>
      </ToastProvider>
    </RequireCustomer>
  );
}

/**
 * One screen of the shop (DESIGN.md 9.2): the title band (the page's one h1 and a sentence) and the content band below it. The cart is a
 * top-level destination and has no back control (B7, C40); the checkout, whose parent is the cart, has the icon-only chevron named for it
 * ("Quay lại giỏ hàng"). `narrow` holds the content to one 720 px column (the checkout and the empty and closed states).
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
  const checkout = pathname?.endsWith('/checkout') ?? false;
  const backLabel = getShopText(locale).checkout.backToCart;
  return (
    <>
      <Band tone="page" className="ls-shop-title">
        {checkout ? (
          <div className="ls-back-row">
            <Link
              href={`/${locale}/cart`}
              className={buttonClass('ghost', 'md', 'ls-back ls-btn-icon')}
              transitionTypes={NAV_TRANSITION}
              aria-label={backLabel}
              title={backLabel}
            >
              <Icon name="chevron-left" />
            </Link>
          </div>
        ) : null}
        <div className="ls-public-title">
          <h1 className="ls-h1-display">{title}</h1>
          {description ? <p className="ls-lead">{description}</p> : null}
        </div>
      </Band>
      <Band tone="page" className="ls-shop-body">
        <div className="ls-shop-content" data-narrow={narrow ? 'true' : undefined}>
          {sessionLost ? <Notice tone="warning">{t.errors.sessionLost}</Notice> : null}
          {children}
        </div>
      </Band>
    </>
  );
}
