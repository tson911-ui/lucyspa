import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CategoryGrid, categoryItems } from './home-sections';

const image = {
  alt: 'Ảnh nhóm',
  width: 800,
  height: 600,
  sources: [
    { url: '/api/v1/public/media/0f6e0a52-2f0c-4a1b-9c55-1f4e2d6a7b8c/md', width: 640 },
    { url: '/api/v1/public/media/0f6e0a52-2f0c-4a1b-9c55-1f4e2d6a7b8c/lg', width: 1280 },
  ],
};

test('category tiles (C11b): a chosen photo is drawn under the scrim with the name on it; no photo is the flat tile', () => {
  const html = renderToStaticMarkup(
    <CategoryGrid
      title="Dịch vụ"
      items={[
        { key: 'a', name: 'Gội đầu', href: '/vi/services?group=a', image },
        { key: 'b', name: 'Nail', href: '/vi/services?group=b', image: null },
        { key: 'c', name: 'Massage', href: '/vi/services?group=c' },
      ]}
    />,
  );
  const tiles = html.split('<li>').slice(1);
  assert.equal(tiles.length, 3);
  assert.match(tiles[0]!, /class="ls-home-cat" data-media="photo"/);
  assert.match(tiles[0]!, /<img[^>]*class="ls-home-cat-img"[^>]*alt=""/);
  assert.match(tiles[0]!, /srcSet="[^"]*\/md 640w, [^"]*\/lg 1280w"/);
  assert.match(tiles[0]!, /<span class="ls-home-cat-name">Gội đầu<\/span>/);
  for (const flat of tiles.slice(1)) {
    assert.doesNotMatch(flat, /data-media|<img/);
  }
});

test('cosmetics category items carry the category photo and open the catalog filtered to it', () => {
  const [item] = categoryItems('vi', [
    { code: 'da', name: 'Chăm sóc da', parentCode: null, image },
  ]);
  assert.equal(item?.image, image);
  assert.equal(item?.href, '/vi/products?category=da');
});
