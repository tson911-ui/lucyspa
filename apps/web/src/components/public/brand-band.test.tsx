import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicProductBrand, PublicProductsResponse } from '@lucy-spa/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { homeBrands } from '../../lib/public-site-core';
import { BrandBand, loopOf } from './brand-band';

const logo = (name: string) => ({
  alt: name,
  width: 400,
  height: 120,
  sources: [
    { url: `/api/v1/public/media/${name}/md`, width: 640 },
    { url: `/api/v1/public/media/${name}/lg`, width: 1280 },
  ],
});

const brand = (
  code: string,
  name: string,
  over: Partial<PublicProductBrand> = {},
): PublicProductBrand => ({
  code,
  name,
  logo: logo(name),
  onHome: true,
  homeSortOrder: 0,
  ...over,
});

const catalog = (brands: PublicProductBrand[]): PublicProductsResponse => ({
  hero: null,
  commitment: null,
  categories: [],
  brands,
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
});

test('the home brand band lists the switched-on brands that have a logo, in the Owner order and then by name', () => {
  const shown = homeBrands(
    catalog([
      brand('zeta', 'Zeta', { homeSortOrder: 1 }),
      brand('b', 'Bravo', { homeSortOrder: 1 }),
      brand('a', 'Alpha', { homeSortOrder: 0 }),
      brand('off', 'Off', { onHome: false }),
      brand('nologo', 'No logo', { logo: null }),
    ]),
  );
  assert.deepEqual(
    shown.map((entry) => entry.code),
    ['a', 'b', 'zeta'],
  );
  assert.deepEqual(homeBrands(null), []);
  assert.deepEqual(homeBrands(catalog([brand('off', 'Off', { onHome: false })])), []);
});

test('the band is not drawn without a brand', () => {
  assert.equal(renderToStaticMarkup(<BrandBand locale="vi" brands={[]} />), '');
});

test('a short list is repeated to fill the loop; the second copy and the fillers are out of the reading and tab order', () => {
  assert.equal(loopOf([1, 2, 3]).length, 12);
  assert.equal(loopOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).length, 11);
  assert.deepEqual(loopOf([]), []);
  const brands = homeBrands(catalog([brand('a', 'Alpha'), brand('b', 'Bravo')]));
  const html = renderToStaticMarkup(<BrandBand locale="vi" brands={brands} />);
  assert.match(
    html,
    /<section class="ls-brand-band" aria-label="Thương hiệu mỹ phẩm tại Lucy Spa"/,
  );
  assert.match(html, /style="--ls-brand-seconds:60"/);
  const sets = html.split('<ul ').slice(1);
  assert.equal(sets.length, 2);
  assert.doesNotMatch(sets[0]!.split('>')[0]!, /aria-hidden/);
  assert.match(sets[1]!.split('>')[0]!, /aria-hidden="true"/);
  assert.match(sets[1]!.split('>')[0]!, /inert/);
  // The first set: two real items with the brand name as alt text and a link to that brand's list; the other eight only fill the loop.
  const items = sets[0]!.split('<li ').slice(1);
  assert.equal(items.length, 10);
  assert.match(items[0]!, /href="\/vi\/products\?brand=a"/);
  assert.match(items[0]!, /aria-label="Xem sản phẩm Alpha"/);
  assert.match(items[0]!, /alt="Alpha"/);
  assert.match(items[1]!, /alt="Bravo"/);
  assert.doesNotMatch(items[0]!, /aria-hidden/);
  assert.match(items[2]!, /aria-hidden="true"/);
  assert.match(items[2]!, /alt=""/);
  // The widest rendition is used and the real size is given, so nothing shifts.
  assert.match(items[0]!, /src="\/api\/v1\/public\/media\/Alpha\/lg"/);
  assert.match(items[0]!, /width="400" height="120"/);
});
