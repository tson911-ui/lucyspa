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
import {
  announceCartChange,
  promiseNumbers,
  purchaseMode,
  shopErrorMessage,
  signInHref,
} from '../../lib/shop/online';
import { useSiteSession } from '../public/site-session';
import { QuantityStepper } from './quantity-stepper';
import { useOnlineSales } from './shop-data';

/** Where the "buy in the shop" button leads: the shop details block lower on the same page. */
const STORE_ANCHOR = '#product-store-title';

/**
 * The purchase block of the product page (Phase 6 P6-19), a client island under the price and variant picker: it reads the
 * shop's open or closed state and the session in the browser, so the page itself stays server-rendered and cacheable. A signed-out
 * visitor is asked to sign in (no guest checkout); a closed shop or a variant sold in the shop only reads "Mua tại cửa hàng";
 * pre-order goods say so and never promise a date. A quantity of stock is never shown.
 */
export function PurchaseBlock({
  locale,
  variant,
}: {
  locale: Locale;
  variant: PublicProductVariant;
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
  if (mode === 'STORE' || mode === 'SOLD_OUT') {
    return (
      <div className="ls-shop-buy">
        {mode === 'STORE' ? (
          <a className={buttonClass('secondary', 'lg')} href={STORE_ANCHOR}>
            {t.purchase.store}
          </a>
        ) : (
          <Button variant="secondary" size="lg" disabled>
            {t.purchase.soldOut}
          </Button>
        )}
      </div>
    );
  }
  // Open: the settings are known.
  const open = sales as Exclude<typeof sales, null | 'failed'>;
  if (mode === 'SIGN_IN') {
    return (
      <div className="ls-shop-buy">
        <Link className={buttonClass('primary', 'lg')} href={signInHref(locale, pathname)}>
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
            <Link className={buttonClass('ghost', 'md')} href={`/${locale}/cart`}>
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
          <span className="ls-hint">{fill(t.promise, promiseNumbers(sales))}</span>
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
