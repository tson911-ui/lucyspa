import type {
  WebsiteShopInfoInput,
  WebsiteShopInfoResponse,
  WebsiteShopInfoUpdateRequest,
} from '@lucy-spa/contracts';

// The "Shop info" tab of the website content page (Part 2, P2-3): form state, the request and the client-side checks
// (the API decides every rule again and names the field it refused).
export const SHOP_INFO_LIMITS = Object.freeze({
  tagline: 120,
  address: 300,
  hotlineMax: 30,
  hotlineDigitsMin: 8,
  mapUrl: 500,
});

export type ShopInfoProblem =
  'taglineVi' | 'taglineEn' | 'address' | 'hotline' | 'mapUrl' | 'hoursBranchId' | 'heroMediaId';

export const SHOP_INFO_PROBLEMS: ReadonlySet<string> = new Set<ShopInfoProblem>([
  'taglineVi',
  'taglineEn',
  'address',
  'hotline',
  'mapUrl',
  'hoursBranchId',
  'heroMediaId',
]);

export interface ShopInfoForm {
  taglineVi: string;
  taglineEn: string;
  address: string;
  hotline: string;
  mapUrl: string;
  /** '' = the first active branch. */
  hoursBranchId: string;
  /** The chosen hero image's id, or '' for none. */
  heroMediaId: string;
}

export function formOfShopInfo(info: WebsiteShopInfoResponse): ShopInfoForm {
  return {
    taglineVi: info.taglineVi,
    taglineEn: info.taglineEn,
    address: info.address,
    hotline: info.hotline,
    mapUrl: info.mapUrl ?? '',
    hoursBranchId: info.hoursBranchId ?? '',
    heroMediaId: info.heroMediaId ?? '',
  };
}

const clean = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const length = (value: string) => [...value].length;

/** The request for the form, or the first field the API would refuse. */
export function shopInfoInputOf(
  form: ShopInfoForm,
): { body: WebsiteShopInfoInput } | { problem: ShopInfoProblem } {
  const taglineVi = clean(form.taglineVi);
  const taglineEn = clean(form.taglineEn);
  const address = clean(form.address);
  const hotline = clean(form.hotline);
  const mapUrl = clean(form.mapUrl);
  if (taglineVi === '' || length(taglineVi) > SHOP_INFO_LIMITS.tagline) {
    return { problem: 'taglineVi' };
  }
  if (taglineEn === '' || length(taglineEn) > SHOP_INFO_LIMITS.tagline) {
    return { problem: 'taglineEn' };
  }
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
  return {
    body: {
      taglineVi,
      taglineEn,
      address,
      hotline,
      mapUrl: mapUrl === '' ? null : mapUrl,
      hoursBranchId: form.hoursBranchId === '' ? null : form.hoursBranchId,
      heroMediaId: form.heroMediaId === '' ? null : form.heroMediaId,
    },
  };
}

export const shopInfoRequest = (
  body: WebsiteShopInfoInput,
  expectedVersion: number,
): WebsiteShopInfoUpdateRequest => ({ ...body, expectedVersion });

export function shopInfoChanged(a: ShopInfoForm, b: ShopInfoForm): boolean {
  return (Object.keys(a) as (keyof ShopInfoForm)[]).some((key) => clean(a[key]) !== clean(b[key]));
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
