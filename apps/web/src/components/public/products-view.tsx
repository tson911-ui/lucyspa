import type {
  PublicCampaign,
  PublicProductDetailResponse,
  PublicProductsCommitment,
  PublicProductsResponse,
  PublicSiteResponse,
} from '@lucy-spa/contracts';
import {
  Accordion,
  Badge,
  Band,
  buttonClass,
  EmptyState,
  Icon,
  PublicMain,
  Reveal,
} from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import {
  activeFilterCount,
  activeCampaign,
  PRODUCTS_LIST_ID,
  productsHref,
  withFilter,
  type ProductsState,
} from '../../lib/public-products-core';
import { directionsUrl, hoursHeadline, telHref } from '../../lib/public-site-core';
import { PageBack } from '../navigation/page-back';
import { CampaignHero, CampaignStrips } from './campaign-views';
import { LoadNotice } from './home-sections';
import { ProductCard } from './product-card';
import { ProductGallery } from './product-gallery';
import { ProductImage } from './product-image';
import { ProductOffer } from './product-offer';
import { ProductsPager, ProductsToolbar } from './products-controls';
import { PublicBreadcrumbs } from './public-breadcrumbs';
import { ScrollRow } from './scroll-row';

function ProductsBack({ locale }: { locale: Locale }) {
  return (
    <PageBack
      root={`/${locale}/products`}
      publicHome={`/${locale}`}
      label={getSiteText(locale).products.backLabel}
    />
  );
}

/** The shop's commitment, as the Owner wrote it: a flat card on its band with a check beside each line. */
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

/** Category (with sub-categories under their parent) and brand as link lists for the phone's filter sheet: they work without scripts. */
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
 * The category and brand chips of the list (DESIGN.md 9.2), from 640 px; a phone has the filter sheet instead. They are links, so they work
 * without scripts and can be shared. The first row is the top-level categories; once one is chosen (or one of its sub-categories) a
 * second row offers its sub-categories. Choosing the parent again is the way back to all of it.
 */
function FilterChips({
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
  const chosen = data.categories.find((category) => category.code === state.category);
  const activeTop = chosen ? (chosen.parentCode ?? chosen.code) : '';
  const subs = data.categories.filter((category) => category.parentCode === activeTop);
  const href = (patch: Partial<ProductsState>) => productsHref(locale, withFilter(state, patch));
  const chip = (key: string, label: string, selected: boolean, to: string) => (
    <Link
      key={key}
      href={to}
      prefetch={false}
      scroll={false}
      aria-current={selected ? 'true' : undefined}
    >
      {label}
    </Link>
  );
  return (
    <div className="ls-prod-chips">
      {top.length > 0 ? (
        <nav className="ls-pills" aria-label={text.categories}>
          {chip('all', text.allCategories, state.category === '', href({ category: '' }))}
          {top.map((category) =>
            chip(
              category.code,
              category.name,
              activeTop === category.code,
              href({ category: category.code }),
            ),
          )}
        </nav>
      ) : null}
      {subs.length > 0 ? (
        <nav className="ls-pills" aria-label={text.categories}>
          {subs.map((category) =>
            chip(
              category.code,
              category.name,
              state.category === category.code,
              href({ category: category.code }),
            ),
          )}
        </nav>
      ) : null}
      {data.brands.length > 1 ? (
        <nav className="ls-pills" aria-label={text.brands}>
          {chip('all-brands', text.allBrands, state.brand === '', href({ brand: '' }))}
          {data.brands.map((brand) =>
            chip(brand.code, brand.name, state.brand === brand.code, href({ brand: brand.code })),
          )}
        </nav>
      ) : null}
    </div>
  );
}

/**
 * The public cosmetics list (DESIGN.md 9.2): the title band (the Owner's hero, or a plain title) with the campaign strips, then the list band
 * with the search, the sort, the category and brand chips, the grid of cards (2 / 3 / 4 across) and the pager, and the Owner's commitment as
 * a last band. Everything the visitor chose is in the address, so the server draws exactly that page. The page has one `h1`.
 */
export function ProductsView({
  locale,
  data,
  state,
  campaigns = null,
  onlineOpen = false,
}: {
  locale: Locale;
  data: PublicProductsResponse | null;
  state: ProductsState;
  /** "Bán online" is ON: only then do the campaign buttons use the Owner's words; otherwise they only lead to the sale. */
  onlineOpen?: boolean;
  /** The campaigns running now (Wave 4 / P6-23); null when they could not be read or there is no news of them: nothing is drawn. */
  campaigns?: readonly PublicCampaign[] | null;
}) {
  const text = getSiteText(locale);
  const t = text.products;
  const hero = data?.hero ?? null;
  const filterGroups = data ? <FilterGroups locale={locale} state={state} data={data} /> : null;
  const hasFilters = data !== null && (data.categories.length > 0 || data.brands.length > 1);
  const title = hero?.title ?? t.title;
  // A sale view of a campaign that is running replaces the Owner's hero; an unknown or ended one shows the normal page.
  const sale = activeCampaign(campaigns, state);
  const plain = !state.campaign;
  const reset = productsHref(
    locale,
    withFilter(state, { q: '', category: '', brand: '', ...(sale ? {} : { campaign: '' }) }),
  );
  const nothingPublished =
    data !== null &&
    data.total === 0 &&
    state.q === '' &&
    activeFilterCount(state) === 0 &&
    data.categories.length === 0;
  return (
    <PublicMain>
      <Band tone="page" className="ls-band--alt ls-prod-title">
        <ProductsBack locale={locale} />
        {sale ? (
          <CampaignHero locale={locale} campaign={sale} onlineOpen={onlineOpen} />
        ) : hero ? (
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
        {plain && !sale ? (
          <CampaignStrips locale={locale} campaigns={campaigns} onlineOpen={onlineOpen} />
        ) : null}
      </Band>
      {data === null ? (
        <Band tone="page" className="ls-band--base">
          <LoadNotice locale={locale} section={t.title} />
        </Band>
      ) : nothingPublished ? (
        <Band tone="page" className="ls-band--base">
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
        </Band>
      ) : (
        <>
          <Band tone="page" labelledBy={PRODUCTS_LIST_ID} className="ls-band--base ls-prod-list">
            <div className="ls-prod-head">
              <h2 className="ls-site-h2" id={PRODUCTS_LIST_ID}>
                {t.sectionTitle}
              </h2>
              <ProductsToolbar locale={locale} state={state}>
                {hasFilters ? filterGroups : null}
              </ProductsToolbar>
            </div>
            {hasFilters ? <FilterChips locale={locale} state={state} data={data} /> : null}
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
                      <ProductCard locale={locale} card={card} priority={index < 2} sharePhoto />
                    </Reveal>
                  </li>
                ))}
              </ul>
            )}
            {data.total > 0 ? (
              <ProductsPager locale={locale} state={state} total={data.total} />
            ) : null}
          </Band>
          {data.commitment ? (
            <Band tone="page" className="ls-band--alt">
              <CommitmentBox commitment={data.commitment} headingLevel={2} />
            </Band>
          ) : null}
        </>
      )}
    </PublicMain>
  );
}

/** "Mua trực tiếp tại cửa hàng": where to buy, from the shop profile. */
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
 * One product on its own page (DESIGN.md 9.2): a split hero with the gallery on the left and the name, price, labels, variants and purchase
 * block on the right; then a band with the description, the usage / ingredients accordion and where to buy (the shop's own details), the
 * Owner's commitment, and the other products of the category as a row. A band is drawn only when it has content.
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
        <Band tone="page" className="ls-band--alt ls-prod-title">
          <ProductsBack locale={locale} />
          <div className="ls-public-title">
            <h1 className="ls-h1-display">{t.title}</h1>
          </div>
        </Band>
        <Band tone="page" className="ls-band--base">
          <LoadNotice locale={locale} section={t.title} />
        </Band>
      </PublicMain>
    );
  }
  const { product, commitment, related } = detail;
  // The hero band is the alternate color; the bands after it alternate down the page.
  let tone: 'alt' | 'base' = 'alt';
  const nextTone = () => (tone = tone === 'alt' ? 'base' : 'alt');
  const hasAbout = Boolean(product.description) || product.sections.length > 0 || site !== null;
  return (
    <PublicMain>
      <Band tone="page" className="ls-band--alt ls-pd-hero">
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
          <ProductGallery
            images={product.images}
            shareName={`ls-photo-prod-${product.code}`}
            label={t.gallery}
            thumbLabel={t.pictureN}
            previousLabel={t.galleryPrevious}
            nextLabel={t.galleryNext}
          />
          <div className="ls-prod-info">
            {product.category || product.brand ? (
              <span className="ls-prod-meta">
                {[product.category?.name, product.brand].filter(Boolean).join(' · ')}
              </span>
            ) : null}
            <h1 className="ls-h1-display">{product.name}</h1>
            {product.isNew ? (
              <div className="ls-prod-detail-badges">
                <Badge tone="outline">{t.badgeNew}</Badge>
              </div>
            ) : null}
            <ProductOffer locale={locale} variants={product.variants} />
          </div>
        </div>
      </Band>
      {hasAbout ? (
        <Band tone="page" className={`ls-band--${nextTone()} ls-pd-about`}>
          <div className="ls-pd-about-grid">
            <div className="ls-pd-about-text">
              {product.description ? (
                <section className="ls-prod-desc" aria-labelledby="product-description-title">
                  <h2 className="ls-site-h2" id="product-description-title">
                    {t.descriptionTitle}
                  </h2>
                  <p className="ls-prod-copy">{product.description}</p>
                </section>
              ) : null}
              {product.sections.length > 0 ? (
                <div className="ls-prod-sections">
                  <Accordion
                    headingLevel={3}
                    items={product.sections.map((section) => ({
                      id: `product-section-${section.key}`,
                      title: t.sections[section.key],
                      content: <p className="ls-prod-copy">{section.text}</p>,
                    }))}
                  />
                </div>
              ) : null}
            </div>
            {site ? <StoreBlock locale={locale} site={site} /> : null}
          </div>
        </Band>
      ) : null}
      {commitment ? (
        <Band tone="page" className={`ls-band--${nextTone()}`}>
          <CommitmentBox commitment={commitment} headingLevel={2} />
        </Band>
      ) : null}
      {related.length > 0 ? (
        <Band
          tone="page"
          labelledBy="product-related-title"
          className={`ls-band--${nextTone()} ls-prod-related`}
        >
          <Reveal>
            <h2 className="ls-site-h2" id="product-related-title">
              {t.related}
            </h2>
          </Reveal>
          <ScrollRow label={t.related} previous={text.home.rowPrevious} next={text.home.rowNext}>
            {related.map((card) => (
              <li key={card.code} className="ls-snap-item">
                <ProductCard locale={locale} card={card} />
              </li>
            ))}
          </ScrollRow>
        </Band>
      ) : null}
    </PublicMain>
  );
}
