import {
  FOOTER_BLOCK_TYPES,
  FOOTER_SOCIAL_NETWORKS,
  type FooterBlockType,
  type FooterSocialNetwork,
  type PublicFooterBlock,
  type PublicSiteImage,
  type WebsiteFooterBlock,
  type WebsiteFooterLink,
} from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { pick, textField, UUID, validPopupUrl, type PublicLocale } from './popup.core.js';

/**
 * The blocks under the footer logo (Owner request 2026-10-04): social icons, app badges, text, a link list, an image and
 * the slogan. They live as JSON on the one-row shop profile, so one versioned save covers them, like the other lists.
 * A request is checked strictly (the first problem is named `footerBlocks`); what is stored is read back tolerantly,
 * so a bad row can never break the public page. Nothing is seeded: `[]` shows only the logo.
 */
export const FOOTER_LIMITS = Object.freeze({
  blocks: 12,
  url: 300,
  text: 300,
  title: 40,
  label: 40,
  links: 8,
});

const TYPES: ReadonlySet<string> = new Set(FOOTER_BLOCK_TYPES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A store or social address: `https://` with a host and no credentials, nothing else. */
const httpsUrl = (value: string): boolean =>
  value.startsWith('https://') && [...value].length <= FOOTER_LIMITS.url && validPopupUrl(value);

/** A link-list or image address: `https://`, or an internal `/vi/...`, `/en/...` or `/{locale}/...` path (design 16.2). */
const linkUrl = (value: string): boolean =>
  [...value].length <= FOOTER_LIMITS.url && validPopupUrl(value);

/** An optional address: null or empty stays null; anything else must pass `valid`. */
function optionalUrl(
  value: unknown,
  valid: (url: string) => boolean,
  fail: () => never,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return fail();
  const text = value.trim();
  if (text === '') return null;
  return valid(text) ? text : fail();
}

function blocksOf(input: unknown, strict: boolean): WebsiteFooterBlock[] {
  const fail = (): never => {
    throw new AuthError('VALIDATION_FAILED', 'footerBlocks');
  };
  if (!Array.isArray(input)) return strict ? fail() : [];
  if (input.length > FOOTER_LIMITS.blocks) {
    if (strict) fail();
  }
  const seen = new Set<string>();
  const blocks: WebsiteFooterBlock[] = [];
  for (const item of input.slice(0, FOOTER_LIMITS.blocks)) {
    try {
      if (!isRecord(item) || typeof item['visible'] !== 'boolean') throw fail();
      const type = item['type'];
      if (typeof type !== 'string' || !TYPES.has(type)) throw fail();
      const id = typeof item['id'] === 'string' ? item['id'].toLowerCase() : '';
      if (!UUID.test(id) || seen.has(id)) throw fail();
      const base = { id, visible: item['visible'] };
      const block = blockOf(type as FooterBlockType, base, item, fail);
      seen.add(id);
      blocks.push(block);
    } catch (error) {
      if (strict) throw error;
    }
  }
  return blocks;
}

function blockOf(
  type: FooterBlockType,
  base: { id: string; visible: boolean },
  item: Record<string, unknown>,
  fail: () => never,
): WebsiteFooterBlock {
  switch (type) {
    case 'SOCIAL': {
      const raw = isRecord(item['urls']) ? item['urls'] : fail();
      const urls = {} as Record<FooterSocialNetwork, string | null>;
      for (const network of FOOTER_SOCIAL_NETWORKS) {
        urls[network] = optionalUrl(raw[network], httpsUrl, fail);
      }
      if (FOOTER_SOCIAL_NETWORKS.every((network) => urls[network] === null)) fail();
      return { ...base, type, urls };
    }
    case 'APP': {
      const googlePlayUrl = optionalUrl(item['googlePlayUrl'], httpsUrl, fail);
      const appStoreUrl = optionalUrl(item['appStoreUrl'], httpsUrl, fail);
      if (googlePlayUrl === null && appStoreUrl === null) fail();
      return { ...base, type, googlePlayUrl, appStoreUrl };
    }
    case 'TEXT': {
      const textVi = textField(item['textVi'], 'footerBlocks', FOOTER_LIMITS.text, true);
      const textEn = textField(item['textEn'], 'footerBlocks', FOOTER_LIMITS.text, true);
      if (textVi === null || textEn === null) fail();
      return { ...base, type, textVi: textVi ?? '', textEn: textEn ?? '' };
    }
    case 'LINKS': {
      const titleVi = textField(item['titleVi'], 'footerBlocks', FOOTER_LIMITS.title);
      const titleEn = textField(item['titleEn'], 'footerBlocks', FOOTER_LIMITS.title);
      // A title in one language only would show nothing (or the wrong language) to half the visitors.
      if ((titleVi === null) !== (titleEn === null)) fail();
      const rawItems = Array.isArray(item['items']) ? item['items'] : fail();
      if (rawItems.length < 1 || rawItems.length > FOOTER_LIMITS.links) fail();
      const items: WebsiteFooterLink[] = rawItems.map((entry: unknown) => {
        if (!isRecord(entry)) return fail();
        const labelVi = textField(entry['labelVi'], 'footerBlocks', FOOTER_LIMITS.label);
        const labelEn = textField(entry['labelEn'], 'footerBlocks', FOOTER_LIMITS.label);
        const url = optionalUrl(entry['url'], linkUrl, fail);
        if (labelVi === null || labelEn === null || url === null) return fail();
        return { labelVi, labelEn, url };
      });
      return { ...base, type, titleVi, titleEn, items };
    }
    case 'IMAGE': {
      const mediaId = typeof item['mediaId'] === 'string' ? item['mediaId'].toLowerCase() : '';
      if (!UUID.test(mediaId)) fail();
      return { ...base, type, mediaId, linkUrl: optionalUrl(item['linkUrl'], linkUrl, fail) };
    }
    case 'SLOGAN':
      return { ...base, type };
  }
}

/** A request's blocks: strict. */
export const parseFooterBlocks = (raw: unknown): WebsiteFooterBlock[] => blocksOf(raw, true);
/** The stored blocks: tolerant (a bad entry is left out; `[]` is the default). */
export const readFooterBlocks = (stored: unknown): WebsiteFooterBlock[] => blocksOf(stored, false);

/** The media assets the image blocks use (each once), for the usability check and the public image lookup. */
export const footerMediaIds = (blocks: readonly WebsiteFooterBlock[]): string[] => [
  ...new Set(blocks.flatMap((block) => (block.type === 'IMAGE' ? [block.mediaId] : []))),
];

/** `/{locale}/services` becomes `/vi/services`; an https address or a fixed-locale path stays as typed. */
const resolveUrl = (url: string, locale: PublicLocale): string =>
  url.replace(/^\/\{locale\}(?=\/|$)/, `/${locale}`);

/**
 * What a visitor gets: visible blocks that are complete, in the Owner's order and in the visitor's language. A block
 * that would draw nothing is left out (a social block with no link, an image that is gone, a slogan with no text).
 * `images` holds the public sources of the image blocks' media (a missing one drops its block).
 */
export function publicFooterBlocks(
  blocks: readonly WebsiteFooterBlock[],
  locale: PublicLocale,
  slogan: string | null,
  images: ReadonlyMap<string, PublicSiteImage>,
): PublicFooterBlock[] {
  const result: PublicFooterBlock[] = [];
  for (const block of blocks) {
    if (!block.visible) continue;
    switch (block.type) {
      case 'SOCIAL': {
        const links = FOOTER_SOCIAL_NETWORKS.flatMap((network) => {
          const url = block.urls[network];
          return url === null ? [] : [{ network, url }];
        });
        if (links.length > 0) result.push({ id: block.id, type: 'SOCIAL', links });
        break;
      }
      case 'APP':
        if (block.googlePlayUrl !== null || block.appStoreUrl !== null) {
          result.push({
            id: block.id,
            type: 'APP',
            googlePlayUrl: block.googlePlayUrl,
            appStoreUrl: block.appStoreUrl,
          });
        }
        break;
      case 'TEXT': {
        const text = locale === 'vi' ? block.textVi : block.textEn;
        if (text !== '') result.push({ id: block.id, type: 'TEXT', text });
        break;
      }
      case 'LINKS': {
        const items = block.items.map((entry) => ({
          label: locale === 'vi' ? entry.labelVi : entry.labelEn,
          url: resolveUrl(entry.url, locale),
        }));
        if (items.length > 0) {
          result.push({
            id: block.id,
            type: 'LINKS',
            title: pick(block.titleVi, block.titleEn, locale),
            items,
          });
        }
        break;
      }
      case 'IMAGE': {
        const image = images.get(block.mediaId);
        if (image) {
          result.push({
            id: block.id,
            type: 'IMAGE',
            image,
            linkUrl: block.linkUrl === null ? null : resolveUrl(block.linkUrl, locale),
          });
        }
        break;
      }
      case 'SLOGAN':
        if (slogan !== null && slogan !== '') {
          result.push({ id: block.id, type: 'SLOGAN', text: slogan });
        }
        break;
    }
  }
  return result;
}
