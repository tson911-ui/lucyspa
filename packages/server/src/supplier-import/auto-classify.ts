import { foldText } from './candidate-rules.js';

/**
 * Phase 9 P9-9b (Owner, 2026-10-11, docs/PHASE9_PRODUCT_IMPORT.md section 17): the automatic brand and category of an imported
 * product, so a person does not have to map every value by hand. Pure: no database, no network, no AI (P9-T10).
 *
 * Categories: the Owner's fixed list of twelve. Each product is mapped from the supplier's PRODUCT-TYPE categories first, then from
 * keywords in the product name (Vietnamese and English). Brand and product-line names are never categories. Nothing matched: "Khác".
 * Brand: the supplier's brand text when it gives one; otherwise the supplier category that is the brand (the one the product-line
 * categories start with, which the whole batch of products teaches: a product that lists only a line still finds its brand); otherwise
 * a brand Lucy already has that the name contains.
 *
 * Vietnamese is matched WITH its accents (lower-cased, composed): "mắt" (eye) and "mặt" (face) differ only by one accent, so the usual
 * accent-folding would put every face product under eye care.
 */

export type LucyCategoryKey =
  | 'CLEANSE'
  | 'TONER'
  | 'SERUM'
  | 'MOISTURE'
  | 'EYE'
  | 'SUN'
  | 'MASK'
  | 'MAKEUP'
  | 'BODY'
  | 'HAIR'
  | 'SET'
  | 'OTHER';

/** The fixed list, in the Owner's order. Names are exactly the Owner's words. */
export const LUCY_CATEGORIES: readonly { key: LucyCategoryKey; nameVi: string; nameEn: string }[] =
  [
    { key: 'CLEANSE', nameVi: 'Làm sạch', nameEn: 'Cleansers' },
    { key: 'TONER', nameVi: 'Nước hoa hồng/Toner', nameEn: 'Toner' },
    { key: 'SERUM', nameVi: 'Serum/Tinh chất', nameEn: 'Serum / Essence' },
    { key: 'MOISTURE', nameVi: 'Dưỡng ẩm/Kem dưỡng', nameEn: 'Moisturizers / Creams' },
    { key: 'EYE', nameVi: 'Chăm sóc mắt', nameEn: 'Eye care' },
    { key: 'SUN', nameVi: 'Chống nắng', nameEn: 'Sun care' },
    { key: 'MASK', nameVi: 'Mặt nạ', nameEn: 'Masks' },
    { key: 'MAKEUP', nameVi: 'Trang điểm', nameEn: 'Makeup' },
    { key: 'BODY', nameVi: 'Chăm sóc cơ thể', nameEn: 'Body care' },
    { key: 'HAIR', nameVi: 'Chăm sóc tóc', nameEn: 'Hair care' },
    { key: 'SET', nameVi: 'Bộ sản phẩm/Set', nameEn: 'Sets' },
    { key: 'OTHER', nameVi: 'Khác', nameEn: 'Other' },
  ];

const WORD = '(?<![\\p{L}\\p{N}])';
const END = '(?![\\p{L}\\p{N}])';
const phrase = (value: string) => new RegExp(`${WORD}${value}${END}`, 'u');
const any = (...values: string[]) => phrase(`(?:${values.join('|')})`);

/**
 * The keyword rules in PRIORITY order: the first rule that matches decides. A specific kind comes before a generic one ("kem dưỡng
 * mắt" is eye care before "kem dưỡng" is a moisturizer; "body cleanser" is body care before "cleanser" is a cleanser).
 */
const RULES: readonly { key: Exclude<LucyCategoryKey, 'OTHER' | 'SET'>; test: RegExp }[] = [
  {
    key: 'SUN',
    test: any(
      'chống nắng',
      'sunscreen',
      'sun cream',
      'sun block',
      'sunblock',
      'sun stick',
      'sun',
      'spf\\s?\\d*',
    ),
  },
  {
    // A remover or a cleanser is a cleanser even when it names the eyes or make-up ("Eye & Lip Makeup Remover").
    key: 'CLEANSE',
    test: any(
      'tẩy trang',
      'remover',
      'cleansing',
      'cleanser',
      'cleanse',
      'sữa rửa mặt',
      'rửa mặt',
      'micellar',
    ),
  },
  {
    key: 'MAKEUP',
    test: any(
      'son',
      'son môi',
      'son lì',
      'phấn',
      'phấn nước',
      'cushion',
      'foundation',
      'kem nền',
      'kem lót',
      'lót nền',
      'bb cream',
      'cc cream',
      'lipstick',
      'lip tint',
      'lip gloss',
      'lipbalm',
      'mascara',
      'eyeliner',
      'eye liner',
      'eyebrow',
      'kẻ mắt',
      'kẻ mày',
      'che khuyết điểm',
      'concealer',
      'primer',
      'má hồng',
      'blush',
      'highlighter',
      'makeup',
      'make-up',
      'trang điểm',
    ),
  },
  { key: 'EYE', test: any('mắt', 'eye', 'eyes') },
  { key: 'HAIR', test: any('tóc', 'hair', 'dầu gội', 'dầu xả', 'shampoo', 'conditioner') },
  {
    key: 'BODY',
    test: any(
      'body',
      'dưỡng thể',
      'sữa tắm',
      'cơ thể',
      'hand cream',
      'kem tay',
      'dưỡng da tay',
      'foot cream',
      'kem chân',
      'tắm',
    ),
  },
  { key: 'MASK', test: any('mặt nạ', 'mask', 'sheet mask', 'sleeping pack') },
  { key: 'SERUM', test: any('serum', 'tinh chất', 'essence', 'ampoule', 'huyết thanh') },
  {
    key: 'TONER',
    test: any('nước hoa hồng', 'toner', 'softener', 'nước cân bằng', 'skin refiner', 'balancer'),
  },
  {
    key: 'CLEANSE',
    test: any(
      'foam',
      'tẩy tế bào chết',
      'tẩy tế bào da chết',
      'tẩy da chết',
      'peeling',
      'scrub',
      'exfoliat\\w*',
      'làm sạch',
      'gommage',
    ),
  },
  {
    key: 'MOISTURE',
    test: any(
      'kem dưỡng',
      'sữa dưỡng',
      'kem',
      'cream',
      'emulsion',
      'lotion',
      'moisturi[sz]er',
      'gel dưỡng',
      'dưỡng da',
    ),
  },
];

/** A set or gift box: a supplier category says so, or the name starts with "Bộ" or "Set", or has the word "set" in it. */
const SET_TERM = any(
  'set quà tặng',
  'quà tặng',
  'bộ sản phẩm',
  'bộ set',
  'bộ',
  'set',
  'combo',
  'gift set',
);
const SET_NAME = /^\s*bộ(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])set(?![\p{L}\p{N}])/iu;

const norm = (value: string) => value.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();

/** Supplier categories that only say "skin care", "supplements" or "on sale": they never decide a category and are never a brand. */
const GENERIC_TERMS = [
  'chăm sóc da mặt',
  'chăm sóc da',
  'chăm sóc da mặt và cơ thể',
  'sản phẩm',
  'tất cả sản phẩm',
  'khuyến mãi',
  'hàng mới',
  'bán chạy',
  'mỹ phẩm',
  'mỹ phẩm hàn quốc',
  'chưa phân loại',
  'uncategorized',
  'cửa hàng',
  'thực phẩm chức năng',
  'tpcn',
  'đặc trị treatment',
].map(norm);
const isGeneric = (term: string) => {
  const value = norm(term);
  return GENERIC_TERMS.some((entry) => value === entry || value.startsWith(`${entry} `));
};

/** Supplements ("Thực phẩm chức năng", "TPCN") are not beauty products: no Lucy category fits them, so they go to "Khác". */
const SUPPLEMENT = any('thực phẩm chức năng', 'tpcn');

/**
 * Supplier categories that name a kind of product the fixed list has no place for ("Xịt khoáng", "Đặc trị"): never a brand and never
 * a line, and they do not decide a category either (the keywords of the name still can).
 */
const NEUTRAL_TYPE = any('xịt khoáng', 'đặc trị', 'treatment', 'mist');

function ruleMatch(text: string): LucyCategoryKey | null {
  const value = norm(text);
  for (const rule of RULES) if (rule.test.test(value)) return rule.key;
  return null;
}

/** A brand's key: accents and case ignored, and a leading "The" dropped ("THE WHOO" and "Whoo Bichup" share "whoo"). */
const brandKey = (value: string) => foldText(value).replace(/^the\s+/, '');

/** Whether `longer` is `shorter` followed by more words (accents, case and a leading "The" ignored): "ohui tái sinh" starts with "ohui". */
function startsWithWords(longer: string, shorter: string): boolean {
  const a = brandKey(longer);
  const b = brandKey(shorter);
  return b !== '' && a.length > b.length && a.startsWith(`${b} `);
}

/** The line without the brand words it starts with ("Su:m37 Chống Nắng" without "Su:m37"), keeping its accents. */
function withoutBrandPrefix(line: string, brandText: string): string {
  const words = line.split(/\s+/u);
  for (let count = 1; count < words.length; count += 1) {
    if (brandKey(words.slice(0, count).join(' ')) === brandKey(brandText)) {
      return words.slice(count).join(' ');
    }
  }
  return '';
}

function containsWords(haystack: string, needle: string): boolean {
  const h = ` ${foldText(haystack)} `;
  const n = foldText(needle);
  if (n === '') return false;
  if (h.includes(` ${n} `)) return true;
  // "CARE ZONE" is written "CAREZONE" in a name: the same brand without the space.
  const joined = n.replace(/ /g, '');
  return joined.length >= 5 && n.includes(' ') && h.replace(/ /g, '').includes(joined);
}

export interface ClassifyInput {
  name: string;
  /** The supplier's category names as listed (a flat list). */
  categoryNames: readonly string[];
  /** The supplier's own brand text, when it gives one. */
  brandText?: string | null;
}

export interface Classification {
  brand: { text: string; by: 'SOURCE' | 'CATEGORY' | 'DICTIONARY' | 'NAME' } | null;
  /** The supplier categories that are product lines of the brand (never categories). */
  lines: string[];
  category: {
    key: LucyCategoryKey;
    by: 'SUPPLIER_CATEGORY' | 'NAME' | 'NONE';
    /** The supplier category that decided (to be remembered), when there was one. */
    term: string | null;
  };
}

/** The terms of one product that can be a brand or a line: not generic, not a product type, not a set. */
function brandTerms(terms: readonly string[], known: ReadonlySet<string>): string[] {
  return terms.filter(
    (term) =>
      !isGeneric(term) &&
      (known.has(foldText(term)) ||
        (ruleMatch(term) === null &&
          !SET_TERM.test(norm(term)) &&
          !NEUTRAL_TYPE.test(norm(term)) &&
          !SUPPLEMENT.test(norm(term)))),
  );
}

/** The leaders of one product: a brand term that the product-line terms start with. */
function leadersOf(rest: readonly string[]): string[] {
  return rest
    .filter((term) => rest.some((other) => other !== term && startsWithWords(other, term)))
    .sort((a, b) => a.length - b.length);
}

/**
 * The brands a whole batch of products teaches: every category that a product-line category of the same product starts with. A
 * product that lists only a line ("Whoo Bichup") then still finds its brand ("THE WHOO") from the others. Returns display texts.
 */
export function deriveBrands(
  products: readonly { categoryNames: readonly string[]; name?: string }[],
  knownBrands: readonly string[] = [],
): string[] {
  const known = new Set(knownBrands.map((brand) => foldText(brand)));
  const found = new Map<string, { text: string; count: number }>();
  for (const product of products) {
    const terms = product.categoryNames.map((term) => term.trim()).filter((term) => term !== '');
    for (const leader of leadersOf(brandTerms(terms, known))) {
      const key = brandKey(leader);
      const entry = found.get(key);
      if (entry) entry.count += 1;
      else found.set(key, { text: leader, count: 1 });
    }
  }
  // A category the product name itself carries, in two or more products, is a brand too ("BEYOND" when no line starts with it).
  const carried = new Map<string, { text: string; count: number }>();
  for (const product of products) {
    if (product.name === undefined) continue;
    const terms = product.categoryNames.map((term) => term.trim()).filter((term) => term !== '');
    for (const term of brandTerms(terms, known)) {
      const key = brandKey(term);
      if (found.has(key) || [...found.values()].some((brand) => startsWithWords(term, brand.text)))
        continue;
      if (!containsWords(product.name, term)) continue;
      const entry = carried.get(key);
      if (entry) entry.count += 1;
      else carried.set(key, { text: term, count: 1 });
    }
  }
  for (const [key, entry] of carried) if (entry.count >= 2) found.set(key, entry);
  return [...found.values()]
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .map((entry) => entry.text);
}

export function classifyProduct(
  input: ClassifyInput,
  knownBrands: readonly string[] = [],
  dictionary: readonly string[] = [],
): Classification {
  const terms = input.categoryNames.map((term) => term.trim()).filter((term) => term !== '');
  const known = new Set(knownBrands.map((brand) => foldText(brand)));
  // (A category that names a brand Lucy already has stays a brand even when its words look like a type, such as "Sun Lab".)
  const rest = brandTerms(terms, known);

  let brand: Classification['brand'] = null;
  const own = (input.brandText ?? '').trim();
  if (own !== '') brand = { text: own, by: 'SOURCE' };
  if (brand === null) {
    // The category the product lines start with is the brand ("OHUI" for "Ohui Tái sinh The First").
    const leaders = leadersOf(rest);
    const inName = (term: string) => containsWords(input.name, term);
    const lead = leaders.find(inName) ?? leaders[0];
    if (lead !== undefined) brand = { text: lead, by: 'CATEGORY' };
  }
  if (brand === null) {
    // A brand the batch taught (or Lucy has): the product lists the brand itself, or only one of its lines.
    const taught = [...dictionary, ...knownBrands];
    const direct = rest.find((term) => taught.some((entry) => brandKey(entry) === brandKey(term)));
    const viaLine = rest.find((term) => taught.some((entry) => startsWithWords(term, entry)));
    const hit = direct ?? viaLine;
    if (hit !== undefined) {
      const entry = taught.find(
        (item) => brandKey(item) === brandKey(hit) || startsWithWords(hit, item),
      );
      brand = { text: entry ?? hit, by: 'DICTIONARY' };
    }
  }
  if (brand === null && rest.length === 1 && containsWords(input.name, rest[0]!)) {
    // The only category that is neither a type nor generic, and the name says it: the brand.
    brand = { text: rest[0]!, by: 'CATEGORY' };
  }
  if (brand === null) {
    // A brand the batch taught or Lucy has, written in the name itself (also for a product with no categories at all).
    const named = [...dictionary, ...knownBrands]
      .filter((candidate) => containsWords(input.name, brandKey(candidate)))
      .sort((a, b) => b.length - a.length)[0];
    if (named !== undefined) brand = { text: named, by: 'NAME' };
  }
  const lines =
    brand === null
      ? []
      : terms.filter(
          (term) =>
            !isGeneric(term) &&
            brandKey(term) !== brandKey(brand!.text) &&
            startsWithWords(term, brand!.text),
        );
  const excluded = new Set([...(brand ? [norm(brand.text)] : []), ...lines.map(norm)]);
  // A line that is really "<brand> <type>" ("Ohui Chống nắng", "Su:m37 Làm sạch") still says what kind of product it is.
  const lineTypes = brand
    ? lines.map((line) => ({ line, rest: withoutBrandPrefix(line, brand!.text) }))
    : [];

  // 0. Supplements are not beauty products: no category of the fixed list fits, so they go to "Khác".
  const supplement = terms.find((term) => SUPPLEMENT.test(norm(term)));
  if (supplement !== undefined || SUPPLEMENT.test(norm(input.name))) {
    return {
      brand,
      lines,
      category: { key: 'OTHER', by: 'SUPPLIER_CATEGORY', term: supplement ?? null },
    };
  }
  // 1. A set or gift box says so in a supplier category.
  const candidates = terms.filter((term) => !isGeneric(term) && !excluded.has(norm(term)));
  const setTerm = candidates.find((term) => SET_TERM.test(norm(term)));
  if (setTerm !== undefined) {
    return { brand, lines, category: { key: 'SET', by: 'SUPPLIER_CATEGORY', term: setTerm } };
  }
  // 2. The supplier's product-type categories, in the order of the rules (never a brand or a product line).
  const decided = RULES.map((rule) => ({
    key: rule.key,
    term: candidates.find((term) => rule.test.test(norm(term))),
  })).find((entry) => entry.term !== undefined);
  if (decided?.term !== undefined) {
    return {
      brand,
      lines,
      category: { key: decided.key, by: 'SUPPLIER_CATEGORY', term: decided.term },
    };
  }
  // 3. A line of the brand that is really a type.
  const typedLine = lineTypes
    .map((entry) => ({ entry, key: ruleMatch(entry.rest) }))
    .find((candidate) => candidate.key !== null);
  if (typedLine?.key) {
    return {
      brand,
      lines,
      category: { key: typedLine.key, by: 'SUPPLIER_CATEGORY', term: typedLine.entry.line },
    };
  }
  // 4. Keywords in the product name (a set first: its name starts with "Bộ" or has the word "set").
  if (SET_NAME.test(input.name)) {
    return { brand, lines, category: { key: 'SET', by: 'NAME', term: null } };
  }
  // The brand's own name is not read as a keyword (a brand called "Sun" or "Mask Lab" says nothing about the product).
  const name = brand ? norm(input.name).replace(norm(brand.text), ' ') : norm(input.name);
  const keyword = ruleMatch(name);
  if (keyword !== null) return { brand, lines, category: { key: keyword, by: 'NAME', term: null } };
  return { brand, lines, category: { key: 'OTHER', by: 'NONE', term: null } };
}

/**
 * The selling price taken from the supplier's listed price (Owner decision, section 17): the price a buyer pays on the supplier's site
 * (the sale price when one is lower than the regular price), rounded to the nearest 1,000 VND, never below 1,000. Null when the source
 * gave no usable price: such a product cannot be published and is listed as a blocker.
 */
export function supplierSellingPrice(
  priceVnd: number | bigint | null | undefined,
  promoPriceVnd?: number | bigint | null,
): bigint | null {
  const regular = priceVnd === null || priceVnd === undefined ? 0n : BigInt(priceVnd);
  const promo = promoPriceVnd === null || promoPriceVnd === undefined ? 0n : BigInt(promoPriceVnd);
  const listed = promo > 0n && (regular === 0n || promo < regular) ? promo : regular;
  if (listed <= 0n) return null;
  const rounded = ((listed + 500n) / 1000n) * 1000n;
  return rounded < 1000n ? 1000n : rounded;
}
