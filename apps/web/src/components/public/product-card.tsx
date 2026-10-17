import type { PublicProductCard } from '@lucy-spa/contracts';
import { Badge, Icon } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import {
  cardPriceText,
  discountText,
  productHref,
  stockLabel,
} from '../../lib/public-products-core';
import { ProductImage } from './product-image';
import { SalePrice } from './sale-price';
import { SharedPhoto } from './shared-photo';

const CARD_SIZES =
  '(min-width: 1280px) 22vw, (min-width: 1024px) 30vw, (min-width: 640px) 34vw, 46vw';

/**
 * One product as a card (DESIGN.md 8.3, 17.2; Owner answer 2), the same on the home row, the list and the related row: the picture on the
 * placeholder step (a droplet when there is none), the labels over its top-left corner (B18: Mới = neutral outline, the sale percent =
 * ink fill, Hết hàng = the warning status with its icon), then the name, the pre-order line and the price with the struck list price.
 * The whole card opens the product and holds no button: the name's link is stretched over the card and is its only target (the campaign
 * line lives on the product page, so no link sits inside the card's link). The name wraps by word, never cut (Owner answer 7). The
 * percent is drawn once, as the label. The caller supplies the list item.
 */
export function ProductCard({
  locale,
  card,
  priority = false,
  level = 3,
  sharePhoto = false,
}: {
  locale: Locale;
  card: PublicProductCard;
  priority?: boolean;
  level?: 2 | 3;
  /** The picture travels to the product page (one card per product on a page: the name must be unique). */
  sharePhoto?: boolean;
}) {
  const text = getSiteText(locale).products;
  const Heading = level === 2 ? 'h2' : 'h3';
  const percent = discountText(card.price);
  const stock = stockLabel(card.stock, text);
  const outOfStock = card.stock.state === 'OUT_OF_STOCK';
  const media = (
    <div className="ls-pcard-media">
      {card.image ? (
        <ProductImage image={card.image} sizes={CARD_SIZES} priority={priority} />
      ) : (
        <Icon name="droplet" size={24} aria-hidden="true" />
      )}
      {card.isNew || percent || outOfStock ? (
        <div className="ls-pcard-labels">
          {card.isNew ? <Badge tone="outline">{text.badgeNew}</Badge> : null}
          {percent ? <Badge tone="ink">{percent}</Badge> : null}
          {outOfStock ? <Badge tone="warning">{text.outOfStock}</Badge> : null}
        </div>
      ) : null}
    </div>
  );
  return (
    <article className="ls-pcard">
      {sharePhoto ? <SharedPhoto name={`ls-photo-prod-${card.code}`}>{media}</SharedPhoto> : media}
      <div className="ls-pcard-body">
        <Heading className="ls-pcard-name">
          <Link href={productHref(locale, card.code)} transitionTypes={NAV_TRANSITION}>
            {card.name}
          </Link>
        </Heading>
        {stock && card.stock.state === 'PRE_ORDER' ? (
          <p className="ls-prod-stock" data-state={card.stock.state}>
            <Icon name="clock" size={16} aria-hidden="true" />
            {stock}
          </p>
        ) : null}
        <SalePrice
          locale={locale}
          price={card.price}
          nowText={cardPriceText(card, locale)}
          percent={false}
        />
      </div>
    </article>
  );
}
