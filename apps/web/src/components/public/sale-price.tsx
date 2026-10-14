import type { PublicProductPrice } from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { discountText, moneyText, saleSaving } from '../../lib/public-products-core';
import { SaleCountdown } from './sale-countdown';
import { unbroken } from './unbroken';

/**
 * The price block of a product. Not on sale: the price alone, nothing extra. On sale, like a phone-store card in the shop's own style:
 * line 1 the struck list price and the percent in the brand colour, line 2 the sale price large and bold, line 3 "Tiết kiệm X" small,
 * and a countdown only when the sale has an end date. No badge on the picture, nothing that blinks.
 */
export function SalePrice({
  locale,
  price,
  nowText,
  size = 'card',
  percent: showPercent = true,
}: {
  locale: Locale;
  price: PublicProductPrice;
  /** The sale price line as the page words it ("từ 329.000 ₫" on a card whose variants differ in price). */
  nowText: string;
  size?: 'card' | 'page';
  /** Show the percent beside the struck price; a card that draws it as a label on its picture (DESIGN.md 8.7) turns this off. */
  percent?: boolean;
}) {
  if (!price.listPriceVnd) {
    return (
      <p
        className={size === 'card' ? 'ls-prod-price' : 'ls-prod-detail-price'}
        aria-live={size === 'page' ? 'polite' : undefined}
      >
        <strong>{nowText}</strong>
      </p>
    );
  }
  const text = getSiteText(locale).products;
  const percent = showPercent ? discountText(price) : null;
  const saving = saleSaving(price);
  return (
    <div className="ls-sale" data-size={size} aria-live={size === 'page' ? 'polite' : undefined}>
      <p className="ls-sale-was">
        <del>{moneyText(price.listPriceVnd, locale)}</del>
        {percent ? <span className="ls-sale-pct">{percent}</span> : null}
      </p>
      <p className="ls-sale-now">
        <strong>{nowText}</strong>
      </p>
      {saving ? (
        <p className="ls-sale-save">
          {unbroken(text.saleSave, '{amount}', moneyText(saving, locale))}
        </p>
      ) : null}
      {price.saleEndsAt ? (
        <SaleCountdown
          endsAt={price.saleEndsAt}
          daysText={text.saleLeftDays}
          timeText={text.saleLeft}
        />
      ) : null}
    </div>
  );
}
