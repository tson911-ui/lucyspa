import type { Locale } from './locales';

/**
 * Words of the public side of promotion campaigns (Wave 4 / P6-23). The campaign's own words (name, badge, headline, message, button)
 * are the Owner's, from the admin; only the fixed labels around them live here.
 */
export interface CampaignsPublicText {
  /** Accessible name of the strips above the list. */
  stripsLabel: string;
  /** Button of a strip. */
  stripCta: string;
  /** Button of the sale view's top section when the Owner wrote no button label. */
  saleCta: string;
  /** With {date}: the last day of the sale. */
  until: string;
  /** Link under a price, with {name}: the campaign that gives it. */
  priceFrom: string;
  /** Link of the sale view back to the whole list. */
  allProducts: string;
  /** Accessible name of the sale view's top section. */
  saleLabel: string;
}

const text: Record<Locale, CampaignsPublicText> = {
  vi: {
    stripsLabel: 'Chương trình khuyến mãi',
    stripCta: 'Xem ưu đãi',
    saleCta: 'Xem sản phẩm',
    until: 'Đến hết ngày {date}',
    priceFrom: 'Khuyến mãi: {name}',
    allProducts: 'Xem tất cả sản phẩm',
    saleLabel: 'Chương trình khuyến mãi',
  },
  en: {
    stripsLabel: 'Promotions',
    stripCta: 'See the offer',
    saleCta: 'Shop the sale',
    until: 'Until {date}',
    priceFrom: 'Promotion: {name}',
    allProducts: 'See all products',
    saleLabel: 'Promotion',
  },
};

export const getCampaignsPublicText = (locale: Locale): CampaignsPublicText => text[locale];
