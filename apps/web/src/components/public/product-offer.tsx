'use client';

import type { PublicProductVariant } from '@lucy-spa/contracts';
import { Field, Icon, SegmentedControl, Select, type IconName } from '@lucy-spa/ui';
import { useState, type ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { moneyText, stockLabel } from '../../lib/public-products-core';
import { PurchaseBlock } from '../shop/purchase-block';
import { PriceCampaignLine } from './campaign-views';
import { SalePrice } from './sale-price';

/** The shop's phone and map link, for the buy column when the product is bought in the shop (or is sold out). */
export interface StoreContact {
  telHref: string;
  directionsHref: string;
  callLabel: string;
  directionsLabel: string;
  /** "mở trong tab mới": added to the directions link's accessible name. */
  newTab: string;
}

/** At most five segments in one segmented control (C48, phone width); more variants use a select. */
const MAX_SEGMENTS = 5;

const STOCK_ICON: Record<PublicProductVariant['stock']['state'], IconName | null> = {
  IN_STOCK: null,
  PRE_ORDER: 'clock',
  OUT_OF_STOCK: 'alert-triangle',
};

/**
 * The buy column of the product page, under the name: the price of the chosen variant (with the struck list price and the saving), the
 * category and brand line (`meta`), the campaign line, the availability line (one slot in every state, an icon and a word, never colour
 * alone, so the layout never shifts), the variant picker when there are several (a segmented control: the price above updates, no price
 * box per variant), and the purchase block, a client island that reads the shop state and the session in the browser and holds the
 * page's one filled button (B16). A quantity of stock is never shown.
 */
export function ProductOffer({
  locale,
  variants,
  store = null,
  meta = null,
}: {
  locale: Locale;
  variants: readonly PublicProductVariant[];
  store?: StoreContact | null;
  meta?: ReactNode;
}) {
  const text = getSiteText(locale).products;
  // Start on the first variant that can be bought now; else on the first.
  const [chosen, setChosen] = useState(() =>
    Math.max(
      0,
      variants.findIndex((variant) => variant.stock.state === 'IN_STOCK'),
    ),
  );
  const variant = variants[chosen] ?? variants[0];
  if (!variant) return null;
  const stock = stockLabel(variant.stock, text);
  const icon = STOCK_ICON[variant.stock.state];
  const variantOptions = variants.map((entry, index) => {
    const name = entry.label ?? moneyText(entry.price.priceVnd, locale);
    const state = stockLabel(entry.stock, text);
    return {
      value: String(index),
      label: entry.stock.state === 'OUT_OF_STOCK' && state ? `${name}, ${state}` : name,
    };
  });
  return (
    <div className="ls-prod-offer">
      <SalePrice
        locale={locale}
        price={variant.price}
        nowText={moneyText(variant.price.priceVnd, locale)}
        size="page"
      />
      {meta}
      <PriceCampaignLine locale={locale} price={variant.price} />
      {stock ? (
        <p className="ls-prod-stock" data-state={variant.stock.state}>
          {icon ? <Icon name={icon} size={16} aria-hidden="true" /> : null}
          {stock}
        </p>
      ) : null}
      {variants.length > MAX_SEGMENTS ? (
        // More than five choices do not fit one segmented row on a phone (C48): a labelled select (C46) instead.
        <Field label={text.variants} className="ls-prod-variants">
          {(control) => (
            <Select
              {...control}
              value={String(chosen)}
              options={variantOptions}
              onChange={(event) => setChosen(Number(event.target.value))}
            />
          )}
        </Field>
      ) : variants.length > 1 ? (
        <SegmentedControl
          className="ls-prod-variants"
          label={text.variants}
          value={String(chosen)}
          onChange={(value) => setChosen(Number(value))}
          options={variantOptions}
        />
      ) : null}
      <PurchaseBlock locale={locale} variant={variant} store={store} key={variant.id} />
    </div>
  );
}
