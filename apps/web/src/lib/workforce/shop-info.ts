import {
  CONTACT_LINK_MAX,
  facebookPageLinks,
  zaloLink,
  FOOTER_SOCIAL_NETWORKS,
  type FooterBlockType,
  type FooterSocialNetwork,
  type WebsiteFeaturedGroup,
  type WebsiteFooterBlock,
  type WebsiteFooterLink,
  type WebsiteShopFact,
  type WebsiteShopInfoInput,
  type WebsiteShopInfoResponse,
  type WebsiteShopInfoUpdateRequest,
  type WebsiteWhyCard,
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
  contactLink: CONTACT_LINK_MAX,
});

/** The footer block limits (the API holds the same numbers). */
export const FOOTER_LIMITS = Object.freeze({
  blocks: 12,
  url: 300,
  text: 300,
  title: 40,
  label: 40,
  links: 8,
});

export type ShopInfoProblem =
  | 'taglineVi'
  | 'taglineEn'
  | 'introVi'
  | 'introEn'
  | 'address'
  | 'hotline'
  | 'mapUrl'
  | 'facebookUrl'
  | 'zaloContact'
  | 'hoursBranchId'
  | 'heroMediaId'
  | 'facts'
  | 'featuredGroups'
  | 'whyTitleVi'
  | 'whyTitleEn'
  | 'whyCards'
  | 'footerBlocks';

export const SHOP_INFO_PROBLEMS: ReadonlySet<string> = new Set<ShopInfoProblem>([
  'taglineVi',
  'taglineEn',
  'introVi',
  'introEn',
  'address',
  'hotline',
  'mapUrl',
  'facebookUrl',
  'zaloContact',
  'hoursBranchId',
  'heroMediaId',
  'facts',
  'featuredGroups',
  'whyTitleVi',
  'whyTitleEn',
  'whyCards',
  'footerBlocks',
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
  /** Optional Facebook page link (also gives Messenger); empty = no icon and no Messenger button. */
  facebookUrl: string;
  /** Optional Zalo number or zalo.me link; empty = no icon and no Zalo button. */
  zaloContact: string;
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
  /** The blocks under the footer logo, in order; none until the Owner adds some. */
  footerBlocks: WebsiteFooterBlock[];
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
    facebookUrl: info.facebookUrl ?? '',
    zaloContact: info.zaloContact ?? '',
    hoursBranchId: info.hoursBranchId ?? '',
    heroMediaId: info.heroMediaId ?? '',
    factsVisible: info.factsVisible,
    facts: info.facts.map((fact) => ({ ...fact })),
    featuredGroups: info.featuredGroups.map((group) => ({ ...group })),
    whyVisible: info.whyVisible,
    whyTitleVi: info.whyTitleVi ?? '',
    whyTitleEn: info.whyTitleEn ?? '',
    whyCards: info.whyCards.map((card) => ({ ...card })),
    // A deep copy: a block holds nested lists (links, networks) the editor must not change in place.
    footerBlocks: JSON.parse(JSON.stringify(info.footerBlocks)) as WebsiteFooterBlock[],
  };
}

const clean = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const length = (value: string) => [...value].length;
/** A paragraph keeps the line breaks the Owner typed (at most one blank line in a row). */
const cleanParagraph = (value: string) =>
  value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** A store or social address: https with a host, nothing else. */
export const isHttpsLink = (value: string): boolean =>
  length(value) <= FOOTER_LIMITS.url &&
  /^https:\/\/[^\s<>"'\\/]\S*$/.test(value) &&
  !/[<>"'\\]/.test(value);
/** A link-list or image address: https, or an internal path of a language (`/vi/services`, `/{locale}/services`). */
export const isSiteLink = (value: string): boolean =>
  isHttpsLink(value) ||
  (length(value) <= FOOTER_LIMITS.url && /^\/(vi|en|\{locale\})(\/[^\s<>"'\\]*)?$/.test(value));

/** A block's own id: the API wants a UUID, and the form is where it is made. */
export const newBlockId = (): string => crypto.randomUUID();

const emptyUrls = (): Record<FooterSocialNetwork, string | null> =>
  Object.fromEntries(FOOTER_SOCIAL_NETWORKS.map((network) => [network, null])) as Record<
    FooterSocialNetwork,
    string | null
  >;

/** A new, empty block of a type, visible; the Owner fills it in the dialog before it is kept. */
export function newFooterBlock(type: FooterBlockType): WebsiteFooterBlock {
  const base = { id: newBlockId(), visible: true };
  switch (type) {
    case 'SOCIAL':
      return { ...base, type, urls: emptyUrls() };
    case 'APP':
      return { ...base, type, googlePlayUrl: null, appStoreUrl: null };
    case 'TEXT':
      return { ...base, type, textVi: '', textEn: '' };
    case 'LINKS':
      return {
        ...base,
        type,
        titleVi: null,
        titleEn: null,
        items: [{ labelVi: '', labelEn: '', url: '' }],
      };
    case 'IMAGE':
      return { ...base, type, mediaId: '', linkUrl: null };
    case 'SLOGAN':
      return { ...base, type };
  }
}

/** The text of an optional address field: trimmed, '' is none; null when what was typed is not allowed. */
function optionalLink(
  value: string | null,
  valid: (url: string) => boolean,
): string | null | false {
  const text = clean(value ?? '');
  if (text === '') return null;
  return valid(text) ? text : false;
}

/**
 * A block as it will be saved (text cleaned, empty addresses none), or null when the API would refuse it. The dialog
 * uses this to enable "Save", the form uses it again for the whole list.
 */
export function footerBlockOf(block: WebsiteFooterBlock): WebsiteFooterBlock | null {
  const base = { id: block.id, visible: block.visible };
  switch (block.type) {
    case 'SOCIAL': {
      const urls = emptyUrls();
      for (const network of FOOTER_SOCIAL_NETWORKS) {
        const link = optionalLink(block.urls[network], isHttpsLink);
        if (link === false) return null;
        urls[network] = link;
      }
      return FOOTER_SOCIAL_NETWORKS.some((network) => urls[network] !== null)
        ? { ...base, type: 'SOCIAL', urls }
        : null;
    }
    case 'APP': {
      const googlePlayUrl = optionalLink(block.googlePlayUrl, isHttpsLink);
      const appStoreUrl = optionalLink(block.appStoreUrl, isHttpsLink);
      if (googlePlayUrl === false || appStoreUrl === false) return null;
      return googlePlayUrl !== null || appStoreUrl !== null
        ? { ...base, type: 'APP', googlePlayUrl, appStoreUrl }
        : null;
    }
    case 'TEXT': {
      const textVi = cleanParagraph(block.textVi);
      const textEn = cleanParagraph(block.textEn);
      if (
        textVi === '' ||
        textEn === '' ||
        length(textVi) > FOOTER_LIMITS.text ||
        length(textEn) > FOOTER_LIMITS.text
      ) {
        return null;
      }
      return { ...base, type: 'TEXT', textVi, textEn };
    }
    case 'LINKS': {
      const titleVi = clean(block.titleVi ?? '');
      const titleEn = clean(block.titleEn ?? '');
      // A title in one language only would show nothing (or the wrong language) to half the visitors.
      if ((titleVi === '') !== (titleEn === '')) return null;
      if (length(titleVi) > FOOTER_LIMITS.title || length(titleEn) > FOOTER_LIMITS.title) {
        return null;
      }
      if (block.items.length < 1 || block.items.length > FOOTER_LIMITS.links) return null;
      const items: WebsiteFooterLink[] = [];
      for (const item of block.items) {
        const labelVi = clean(item.labelVi);
        const labelEn = clean(item.labelEn);
        const url = clean(item.url);
        if (
          labelVi === '' ||
          labelEn === '' ||
          length(labelVi) > FOOTER_LIMITS.label ||
          length(labelEn) > FOOTER_LIMITS.label ||
          !isSiteLink(url)
        ) {
          return null;
        }
        items.push({ labelVi, labelEn, url });
      }
      return {
        ...base,
        type: 'LINKS',
        titleVi: titleVi === '' ? null : titleVi,
        titleEn: titleEn === '' ? null : titleEn,
        items,
      };
    }
    case 'IMAGE': {
      const linkUrl = optionalLink(block.linkUrl, isSiteLink);
      if (block.mediaId === '' || linkUrl === false) return null;
      return { ...base, type: 'IMAGE', mediaId: block.mediaId, linkUrl };
    }
    case 'SLOGAN':
      return { ...base, type: 'SLOGAN' };
  }
}

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
  const facebookUrl = clean(form.facebookUrl);
  const zaloContact = clean(form.zaloContact);
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
  if (facebookUrl !== '' && facebookPageLinks(facebookUrl) === null) {
    return { problem: 'facebookUrl' };
  }
  if (zaloContact !== '' && zaloLink(zaloContact) === null) return { problem: 'zaloContact' };
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
  if (form.footerBlocks.length > FOOTER_LIMITS.blocks) return { problem: 'footerBlocks' };
  const footerBlocks: WebsiteFooterBlock[] = [];
  for (const block of form.footerBlocks) {
    const cleaned = footerBlockOf(block);
    if (cleaned === null) return { problem: 'footerBlocks' };
    footerBlocks.push(cleaned);
  }
  return {
    body: {
      taglineVi,
      taglineEn,
      introVi: introVi === '' ? null : introVi,
      introEn: introEn === '' ? null : introEn,
      address,
      hotline,
      mapUrl: mapUrl === '' ? null : mapUrl,
      facebookUrl: facebookUrl === '' ? null : facebookUrl,
      zaloContact: zaloContact === '' ? null : zaloContact,
      hoursBranchId: form.hoursBranchId === '' ? null : form.hoursBranchId,
      heroMediaId: form.heroMediaId === '' ? null : form.heroMediaId,
      factsVisible: form.factsVisible,
      facts,
      featuredGroups,
      whyVisible: form.whyVisible,
      whyTitleVi: whyTitleVi === '' ? null : whyTitleVi,
      whyTitleEn: whyTitleEn === '' ? null : whyTitleEn,
      whyCards,
      footerBlocks,
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
    facebookUrl: clean(form.facebookUrl),
    zaloContact: clean(form.zaloContact),
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
    footerBlocks: form.footerBlocks,
  });
  return JSON.stringify(text(a)) !== JSON.stringify(text(b));
}

/** The API names the field it refused; anything else is a general message. */
export function shopInfoServerProblem(error: unknown): ShopInfoProblem | null {
  const failure = error as { code?: unknown; field?: unknown } | null;
  if (!failure || (failure.code !== 'VALIDATION_FAILED' && failure.code !== 'MEDIA_ALT_REQUIRED')) {
    return null;
  }
  if (failure.code === 'MEDIA_ALT_REQUIRED') {
    // A picture without alt text: the hero image, or one a footer block uses (the API names which).
    return failure.field === 'footerBlocks' ? 'footerBlocks' : 'heroMediaId';
  }
  return typeof failure.field === 'string' && SHOP_INFO_PROBLEMS.has(failure.field)
    ? (failure.field as ShopInfoProblem)
    : null;
}
