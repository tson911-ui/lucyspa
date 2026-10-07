import type {
  PublicProductCard,
  PublicProductDetailResponse,
  PublicProductsCommitment,
  PublicProductsResponse,
  PublicSiteResponse,
} from '@lucy-spa/contracts';
import { Badge, buttonClass, EmptyState, Icon, PublicMain, Reveal } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import {
  activeFilterCount,
  cardPriceText,
  discountText,
  moneyText,
  PRODUCTS_LIST_ID,
  productHref,
  productsHref,
  stockLabel,
  withFilter,
  type ProductsState,
} from '../../lib/public-products-core';
import { directionsUrl, hoursHeadline, telHref } from '../../lib/public-site-core';
import { PageBack } from '../navigation/page-back';
import { LoadNotice } from './home-sections';
import { ProductGallery } from './product-gallery';
import { ProductImage } from './product-image';
import { ProductOffer } from './product-offer';
import { ProductsPager, ProductsToolbar } from './products-controls';
import { PublicBreadcrumbs } from './public-breadcrumbs';

const CARD_SIZES = '(min-width: 1024px) 22vw, (min-width: 768px) 30vw, 46vw';

function ProductsBack({ locale }: { locale: Locale }) {
  return (
    <PageBack
      root={`/${locale}/products`}
      publicHome={`/${locale}`}
      label={getSiteText(locale).products.backLabel}
    />
  );
}

/**
 * One product as a card: the picture with its badges ("-x%", "Mới", "Hết hàng"), the category, the name (the card's one link,
 * stretched over the whole card), the availability line and the price with the struck list price while a promotion runs.
 */
export function ProductCardView({
  locale,
  card,
  level = 3,
  priority = false,
}: {
  locale: Locale;
  card: PublicProductCard;
  level?: 2 | 3;
  priority?: boolean;
}) {
  const text = getSiteText(locale).products;
  const Heading = level === 2 ? 'h2' : 'h3';
  const discount = discountText(card.price);
  const stock = stockLabel(card.stock, text);
  return (
    <article className="ls-prod-card">
      <div className="ls-prod-media">
        {card.image ? (
          <ProductImage image={card.image} sizes={CARD_SIZES} priority={priority} />
        ) : (
          <Icon name="droplet" size={40} aria-hidden="true" />
        )}
        {discount || card.isNew || card.stock.state === 'OUT_OF_STOCK' ? (
          <div className="ls-prod-badges">
            {discount ? <Badge tone="brand">{discount}</Badge> : null}
            {card.isNew ? <Badge tone="brand">{text.badgeNew}</Badge> : null}
            {card.stock.state === 'OUT_OF_STOCK' ? (
              <Badge tone="neutral">{text.outOfStock}</Badge>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="ls-prod-body">
        {card.category || card.brand ? (
          <span className="ls-prod-meta">{card.category?.name ?? card.brand}</span>
        ) : null}
        <Heading className="ls-site-h3 ls-prod-name">
          <Link href={productHref(locale, card.code)} title={card.name}>
            {card.name}
          </Link>
        </Heading>
        <div className="ls-prod-foot">
          {stock && card.stock.state === 'PRE_ORDER' ? (
            <p className="ls-prod-stock" data-state={card.stock.state}>
              {stock}
            </p>
          ) : null}
          <p className="ls-prod-price">
            <strong>{cardPriceText(card, locale)}</strong>
            {card.price.listPriceVnd ? (
              <del>{moneyText(card.price.listPriceVnd, locale)}</del>
            ) : null}
          </p>
        </div>
      </div>
    </article>
  );
}

function CommitmentBox({
  commitment,
  headingLevel,
  className = 'ls-prod-commitment',
}: {
  commitment: PublicProductsCommitment;
  headingLevel: 2 | 3;
  className?: string;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <aside className={className} aria-label={commitment.title ?? undefined}>
      {commitment.title ? <Heading>{commitment.title}</Heading> : null}
      <ul>
        {commitment.items.map((item) => (
          <li key={item}>
            <Icon name="check" size={16} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Category (with sub-categories under their parent) and brand as link lists: they work without scripts and can be shared. */
function FilterGroups({
  locale,
  state,
  data,
}: {
  locale: Locale;
  state: ProductsState;
  data: PublicProductsResponse;
}) {
  const text = getSiteText(locale).products;
  const top = data.categories.filter((category) => category.parentCode === null);
  const ordered = top.flatMap((category) => [
    { ...category, child: false },
    ...data.categories
      .filter((entry) => entry.parentCode === category.code)
      .map((entry) => ({ ...entry, child: true })),
  ]);
  const option = (key: string, label: string, selected: boolean, href: string, child = false) => (
    <li key={key} className={child ? 'ls-prod-option-child' : undefined}>
      <Link
        href={href}
        prefetch={false}
        scroll={false}
        aria-current={selected ? 'true' : undefined}
      >
        {label}
      </Link>
    </li>
  );
  return (
    <>
      {ordered.length > 0 ? (
        <div className="ls-prod-filter-group">
          <h3>{text.categories}</h3>
          <ul className="ls-prod-options">
            {option(
              'all',
              text.allCategories,
              state.category === '',
              productsHref(locale, withFilter(state, { category: '' })),
            )}
            {ordered.map((category) =>
              option(
                category.code,
                category.name,
                state.category === category.code,
                productsHref(locale, withFilter(state, { category: category.code })),
                category.child,
              ),
            )}
          </ul>
        </div>
      ) : null}
      {data.brands.length > 1 ? (
        <div className="ls-prod-filter-group">
          <h3>{text.brands}</h3>
          <ul className="ls-prod-options">
            {option(
              'all-brands',
              text.allBrands,
              state.brand === '',
              productsHref(locale, withFilter(state, { brand: '' })),
            )}
            {data.brands.map((brand) =>
              option(
                brand.code,
                brand.name,
                state.brand === brand.code,
                productsHref(locale, withFilter(state, { brand: brand.code })),
              ),
            )}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/**
 * The public cosmetics list (design 16): the Owner's hero (hidden when empty; the page then opens with a plain title), then
 * the search, filters and sort, the sidebar with the commitment box and the grid of cards. Everything the visitor chose is in
 * the address, so the server draws exactly that page. The page has one `h1`.
 */
export function ProductsView({
  locale,
  data,
  state,
}: {
  locale: Locale;
  data: PublicProductsResponse | null;
  state: ProductsState;
}) {
  const text = getSiteText(locale);
  const t = text.products;
  const hero = data?.hero ?? null;
  const filterGroups = data ? <FilterGroups locale={locale} state={state} data={data} /> : null;
  const hasFilters = data !== null && (data.categories.length > 0 || data.brands.length > 1);
  const title = hero?.title ?? t.title;
  const reset = productsHref(locale, withFilter(state, { q: '', category: '', brand: '' }));
  return (
    <PublicMain>
      <div className="ls-container">
        <ProductsBack locale={locale} />
        {hero ? (
          <section
            className={`ls-prod-hero${hero.image ? ' ls-prod-hero-image' : ''}`}
            aria-labelledby="products-title-h1"
          >
            <div className="ls-prod-hero-copy">
              <h1 className="ls-site-display" id="products-title-h1">
                {title}
              </h1>
              {hero.text ? <p className="ls-lead">{hero.text}</p> : null}
            </div>
            {hero.image ? (
              <div className="ls-prod-hero-picture">
                <ProductImage image={hero.image} sizes="(min-width: 768px) 50vw, 100vw" priority />
              </div>
            ) : null}
          </section>
        ) : (
          <div className="ls-public-title">
            <h1 className="ls-h1-display">{title}</h1>
            <p className="ls-lead">{t.lead}</p>
          </div>
        )}
        {data === null ? (
          <LoadNotice locale={locale} section={t.title} />
        ) : data.total === 0 &&
          state.q === '' &&
          activeFilterCount(state) === 0 &&
          data.categories.length === 0 ? (
          <div className="ls-prod-section">
            <EmptyState
              icon="droplet"
              action={
                <Link className={buttonClass('secondary')} href={`/${locale}/services`}>
                  {t.emptyAction}
                </Link>
              }
            >
              {t.empty}
            </EmptyState>
          </div>
        ) : (
          <section className="ls-prod-section" aria-labelledby={PRODUCTS_LIST_ID}>
            <div className="ls-prod-head">
              <h2 className="ls-site-h2" id={PRODUCTS_LIST_ID}>
                {t.sectionTitle}
              </h2>
              <ProductsToolbar locale={locale} state={state}>
                {hasFilters ? filterGroups : null}
              </ProductsToolbar>
            </div>
            <div className="ls-prod-layout">
              <div className="ls-prod-main">
                {data.items.length === 0 ? (
                  <EmptyState
                    icon="search"
                    action={
                      <Link className={buttonClass('secondary')} href={reset}>
                        {t.filterReset}
                      </Link>
                    }
                  >
                    {t.noMatch}
                  </EmptyState>
                ) : (
                  <ul className="ls-prod-grid">
                    {data.items.map((card, index) => (
                      <li key={card.code}>
                        <Reveal index={index % 6}>
                          <ProductCardView locale={locale} card={card} priority={index < 2} />
                        </Reveal>
                      </li>
                    ))}
                  </ul>
                )}
                {data.total > 0 ? (
                  <ProductsPager locale={locale} state={state} total={data.total} />
                ) : null}
              </div>
              {hasFilters || data.commitment ? (
                <div className="ls-prod-side">
                  {hasFilters ? <div className="ls-prod-aside">{filterGroups}</div> : null}
                  {data.commitment ? (
                    <CommitmentBox commitment={data.commitment} headingLevel={2} />
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </PublicMain>
  );
}

/** "Mua trực tiếp tại cửa hàng": where to buy, from the shop profile (no cart or checkout exists yet). */
function StoreBlock({ locale, site }: { locale: Locale; site: PublicSiteResponse }) {
  const text = getSiteText(locale);
  const t = text.products.store;
  const hours = hoursHeadline(site.hours, locale, text.home.closed);
  return (
    <section className="ls-prod-store" aria-labelledby="product-store-title">
      <h2 id="product-store-title">{t.title}</h2>
      <p>{t.body}</p>
      <dl>
        <div>
          <dt>{t.address}</dt>
          <dd>{site.address}</dd>
        </div>
        <div>
          <dt>{t.hotline}</dt>
          <dd>{site.hotline}</dd>
        </div>
        {hours ? (
          <div>
            <dt>{hours.label}</dt>
            <dd>{hours.value}</dd>
          </div>
        ) : null}
      </dl>
      <div className="ls-site-actions">
        <a
          className={buttonClass('secondary')}
          href={directionsUrl(site)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.directions}
        </a>
        <a className={buttonClass('primary')} href={telHref(site)}>
          {t.call}
        </a>
      </div>
    </section>
  );
}

/**
 * One product on its own page (design 16.4): gallery, name, price and availability per variant, the description, where to buy
 * (the shop's own details) and the other products of the category. The place of a future buy button is `ProductOffer`'s
 * `action`, left empty for now.
 */
export function ProductDetailView({
  locale,
  detail,
  site,
}: {
  locale: Locale;
  detail: PublicProductDetailResponse | null;
  site: PublicSiteResponse | null;
}) {
  const text = getSiteText(locale);
  const t = text.products;
  if (detail === null) {
    return (
      <PublicMain>
        <div className="ls-container">
          <ProductsBack locale={locale} />
          <div className="ls-public-title">
            <h1 className="ls-h1-display">{t.title}</h1>
          </div>
          <LoadNotice locale={locale} section={t.title} />
        </div>
      </PublicMain>
    );
  }
  const { product, commitment, related } = detail;
  return (
    <PublicMain>
      <div className="ls-container ls-prod-page">
        <ProductsBack locale={locale} />
        <PublicBreadcrumbs
          label={t.breadcrumbs}
          items={[
            { label: t.title, href: `/${locale}/products` },
            ...(product.category
              ? [
                  {
                    label: product.category.name,
                    href: `/${locale}/products?category=${encodeURIComponent(product.category.code)}`,
                  },
                ]
              : []),
            { label: product.name },
          ]}
        />
        <div className="ls-prod-detail">
          <ProductGallery images={product.images} label={t.gallery} thumbLabel={t.pictureN} />
          <div className="ls-prod-info">
            {product.category || product.brand ? (
              <span className="ls-prod-meta">
                {[product.category?.name, product.brand].filter(Boolean).join(' · ')}
              </span>
            ) : null}
            <h1 className="ls-h1-display">{product.name}</h1>
            {product.isNew ? (
              <div className="ls-prod-detail-badges">
                <Badge tone="brand">{t.badgeNew}</Badge>
              </div>
            ) : null}
            <ProductOffer locale={locale} variants={product.variants} />
            {product.description ? (
              <section className="ls-prod-desc" aria-labelledby="product-description-title">
                <h2 className="ls-site-h3" id="product-description-title">
                  {t.descriptionTitle}
                </h2>
                <p className="ls-prod-copy">{product.description}</p>
              </section>
            ) : null}
            {site ? <StoreBlock locale={locale} site={site} /> : null}
            {commitment ? <CommitmentBox commitment={commitment} headingLevel={2} /> : null}
          </div>
        </div>
        {related.length > 0 ? (
          <section className="ls-prod-related" aria-labelledby="product-related-title">
            <h2 className="ls-site-h2-sub" id="product-related-title">
              {t.related}
            </h2>
            <ul className="ls-prod-grid">
              {related.map((card) => (
                <li key={card.code}>
                  <ProductCardView locale={locale} card={card} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PublicMain>
  );
}
