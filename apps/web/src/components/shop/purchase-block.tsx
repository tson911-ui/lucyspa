'use client';

import type { OnlineCartResponse, PublicProductVariant } from '@lucy-spa/contracts';
import { Button, Icon, Notice, buttonClass } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { getCustomerDictionary } from '../../i18n/customer';
import type { Locale } from '../../i18n/locales';
import { getShopText } from '../../i18n/online-shop';
import { customerErrorMessage } from '../../lib/customer/booking';
import { fill } from '../../lib/fill';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import {
  announceCartChange,
  promiseNumbers,
  purchaseMode,
  shopErrorMessage,
  signInHref,
} from '../../lib/shop/online';
import type { StoreContact } from '../public/product-offer';
import { useSiteSession } from '../public/site-session';
import { QuantityStepper } from './quantity-stepper';
import { useOnlineSales } from './shop-data';

/**
 * The purchase block of the product page (Phase 6 P6-19), a client island under the price and variant picker: it reads the
 * shop's open or closed state and the session in the browser, so the page itself stays server-rendered and cacheable. A signed-out
 * visitor is asked to sign in (no guest checkout); a closed shop or a variant sold in the shop only reads "Mua tại cửa hàng";
 * pre-order goods say so and never promise a date. A quantity of stock is never shown.
 */
export function PurchaseBlock({
  locale,
  variant,
  store = null,
}: {
  locale: Locale;
  variant: PublicProductVariant;
  /** The shop's phone and map link (from the shop profile), for the store and sold-out states. */
  store?: StoreContact | null;
}) {
  const t = getShopText(locale);
  const general = getCustomerDictionary(locale);
  const pathname = usePathname();
  const { sales } = useOnlineSales();
  const { api, signedIn, ready } = useSiteSession();
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const mode = purchaseMode({ sales, sessionKnown: ready, signedIn, variant });
  // The room of one action row is kept while the shop's state is read, so the page does not move when it arrives.
  if (mode === 'LOADING')
    return <div className="ls-shop-buy" aria-busy="true" data-pending="true" />;
  if (mode === 'STORE') {
    // Bought in the shop: the line says so (an icon and a word), and calling the shop is the page's one filled button, with the directions
    // beside it (product-store plan). Without the shop profile the line points to nothing it cannot back up.
    return (
      <div className="ls-shop-buy">
        <p className="ls-shop-where">
          <Icon name="building" size={16} aria-hidden="true" />
          {t.purchase.store}
        </p>
        {store ? <StoreActions store={store} call="primary" /> : null}
      </div>
    );
  }
  if (mode === 'SOLD_OUT') {
    // Sold out: the availability line above says it with its icon; no disabled button stands in the slot. The next steps are asking the
    // shop (secondary: nothing can be bought, so no filled button) and the similar products, which move up the page.
    return (
      <div className="ls-shop-buy">
        {store ? <StoreActions store={store} call="secondary" /> : null}
      </div>
    );
  }
  // Open: the settings are known.
  const open = sales as Exclude<typeof sales, null | 'failed'>;
  if (mode === 'SIGN_IN') {
    return (
      <div className="ls-shop-buy">
        <Link
          className={buttonClass('primary', 'lg')}
          href={signInHref(locale, pathname)}
          transitionTypes={NAV_TRANSITION}
        >
          {t.purchase.signIn}
        </Link>
        <DeliveryLines
          locale={locale}
          sales={open}
          preOrder={variant.stock.state === 'PRE_ORDER'}
        />
      </div>
    );
  }

  const preOrder = mode === 'PRE_ORDER';
  async function add() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    setAdded(false);
    try {
      await api.post<OnlineCartResponse>('/api/v1/me/cart/add', {
        variantId: variant.id,
        quantity,
      });
      setAdded(true);
      announceCartChange();
    } catch (error) {
      setFailure(shopErrorMessage(error, t.errors, (e) => customerErrorMessage(e, general)));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ls-shop-buy">
      <div className="ls-shop-buy-row">
        <QuantityStepper
          value={quantity}
          max={open.maxLineQuantity}
          onChange={(next) => {
            setQuantity(next);
            setAdded(false);
          }}
          label={t.purchase.quantity}
          decreaseLabel={t.purchase.decrease}
          increaseLabel={t.purchase.increase}
          disabled={pending}
        />
        <Button
          variant="primary"
          size="lg"
          icon="cart"
          loading={pending}
          onClick={() => void add()}
        >
          {pending ? t.purchase.adding : preOrder ? t.purchase.preOrder : t.purchase.add}
        </Button>
      </div>
      {added ? (
        <Notice tone="success">
          <span className="ls-shop-added">
            {t.purchase.added}
            <Link
              className={buttonClass('ghost', 'md')}
              href={`/${locale}/cart`}
              transitionTypes={NAV_TRANSITION}
            >
              {t.purchase.viewCart}
            </Link>
          </span>
        </Notice>
      ) : null}
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      <DeliveryLines locale={locale} sales={open} preOrder={preOrder} />
    </div>
  );
}

/** "Gọi cửa hàng" (a phone link) and "Chỉ đường" (the map, a new tab): two pills of one size side by side, the call first. */
function StoreActions({ store, call }: { store: StoreContact; call: 'primary' | 'secondary' }) {
  return (
    <div className="ls-shop-store-actions">
      <a className={buttonClass(call, 'lg')} href={store.telHref}>
        <Icon name="phone" size={20} aria-hidden="true" />
        {store.callLabel}
      </a>
      <a
        className={buttonClass('secondary', 'lg')}
        href={store.directionsHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${store.directionsLabel} (${store.newTab})`}
      >
        <Icon name="map-pin" size={20} aria-hidden="true" />
        {store.directionsLabel}
      </a>
    </div>
  );
}

/** "Miễn phí giao hàng", the shipping promise (never a promise) and, for pre-order goods, the one-parcel note. */
function DeliveryLines({
  locale,
  sales,
  preOrder,
}: {
  locale: Locale;
  sales: Parameters<typeof promiseNumbers>[0];
  preOrder: boolean;
}) {
  const t = getShopText(locale).purchase;
  return (
    <ul className="ls-shop-facts">
      <li>
        <Icon name="truck" size={20} />
        <span>
          <strong>{t.freeShipping}</strong>
          {/* A pre-order item is sent when the stock arrives, so the usual sending time would contradict its own line below. */}
          {preOrder ? null : (
            <span className="ls-hint">{fill(t.promise, promiseNumbers(sales))}</span>
          )}
        </span>
      </li>
      {preOrder ? (
        <li>
          <Icon name="clock" size={20} />
          <span className="ls-hint">{t.preOrderNote}</span>
        </li>
      ) : null}
    </ul>
  );
}
