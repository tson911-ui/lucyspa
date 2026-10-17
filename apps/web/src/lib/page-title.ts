/** The brand as it ends every browser tab title. */
export const BRAND_NAME = 'Lucy Spa';

/**
 * HIG C41: one browser tab title form for the public site, the member area, the shop and the staff screens: the page first, then a
 * spaced en dash (U+2013) and the brand ("Dịch vụ – Lucy Spa"), never a middle dot or an em dash. The home page keeps its brand line.
 */
export function pageTitle(page: string): string {
  return `${page} – ${BRAND_NAME}`;
}
