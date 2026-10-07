'use client';

import type { PublicProductVariant } from '@lucy-spa/contracts';
import { Badge, ChoiceCard } from '@lucy-spa/ui';
import { useId, useState, type ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { discountText, moneyText, stockLabel } from '../../lib/public-products-core';

/**
 * The price and availability of the chosen variant and, when there are several, the picker. Each variant shows its own price and
 * its own availability ("Hết hàng", or the pre-order wait); a quantity is never shown. `action` is the reserved place of a buy
 * button: it stays empty until online orders exist (Wave 4), and nothing is drawn for it while it is.
 */
export function ProductOffer({
  locale,
  variants,
  action,
}: {
  locale: Locale;
  variants: readonly PublicProductVariant[];
  action?: ReactNode;
}) {
  const text = getSiteText(locale).products;
  const group = useId();
  // Start on the first variant that can be bought now; else on the first.
  const [chosen, setChosen] = useState(() =>
    Math.max(
      0,
      variants.findIndex((variant) => variant.stock.state === 'IN_STOCK'),
    ),
  );
  const variant = variants[chosen] ?? variants[0];
  if (!variant) return null;
  const label = (entry: PublicProductVariant) => stockLabel(entry.stock, text);
  const stock = label(variant);
  return (
    <div className="ls-prod-offer">
      <p className="ls-prod-detail-price" aria-live="polite">
        <strong>{moneyText(variant.price.priceVnd, locale)}</strong>
        {variant.price.listPriceVnd ? (
          <del>{moneyText(variant.price.listPriceVnd, locale)}</del>
        ) : null}
        {discountText(variant.price) ? (
          <Badge tone="brand">{discountText(variant.price)}</Badge>
        ) : null}
      </p>
      {stock ? (
        <p className="ls-prod-stock" data-state={variant.stock.state}>
          {stock}
        </p>
      ) : null}
      {variants.length > 1 ? (
        <div className="ls-prod-variants" role="radiogroup" aria-label={text.variants}>
          {variants.map((entry, index) => (
            <ChoiceCard
              key={index}
              type="radio"
              name={group}
              value={String(index)}
              checked={index === chosen}
              onChange={() => setChosen(index)}
              title={entry.label ?? moneyText(entry.price.priceVnd, locale)}
              meta={label(entry)}
              price={entry.label ? moneyText(entry.price.priceVnd, locale) : undefined}
            />
          ))}
        </div>
      ) : null}
      {action ? <div className="ls-prod-action">{action}</div> : null}
    </div>
  );
}
