'use client';

import {
  Icon,
  Menu,
  Tooltip,
  buttonClass,
  useMediaQuery,
  type MenuItem,
  type MenuLinkComponent,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getShopText } from '../../i18n/online-shop';
import { getSiteText, type SiteText } from '../../i18n/site';
import type { Locale } from '../../i18n/locales';
import { customerLogout } from '../../lib/customer/auth';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { announceSessionChange } from '../../lib/site-session';
import { fill } from '../../lib/fill';
import { isOpen, useCartLineCount, useOnlineSales } from '../shop/shop-data';
import { useSiteSession } from './site-session';

/** Below this width the header has no room for the round cart button, so the cart is an entry of the account menu. */
const NARROW_HEADER = '(max-width: 479px)';

/** Each page entry of the menu is a real link through the router (new tab, middle click; no full reload, wig account-menu.tsx:41). */
const AccountMenuLink: MenuLinkComponent = ({ children, ...rest }) => (
  <Link transitionTypes={NAV_TRANSITION} {...rest}>
    {children}
  </Link>
);

/**
 * What the signed-in menu offers: the account page, the rewards and sign-out, in that order. Bookings and invoices are in
 * the header menu and notifications are behind the bell. Signed out there is no menu (C47): see PublicAccountMenu.
 */
export function accountMenuItems({
  base,
  text,
  signOut,
  shop,
}: {
  base: string;
  text: SiteText['member'];
  signOut: () => void;
  /** Online ordering is open (Phase 6 P6-19): the member's online orders, and on a narrow phone the cart. */
  shop?: { orders: string; cart: string | null; cartHref: string } | undefined;
}): MenuItem[] {
  return [
    { id: 'account', label: text.account, icon: 'user', href: base },
    ...(shop
      ? [
          ...(shop.cart
            ? [
                {
                  id: 'cart',
                  label: shop.cart,
                  icon: 'cart' as const,
                  href: shop.cartHref,
                },
              ]
            : []),
          {
            id: 'orders',
            label: shop.orders,
            icon: 'receipt' as const,
            href: `${base}/orders`,
          },
        ]
      : []),
    {
      id: 'rewards',
      label: text.rewards,
      icon: 'award',
      href: `${base}/loyalty`,
    },
    { id: 'signout', label: text.signOut, icon: 'log-out', onSelect: signOut },
  ];
}

/**
 * The header's account control (Part 2 contract 3.3). Signed out (and for a staff session, which has no member
 * area, and while the session is not known yet) it is one link to the sign-in page, whose switch also offers
 * registration (C47: two choices are a control, not a menu); signed in it is a menu with the account page, the
 * rewards and sign-out. Both use the same person icon, so nothing moves when the session resolves. The notification
 * bell is its own control next to the language button. It only reads who is signed in: every page and API call still
 * authorizes on the server.
 */
export function PublicAccountMenu({ locale }: { locale: Locale }) {
  const site = getSiteText(locale);
  const router = useRouter();
  const { signedIn, api, markSignedOut } = useSiteSession();
  const { sales } = useOnlineSales();
  const open = signedIn && isOpen(sales);
  const narrow = useMediaQuery(NARROW_HEADER);
  const lines = useCartLineCount(open && narrow);
  const shopText = getShopText(locale);
  const cartLabel =
    lines && lines > 0 ? fill(shopText.header.cartCount, { count: lines }) : shopText.header.cart;

  const base = `/${locale}/account`;
  if (!signedIn) {
    return (
      <span className="ls-site-account">
        <Tooltip content={site.header.signInOrRegister} describes={false}>
          <Link
            href={`${base}/login`}
            transitionTypes={NAV_TRANSITION}
            className={buttonClass('ghost', 'md', 'ls-btn-icon')}
            aria-label={site.header.signInOrRegister}
          >
            <Icon name="user" />
          </Link>
        </Tooltip>
      </span>
    );
  }
  const items = accountMenuItems({
    base,
    text: site.member,
    shop: open
      ? {
          orders: shopText.header.orders,
          cart: narrow ? cartLabel : null,
          cartHref: `/${locale}/cart`,
        }
      : undefined,
    signOut: () => {
      void customerLogout(api)
        .catch(() => undefined)
        .finally(() => {
          markSignedOut();
          announceSessionChange();
          router.replace(`${base}/login?signedOut=1`);
        });
    },
  });
  return (
    <span className="ls-site-account">
      <Menu label={site.header.account} items={items} icon="user" LinkComponent={AccountMenuLink} />
    </span>
  );
}
