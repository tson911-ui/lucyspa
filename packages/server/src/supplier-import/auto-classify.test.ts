import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyProduct,
  deriveBrands,
  LUCY_CATEGORIES,
  supplierSellingPrice,
} from './auto-classify.js';
import { HARUOHUI_SAMPLE } from './auto-classify.fixture.js';

const byKey = (key: string) => HARUOHUI_SAMPLE.find((item) => item.key === key)!;
const run = (key: string) => {
  const item = byKey(key);
  return classifyProduct({ name: item.name, categoryNames: item.categories });
};

test('the fixed list has the twelve categories of the Owner, in his order and with his words', () => {
  assert.deepEqual(
    LUCY_CATEGORIES.map((category) => category.nameVi),
    [
      'Làm sạch',
      'Nước hoa hồng/Toner',
      'Serum/Tinh chất',
      'Dưỡng ẩm/Kem dưỡng',
      'Chăm sóc mắt',
      'Chống nắng',
      'Mặt nạ',
      'Trang điểm',
      'Chăm sóc cơ thể',
      'Chăm sóc tóc',
      'Bộ sản phẩm/Set',
      'Khác',
    ],
  );
});

test('the 20 sampled haruohui.com products: every one is OHUI and gets its category from the supplier type category', () => {
  const expected: Record<string, string> = {
    '323': 'TONER', // Nước Hoa Hồng
    '324': 'CLEANSE', // Sữa rửa mặt
    '325': 'MOISTURE', // Sữa Dưỡng
    '330': 'MOISTURE',
    '332': 'SERUM', // Tinh Chất
    '333': 'CLEANSE',
    '335': 'CLEANSE', // Tẩy Trang
    '336': 'CLEANSE',
    '337': 'MOISTURE',
    '339': 'TONER',
    '340': 'SERUM', // Ampoule huyết thanh, although the name starts with "Set"
    '341': 'MOISTURE', // Kem Dưỡng
    '342': 'CLEANSE',
    '343': 'SERUM',
    '344': 'MASK', // the supplier files the water pad under Mặt Nạ: the supplier type comes first
    '345': 'TONER',
    '346': 'CLEANSE', // Tẩy Tế Bào Da Chết
    '348': 'MASK',
    '350': 'MOISTURE',
    '351': 'MOISTURE',
  };
  assert.equal(HARUOHUI_SAMPLE.length, 20);
  for (const item of HARUOHUI_SAMPLE) {
    const result = classifyProduct({ name: item.name, categoryNames: item.categories });
    assert.equal(result.category.key, expected[item.key], `${item.key} ${item.name}`);
    assert.equal(result.category.by, 'SUPPLIER_CATEGORY', item.key);
    assert.equal(result.brand?.text, 'OHUI', `${item.key} brand`);
    assert.equal(result.brand?.by, 'CATEGORY');
    // Product lines ("Ohui Tái sinh The First") are never a category and are not the brand.
    assert.equal(result.lines.length, 1, `${item.key} lines`);
    assert.ok(result.lines[0]!.startsWith('Ohui') || result.lines[0]!.startsWith('OHUI'));
    assert.notEqual(result.category.term, result.lines[0]);
    assert.notEqual(result.category.term, 'OHUI');
  }
});

test('the supplier type category is remembered as the term that decided', () => {
  assert.equal(run('323').category.term, 'Nước Hoa Hồng');
  assert.equal(run('340').category.term, 'Ampoule huyết thanh');
  assert.equal(run('346').category.term, 'Tẩy Tế Bào Da Chết');
});

test('without a supplier type category the keywords of the name decide, Vietnamese and English', () => {
  const name = (value: string, categories: string[] = ['Chăm Sóc Da Mặt']) =>
    classifyProduct({ name: value, categoryNames: categories }).category;
  assert.equal(name('Sữa rửa mặt Abc').key, 'CLEANSE');
  assert.equal(name('Abc Cleansing Oil').key, 'CLEANSE');
  assert.equal(name('Dầu tẩy trang Abc').key, 'CLEANSE');
  assert.equal(name('Nước hoa hồng Abc').key, 'TONER');
  assert.equal(name('Abc Skin Softener').key, 'TONER');
  assert.equal(name('Abc Toner 150ml').key, 'TONER');
  assert.equal(name('Serum Abc').key, 'SERUM');
  assert.equal(name('Tinh chất Abc').key, 'SERUM');
  assert.equal(name('Abc Essence').key, 'SERUM');
  assert.equal(name('Abc Ampoule 10 ống').key, 'SERUM');
  assert.equal(name('Kem dưỡng Abc').key, 'MOISTURE');
  assert.equal(name('Sữa dưỡng Abc').key, 'MOISTURE');
  assert.equal(name('Abc Cream').key, 'MOISTURE');
  assert.equal(name('Abc Emulsion').key, 'MOISTURE');
  assert.equal(name('Kem dưỡng mắt Abc').key, 'EYE', 'eye care before a general cream');
  assert.equal(name('Abc Eye Cream').key, 'EYE');
  assert.equal(name('Kem chống nắng Abc SPF50').key, 'SUN', 'sun care before a general cream');
  assert.equal(name('Abc Sun Cream').key, 'SUN');
  assert.equal(name('Mặt nạ giấy Abc').key, 'MASK');
  assert.equal(name('Abc Sheet Mask').key, 'MASK');
  assert.equal(name('Son môi Abc').key, 'MAKEUP');
  assert.equal(name('Phấn phủ Abc').key, 'MAKEUP');
  assert.equal(
    name('Abc Cushion SPF50').key,
    'SUN',
    'a sun cushion is sun care by its SPF: sun comes first',
  );
  assert.equal(name('Abc Cushion').key, 'MAKEUP');
  assert.equal(name('Abc Foundation').key, 'MAKEUP');
  assert.equal(name('Sữa tắm Abc').key, 'BODY');
  assert.equal(name('Abc Body Lotion').key, 'BODY', 'body care before a general lotion');
  assert.equal(name('Dầu gội Abc').key, 'HAIR');
  assert.equal(name('Abc Hair Serum').key, 'HAIR', 'hair care before a general serum');
  assert.equal(name('Bộ dưỡng da Abc').key, 'SET');
  assert.equal(name('Set Abc 3 món').key, 'SET');
  assert.equal(name('Một sản phẩm không rõ').key, 'OTHER');
  assert.equal(name('Một sản phẩm không rõ').by, 'NONE');
});

test('an accent decides: "mặt" (face) is not "mắt" (eye)', () => {
  const category = (value: string) =>
    classifyProduct({ name: value, categoryNames: [] }).category.key;
  assert.equal(category('Sữa rửa mặt Abc'), 'CLEANSE');
  assert.equal(category('Gel dưỡng mắt Abc'), 'EYE');
  assert.equal(category('Tinh chất da mặt Abc'), 'SERUM');
  assert.equal(category('Dưỡng mặt Abc'), 'OTHER', 'face alone is not a type');
});

test('a gift set category from the supplier makes a set; a brand or a product line is never a category', () => {
  const set = classifyProduct({
    name: 'Ohui Extreme White Special Edition',
    categoryNames: ['Chăm Sóc Da Mặt', 'Set Quà Tặng Ohui', 'OHUI', 'Ohui Trắng Da Extreme White'],
  });
  assert.equal(set.category.key, 'SET');
  assert.equal(set.category.term, 'Set Quà Tặng Ohui');
  assert.equal(set.brand?.text, 'OHUI');
  // A brand whose name looks like a keyword ("Sun Lab") is a brand only when Lucy already has it; otherwise it is not invented.
  const looks = {
    name: 'Sun Lab Mystery 50ml',
    categoryNames: ['Sun Lab', 'Sun Lab Hộp xanh', 'Sun Lab Hộp đỏ'],
  };
  assert.equal(classifyProduct(looks).brand, null);
  const brandOnly = classifyProduct(looks, ['Sun Lab']);
  assert.equal(brandOnly.brand?.text, 'Sun Lab');
  assert.equal(brandOnly.category.key, 'OTHER', 'the brand name is not read as a keyword');
});

test('the brand: the supplier brand text first, then the category the lines start with, then a brand Lucy already has', () => {
  const own = classifyProduct({ name: 'X', categoryNames: [], brandText: ' The Whoo ' });
  assert.deepEqual(own.brand, { text: 'The Whoo', by: 'SOURCE' });
  const known = classifyProduct(
    { name: 'Kem dưỡng Sum37 Water-full', categoryNames: ['Chăm Sóc Da Mặt'] },
    ['Sum37', 'Ohui'],
  );
  assert.deepEqual(known.brand, { text: 'Sum37', by: 'NAME' });
  const none = classifyProduct({ name: 'Kem dưỡng Abc', categoryNames: ['Chăm Sóc Da Mặt'] });
  assert.equal(none.brand, null);
  // Two lines of one brand and a type: the brand is the shared first part.
  const lines = classifyProduct({
    name: 'Sữa rửa mặt THE WHOO Gongjinhyang Foam',
    categoryNames: ['THE WHOO', 'The Whoo Cung Đình', 'The Whoo Hoàng Hậu', 'Sữa rửa mặt'],
  });
  assert.equal(lines.brand?.text, 'THE WHOO');
  assert.deepEqual(lines.lines, ['The Whoo Cung Đình', 'The Whoo Hoàng Hậu']);
  assert.equal(lines.category.key, 'CLEANSE');
});

test('the selling price is the supplier price (the sale price when lower), rounded to 1,000 VND, never below 1,000', () => {
  assert.equal(supplierSellingPrice(350_000), 350_000n);
  assert.equal(supplierSellingPrice(350_400), 350_000n);
  assert.equal(supplierSellingPrice(350_500), 351_000n);
  assert.equal(
    supplierSellingPrice(400_000, 350_000),
    350_000n,
    'the sale price is what a buyer pays',
  );
  assert.equal(supplierSellingPrice(350_000, 350_000), 350_000n);
  assert.equal(
    supplierSellingPrice(350_000, 400_000),
    350_000n,
    'a "sale" price above the regular price is ignored',
  );
  assert.equal(supplierSellingPrice(null, 90_000), 90_000n);
  assert.equal(supplierSellingPrice(300), 1_000n);
  assert.equal(supplierSellingPrice(null, null), null);
  assert.equal(supplierSellingPrice(0, 0), null);
  assert.equal(supplierSellingPrice(5_000_000_000), 5_000_000_000n);
});

// Cases from the full read of haruohui.com (352 products, 2026-10-11): what the first rules got wrong on the real data.
const THE_WHOO = [
  {
    name: 'Dầu Tẩy Trang Whoo Gongjinhyang Clarifying Cleansing Oil',
    categoryNames: ['Chăm Sóc Da Mặt', 'THE WHOO', 'Tẩy Trang', 'Whoo vàng Gongjinhyang'],
  },
  {
    name: 'Kem dưỡng mắt Whoo Hwanyu Imperial Youth Eye Cream',
    categoryNames: ['Chăm Sóc Da Mặt', 'Kem Mắt', 'THE WHOO', 'Whoo Hoàn Lưu Cao Hwanyu'],
  },
  {
    name: 'Mặt nạ ngủ Whoo Cheonyuldan Ultimate Regenerating Overnight Mask',
    categoryNames: ['Chăm Sóc Da Mặt', 'Mặt Nạ', 'THE WHOO', 'Whoo tái sinh cao cấp Cheonyuldan'],
  },
];

test('a brand whose lines start with the brand without "The" (THE WHOO / Whoo Bichup) is still the brand, also for a product that lists only a line', () => {
  const whoo = classifyProduct(THE_WHOO[0]!);
  assert.equal(whoo.brand?.text, 'THE WHOO');
  assert.deepEqual(whoo.lines, ['Whoo vàng Gongjinhyang']);
  assert.equal(whoo.category.key, 'CLEANSE');
  const batch = [
    ...THE_WHOO,
    { name: 'X', categoryNames: ['Chăm Sóc Da Mặt', 'Whoo Bichup', 'Tinh Chất'] },
  ];
  const dictionary = deriveBrands(batch);
  assert.deepEqual(dictionary, ['THE WHOO']);
  const lineOnly = classifyProduct(
    {
      name: 'Tinh Chất Tế Bào Gốc The Whoo Bichup NAD',
      categoryNames: ['Chăm Sóc Da Mặt', 'Whoo Bichup', 'Tinh Chất'],
    },
    [],
    dictionary,
  );
  assert.deepEqual(lineOnly.brand, { text: 'THE WHOO', by: 'DICTIONARY' });
  assert.equal(lineOnly.category.key, 'SERUM');
  assert.equal(
    classifyProduct({
      name: 'Tinh Chất Tế Bào Gốc The Whoo Bichup NAD',
      categoryNames: ['Whoo Bichup'],
    }).brand?.text,
    'Whoo Bichup',
    'without the batch a lone line is all there is',
  );
});

test('a gift-set group, supplements and "Trang Điểm Makeup" are never brands; a set category wins over a type category', () => {
  const set = classifyProduct({
    name: 'Bộ Tinh Chất First Serum Whoo Hwanyu Imperial Youth First Serum 75ml',
    categoryNames: [
      'Chăm Sóc Da Mặt',
      'Kem Dưỡng',
      'Set Quà Tặng',
      'Set Quà Tặng Whoo',
      'THE WHOO',
      'Tinh Chất',
      'Whoo Hoàn Lưu Cao Hwanyu',
    ],
  });
  assert.equal(set.brand?.text, 'THE WHOO');
  assert.equal(set.category.key, 'SET');
  assert.equal(set.category.term, 'Set Quà Tặng');
  const dictionary = deriveBrands([
    { categoryNames: ['Set Quà Tặng', 'Set Quà Tặng Whoo', 'Set Quà Tặng Ohui'], name: 'Bộ A' },
    { categoryNames: ['Trang Điểm Makeup', 'Whoo Trang điểm', 'Ohui Trang Điểm'], name: 'Phấn B' },
    { categoryNames: ['Thực phẩm chức năng', 'Thực phẩm chức năng trẻ em'], name: 'Thạch Kids' },
  ]);
  assert.deepEqual(dictionary, [], 'none of them is a brand');
  const supplement = classifyProduct({
    name: 'Collagen Dạng Nước TPCN SHJW Hanami Collagen Ampoule 28 ống',
    categoryNames: ['Thực phẩm chức năng'],
  });
  assert.equal(
    supplement.category.key,
    'OTHER',
    'a supplement is not a serum because the word ampoule is in its name',
  );
  assert.equal(supplement.brand, null);
});

test('a cleanser is a cleanser even when it names the eyes; a set is a set even when only its name says so', () => {
  const category = (name: string, categories: string[] = []) =>
    classifyProduct({ name, categoryNames: categories }).category.key;
  assert.equal(
    category('Tẩy trang mắt môi Care Zone Doctor Solution Lip & Eye Remover 300ml'),
    'CLEANSE',
  );
  assert.equal(category('Kem dưỡng mắt Abc Eye Cream'), 'EYE');
  assert.equal(
    category('Whoo Đỏ Whoo Jinyulhyang Intensive Revitalizing Special Set 8 món'),
    'SET',
  );
  assert.equal(
    category('Sữa Rửa Mặt Whoo Gongjinhyang Clarifying Cleansing Foam Special Set'),
    'SET',
  );
  assert.equal(
    category('Gel Tẩy Tế Bào Chết Dạng Gel Whoo Seol Brightening Gommage Gel'),
    'CLEANSE',
  );
  assert.equal(
    category('Xịt Khoáng CNP Laboratory Propolis Energy Ampule Mist 50ml', [
      'Chăm Sóc Da Mặt',
      'CNP',
      'Xịt Khoáng',
    ]),
    'OTHER',
    'a mist has no place in the fixed list: Khác',
  );
  // A line that is really "<brand> <type>" still says what the product is.
  const line = classifyProduct({
    name: 'Su:m37 Something Special 50ml',
    categoryNames: ['SU:M37', 'Su:m37 Chống Nắng', 'Su:m37 Secret'],
  });
  assert.equal(line.brand?.text, 'SU:M37');
  assert.equal(line.category.key, 'SUN');
  assert.equal(line.category.term, 'Su:m37 Chống Nắng');
});

test('CARE ZONE is also written CAREZONE in a name; a product with no category at all finds its brand in its name from the batch', () => {
  const dictionary = deriveBrands([
    {
      name: 'Kem Dưỡng CAREZONE A-Cure Calming Cream',
      categoryNames: ['CARE ZONE', 'Chăm Sóc Da Mặt', 'Kem Dưỡng'],
    },
    {
      name: 'Sữa Dưỡng CAREZONE Clarifying Emulsion',
      categoryNames: ['CARE ZONE', 'Chăm Sóc Da Mặt', 'Sữa Dưỡng'],
    },
    { name: 'Sữa Tắm Beyond Angel Kids Body Wash', categoryNames: ['BEYOND'] },
    { name: 'Dầu Gội Beyond Angel Kids Shampoo', categoryNames: ['BEYOND'] },
  ]);
  assert.deepEqual(dictionary.sort(), ['BEYOND', 'CARE ZONE']);
  const carezone = classifyProduct(
    {
      name: 'Kem Dưỡng CAREZONE A-Cure Calming Cream',
      categoryNames: ['CARE ZONE', 'Chăm Sóc Da Mặt', 'Kem Dưỡng'],
    },
    [],
    dictionary,
  );
  assert.equal(carezone.brand?.text, 'CARE ZONE');
  const bare = classifyProduct(
    { name: 'Kem Dưỡng Ẩm Thuần Chay Beyond Angel Aqua Moisture Cream 150ml', categoryNames: [] },
    [],
    dictionary,
  );
  assert.deepEqual(bare.brand, { text: 'BEYOND', by: 'NAME' });
  assert.equal(bare.category.key, 'MOISTURE');
});
