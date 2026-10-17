'use client';

import type { PublicProductCard } from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { ProductCard } from './product-card';
import { ScrollRow } from './scroll-row';

/**
 * The product row of the home page (DESIGN.md 9.1, item 4): the scroll-snap row and its cards. This module is loaded after the first paint
 * by `LazyProductRow` (redesign group 1, C11b), so none of it is in the home page's first load.
 */
export function HomeProductRow({
  locale,
  cards,
  label,
}: {
  locale: Locale;
  cards: readonly PublicProductCard[];
  label: string;
}) {
  const text = getSiteText(locale).home;
  return (
    <ScrollRow label={label} previous={text.rowPrevious} next={text.rowNext}>
      {cards.map((card) => (
        <li key={card.code} className="ls-snap-item">
          {/* One card per product on the home page, so the picture can travel to the product page (F3.6). The row loads after the
              first paint below the fold, so no picture of it is fetched first (rbp home-product-row.tsx:27). */}
          <ProductCard locale={locale} card={card} sharePhoto />
        </li>
      ))}
    </ScrollRow>
  );
}
