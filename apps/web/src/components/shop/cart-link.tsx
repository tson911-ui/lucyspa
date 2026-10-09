'use client';

import { Icon } from '@lucy-spa/ui';
import Link from 'next/link';
import { getShopText } from '../../i18n/online-shop';
import type { Locale } from '../../i18n/locales';
import { fill } from '../../lib/fill';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { useSiteSession } from '../public/site-session';
import { isOpen, useCartLineCount, useOnlineSales } from './shop-data';

/**
 * The cart in the site header (Phase 6 P6-19), next to the bell: only for a signed-in member and only while online ordering is
 * open, with the number of lines as a badge. On a narrow phone the header has no room for a fifth round tool, so the account
 * menu carries the cart there (see `accountMenuItems`).
 */
export function CartLink({ locale }: { locale: Locale }) {
  const { signedIn, account } = useSiteSession();
  const { sales } = useOnlineSales();
  const open = isOpen(sales);
  const count = useCartLineCount(open);
  if (!signedIn || !account || !open) return null;
  const t = getShopText(locale).header;
  const lines = count ?? 0;
  const label = lines > 0 ? fill(t.cartCount, { count: lines }) : t.cart;
  return (
    <span className="ls-site-cart">
      <Link
        className="ls-site-tool"
        href={`/${locale}/cart`}
        aria-label={label}
        prefetch
        transitionTypes={NAV_TRANSITION}
      >
        <Icon name="cart" />
      </Link>
      {lines > 0 ? (
        <span className="ls-bell-count" data-testid="cart-badge" aria-hidden="true">
          {lines > 99 ? '99+' : lines}
        </span>
      ) : null}
    </span>
  );
}
