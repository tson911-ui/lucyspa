import type {
  WebsiteFeaturedGroup,
  WebsiteShopFact,
  WebsiteShopInfoInput,
  WebsiteShopInfoResponse,
  WebsiteShopInfoUpdateRequest,
  WebsiteWhyCard,
} from '@lucy-spa/contracts';

// The "Shop info" tab of the website content page (Part 2, P2-3): form state, the request and the client-side checks
// (the API decides every rule again and names the field it refused).
export const SHOP_INFO_LIMITS = Object.freeze({
  tagline: 120,
  intro: 200,
  factText: 80,
  groupDescription: 120,
  whyTitle: 80,
  whyHeading: 60,
  whyDescription: 200,
  address: 300,
  hotlineMax: 30,
  hotlineDigitsMin: 8,
  mapUrl: 500,
});

export type ShopInfoProblem =
  | 'taglineVi'
  | 'taglineEn'
  | 'introVi'
  | 'introEn'
  | 'address'
  | 'hotline'
  | 'mapUrl'
  | 'hoursBranchId'
  | 'heroMediaId'
  | 'facts'
  | 'featuredGroups'
  | 'whyTitleVi'
  | 'whyTitleEn'
  | 'whyCards';

export const SHOP_INFO_PROBLEMS: ReadonlySet<string> = new Set<ShopInfoProblem>([
  'taglineVi',
  'taglineEn',
  'introVi',
  'introEn',
  'address',
  'hotline',
  'mapUrl',
  'hoursBranchId',
  'heroMediaId',
  'facts',
  'featuredGroups',
  'whyTitleVi',
  'whyTitleEn',
  'whyCards',
]);

export interface ShopInfoForm {
  taglineVi: string;
  taglineEn: string;
  /** Optional; empty = the website's built-in sentence. */
  introVi: string;
  introEn: string;
  address: string;
  hotline: string;
  mapUrl: string;
  /** '' = the first active branch. */
  hoursBranchId: string;
  /** The chosen hero image's id, or '' for none. */
  heroMediaId: string;
  factsVisible: boolean;
  /** Ordered; the three built-in items are always in it. */
  facts: WebsiteShopFact[];
  /** Ordered; empty = the home page lists every group. */
  featuredGroups: WebsiteFeaturedGroup[];
  /** The optional "why choose us" section: off and empty until the Owner writes it. */
  whyVisible: boolean;
  whyTitleVi: string;
  whyTitleEn: string;
  whyCards: WebsiteWhyCard[];
}

export function formOfShopInfo(info: WebsiteShopInfoResponse): ShopInfoForm {
  return {
    taglineVi: info.taglineVi,
    taglineEn: info.taglineEn,
    introVi: info.introVi ?? '',
    introEn: info.introEn ?? '',
    address: info.address,
    hotline: info.hotline,
    mapUrl: info.mapUrl ?? '',
    hoursBranchId: info.hoursBranchId ?? '',
    heroMediaId: info.heroMediaId ?? '',
    factsVisible: info.factsVisible,
    facts: info.facts.map((fact) => ({ ...fact })),
    featuredGroups: info.featuredGroups.map((group) => ({ ...group })),
    whyVisible: info.whyVisible,
    whyTitleVi: info.whyTitleVi ?? '',
    whyTitleEn: info.whyTitleEn ?? '',
    whyCards: info.whyCards.map((card) => ({ ...card })),
  };
}

const clean = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const length = (value: string) => [...value].length;

/** A custom line's own id: the API wants a UUID, and the form is where it is made. */
export const newFactId = (): string => crypto.randomUUID();

/** The list in the order of `ids` (the order a drag or a move button produced). */
export function inOrder<T>(
  items: readonly T[],
  ids: readonly string[],
  idOf: (item: T) => string,
): T[] {
  const byId = new Map(items.map((item) => [idOf(item), item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item === undefined ? [] : [item];
  });
}

/** The request for the form, or the first field the API would refuse. */
export function shopInfoInputOf(
  form: ShopInfoForm,
): { body: WebsiteShopInfoInput } | { problem: ShopInfoProblem } {
  const taglineVi = clean(form.taglineVi);
  const taglineEn = clean(form.taglineEn);
  const introVi = clean(form.introVi);
  const introEn = clean(form.introEn);
  const address = clean(form.address);
  const hotline = clean(form.hotline);
  const mapUrl = clean(form.mapUrl);
  if (taglineVi === '' || length(taglineVi) > SHOP_INFO_LIMITS.tagline) {
    return { problem: 'taglineVi' };
  }
  if (taglineEn === '' || length(taglineEn) > SHOP_INFO_LIMITS.tagline) {
    return { problem: 'taglineEn' };
  }
  if (length(introVi) > SHOP_INFO_LIMITS.intro) return { problem: 'introVi' };
  if (length(introEn) > SHOP_INFO_LIMITS.intro) return { problem: 'introEn' };
  if (address === '' || length(address) > SHOP_INFO_LIMITS.address) return { problem: 'address' };
  if (
    !/^[0-9+().\s-]+$/.test(hotline) ||
    length(hotline) > SHOP_INFO_LIMITS.hotlineMax ||
    hotline.replace(/\D/g, '').length < SHOP_INFO_LIMITS.hotlineDigitsMin
  ) {
    return { problem: 'hotline' };
  }
  if (
    mapUrl !== '' &&
    (!/^https:\/\/\S+$/.test(mapUrl) || length(mapUrl) > SHOP_INFO_LIMITS.mapUrl)
  ) {
    return { problem: 'mapUrl' };
  }
  const facts: WebsiteShopFact[] = [];
  for (const fact of form.facts) {
    if (fact.kind !== 'CUSTOM') {
      facts.push({ ...fact, icon: null, textVi: null, textEn: null });
      continue;
    }
    const textVi = clean(fact.textVi ?? '');
    const textEn = clean(fact.textEn ?? '');
    if (
      textVi === '' ||
      textEn === '' ||
      length(textVi) > SHOP_INFO_LIMITS.factText ||
      length(textEn) > SHOP_INFO_LIMITS.factText ||
      fact.icon === null
    ) {
      return { problem: 'facts' };
    }
    facts.push({ ...fact, textVi, textEn });
  }
  const featuredGroups: WebsiteFeaturedGroup[] = [];
  for (const group of form.featuredGroups) {
    const descriptionVi = clean(group.descriptionVi ?? '');
    const descriptionEn = clean(group.descriptionEn ?? '');
    if (
      length(descriptionVi) > SHOP_INFO_LIMITS.groupDescription ||
      length(descriptionEn) > SHOP_INFO_LIMITS.groupDescription
    ) {
      return { problem: 'featuredGroups' };
    }
    featuredGroups.push({
      code: group.code,
      descriptionVi: descriptionVi === '' ? null : descriptionVi,
      descriptionEn: descriptionEn === '' ? null : descriptionEn,
    });
  }
  const whyTitleVi = clean(form.whyTitleVi);
  const whyTitleEn = clean(form.whyTitleEn);
  if (length(whyTitleVi) > SHOP_INFO_LIMITS.whyTitle || (form.whyVisible && whyTitleVi === '')) {
    return { problem: 'whyTitleVi' };
  }
  if (length(whyTitleEn) > SHOP_INFO_LIMITS.whyTitle || (form.whyVisible && whyTitleEn === '')) {
    return { problem: 'whyTitleEn' };
  }
  const whyCards: WebsiteWhyCard[] = [];
  for (const card of form.whyCards) {
    const cleaned = {
      headingVi: clean(card.headingVi),
      headingEn: clean(card.headingEn),
      descriptionVi: clean(card.descriptionVi),
      descriptionEn: clean(card.descriptionEn),
    };
    if (
      Object.values(cleaned).some((value) => value === '') ||
      length(cleaned.headingVi) > SHOP_INFO_LIMITS.whyHeading ||
      length(cleaned.headingEn) > SHOP_INFO_LIMITS.whyHeading ||
      length(cleaned.descriptionVi) > SHOP_INFO_LIMITS.whyDescription ||
      length(cleaned.descriptionEn) > SHOP_INFO_LIMITS.whyDescription
    ) {
      return { problem: 'whyCards' };
    }
    whyCards.push({ ...card, ...cleaned });
  }
  if (form.whyVisible && whyCards.length === 0) return { problem: 'whyCards' };
  return {
    body: {
      taglineVi,
      taglineEn,
      introVi: introVi === '' ? null : introVi,
      introEn: introEn === '' ? null : introEn,
      address,
      hotline,
      mapUrl: mapUrl === '' ? null : mapUrl,
      hoursBranchId: form.hoursBranchId === '' ? null : form.hoursBranchId,
      heroMediaId: form.heroMediaId === '' ? null : form.heroMediaId,
      factsVisible: form.factsVisible,
      facts,
      featuredGroups,
      whyVisible: form.whyVisible,
      whyTitleVi: whyTitleVi === '' ? null : whyTitleVi,
      whyTitleEn: whyTitleEn === '' ? null : whyTitleEn,
      whyCards,
    },
  };
}

export const shopInfoRequest = (
  body: WebsiteShopInfoInput,
  expectedVersion: number,
): WebsiteShopInfoUpdateRequest => ({ ...body, expectedVersion });

export function shopInfoChanged(a: ShopInfoForm, b: ShopInfoForm): boolean {
  const text = (form: ShopInfoForm) => ({
    taglineVi: clean(form.taglineVi),
    taglineEn: clean(form.taglineEn),
    introVi: clean(form.introVi),
    introEn: clean(form.introEn),
    address: clean(form.address),
    hotline: clean(form.hotline),
    mapUrl: clean(form.mapUrl),
    hoursBranchId: form.hoursBranchId,
    heroMediaId: form.heroMediaId,
    factsVisible: form.factsVisible,
    // Lists compare as the API would store them: same items, same order, same text.
    facts: form.facts,
    featuredGroups: form.featuredGroups,
    whyVisible: form.whyVisible,
    whyTitleVi: clean(form.whyTitleVi),
    whyTitleEn: clean(form.whyTitleEn),
    whyCards: form.whyCards,
  });
  return JSON.stringify(text(a)) !== JSON.stringify(text(b));
}

/** The API names the field it refused; anything else is a general message. */
export function shopInfoServerProblem(error: unknown): ShopInfoProblem | null {
  const failure = error as { code?: unknown; field?: unknown } | null;
  if (!failure || (failure.code !== 'VALIDATION_FAILED' && failure.code !== 'MEDIA_ALT_REQUIRED')) {
    return null;
  }
  if (failure.code === 'MEDIA_ALT_REQUIRED') return 'heroMediaId';
  return typeof failure.field === 'string' && SHOP_INFO_PROBLEMS.has(failure.field)
    ? (failure.field as ShopInfoProblem)
    : null;
}
