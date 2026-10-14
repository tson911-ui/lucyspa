import type { PublicProductCard } from '@lucy-spa/contracts';
import { Badge, Icon } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import {
  cardPriceText,
  discountText,
  productHref,
  stockLabel,
} from '../../lib/public-products-core';
import { PriceCampaignLine } from './campaign-views';
import { ProductImage } from './product-image';
import { SalePrice } from './sale-price';

const CARD_SIZES =
  '(min-width: 1280px) 22vw, (min-width: 1024px) 30vw, (min-width: 640px) 34vw, 46vw';

/**
 * One product as a card (DESIGN.md 8.3), the same on the home row, the list and the related row: the picture on the sunken step (a
 * droplet when there is none), the labels over its top-left corner (Mới = accent outline, the sale percent = ink fill, Hết hàng), then
 * the category, the name (the card's one link, stretched over the card), the pre-order line, the price with the struck list price and the
 * campaign line. The percent is drawn once, as the label; the price block does not repeat it. The caller supplies the list item.
 */
export function ProductCard({
  locale,
  card,
  priority = false,
  level = 3,
}: {
  locale: Locale;
  card: PublicProductCard;
  priority?: boolean;
  level?: 2 | 3;
}) {
  const text = getSiteText(locale).products;
  const Heading = level === 2 ? 'h2' : 'h3';
  const percent = discountText(card.price);
  const stock = stockLabel(card.stock, text);
  const outOfStock = card.stock.state === 'OUT_OF_STOCK';
  return (
    <article className="ls-pcard">
      <div className="ls-pcard-media">
        {card.image ? (
          <ProductImage image={card.image} sizes={CARD_SIZES} priority={priority} />
        ) : (
          <Icon name="droplet" size={40} aria-hidden="true" />
        )}
        {card.isNew || percent || outOfStock ? (
          <div className="ls-pcard-labels">
            {card.isNew ? <Badge tone="outline">{text.badgeNew}</Badge> : null}
            {percent ? <Badge tone="ink">{percent}</Badge> : null}
            {outOfStock ? <Badge tone="neutral">{text.outOfStock}</Badge> : null}
          </div>
        ) : null}
      </div>
      <div className="ls-pcard-body">
        {card.category || card.brand ? (
          <span className="ls-pcard-meta">{card.category?.name ?? card.brand}</span>
        ) : null}
        <Heading className="ls-pcard-name">
          <Link href={productHref(locale, card.code)} title={card.name}>
            {card.name}
          </Link>
        </Heading>
        {stock && card.stock.state === 'PRE_ORDER' ? (
          <p className="ls-prod-stock" data-state={card.stock.state}>
            {stock}
          </p>
        ) : null}
        <SalePrice
          locale={locale}
          price={card.price}
          nowText={cardPriceText(card, locale)}
          percent={false}
        />
        <PriceCampaignLine locale={locale} price={card.price} />
      </div>
    </article>
  );
}
