/**
 * Contact links of the shop profile (Owner request 2026-10-06): the Facebook page and the Zalo number or link the Owner
 * types in Shop info, turned into the links the public site opens (Facebook page, Messenger `m.me`, Zalo `zalo.me`).
 * One pure source for the API (which refuses a bad value) and the site (which draws only a link that passes), so the two
 * never disagree. No network call: only the shape of the text is checked.
 */

export const CONTACT_LINK_MAX = 300;

export interface FacebookPageLinks {
  /** `https://www.facebook.com/<page>` (or `profile.php?id=<id>`), for the footer icon. */
  pageUrl: string;
  /** `https://m.me/<page or id>`, for the Messenger button. */
  messengerUrl: string;
}

const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'mbasic.facebook.com',
  'fb.com',
  'www.fb.com',
]);

/** First path segments that are Facebook features, never a page name. */
const FACEBOOK_RESERVED = new Set([
  'sharer',
  'sharer.php',
  'share',
  'share.php',
  'dialog',
  'plugins',
  'login',
  'login.php',
  'groups',
  'events',
  'watch',
  'marketplace',
  'gaming',
  'reel',
  'reels',
  'photo',
  'photo.php',
  'permalink.php',
  'story.php',
  'hashtag',
  'policies',
  'help',
  'l.php',
  'tr',
  'public',
  'search',
  'stories',
  'video',
  'videos',
  'posts',
  'notes',
]);

const PAGE_NAME = /^[A-Za-z0-9.-]{5,80}$/;
const NUMERIC_ID = /^\d{5,20}$/;

function parseHttps(text: string): URL | null {
  if (!/^https:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== ''
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * A Facebook page link: `https://www.facebook.com/<page>`, `.../<Name>-<id>`, `.../pages/<Name>/<id>`,
 * `.../people/<Name>/<id>` or `.../profile.php?id=<id>` (also `m.`, `web.`, `fb.com`). Anything else (a post, a group, a
 * share link, another site) is refused with `null`.
 */
export function facebookPageLinks(input: string): FacebookPageLinks | null {
  const text = input.trim();
  if (text.length === 0 || text.length > CONTACT_LINK_MAX) return null;
  const url = parseHttps(text);
  if (!url || !FACEBOOK_HOSTS.has(url.hostname.toLowerCase())) return null;
  const segments = url.pathname.split('/').filter((part) => part !== '');
  const first = segments[0];
  if (first === undefined) return null;
  const lower = first.toLowerCase();

  let target: string | null = null;
  if (lower === 'profile.php') {
    const id = url.searchParams.get('id') ?? '';
    if (NUMERIC_ID.test(id) && segments.length === 1) target = id;
  } else if (lower === 'pages' || lower === 'people') {
    const last = segments[segments.length - 1] ?? '';
    if (segments.length >= 3 && NUMERIC_ID.test(last)) target = last;
  } else if (!FACEBOOK_RESERVED.has(lower) && segments.length <= 2 && PAGE_NAME.test(first)) {
    // "Lucy-Spa-100063123456789" is a page with its numeric id appended: the id is the stable handle.
    const suffix = /-(\d{8,20})$/.exec(first)?.[1];
    target = suffix ?? first;
    // A second segment is only ever a page tab ("/posts"), never part of the handle.
    if (segments.length === 2 && !/^[a-z_]{3,20}$/.test(segments[1] ?? '')) target = null;
  }
  if (target === null) return null;
  const pageUrl = NUMERIC_ID.test(target)
    ? `https://www.facebook.com/profile.php?id=${target}`
    : `https://www.facebook.com/${target}`;
  return { pageUrl, messengerUrl: `https://m.me/${target}` };
}

/**
 * A Zalo number (`0934 936 101`, `+84 934 936 101`) or a `https://zalo.me/...` link, as the link the site opens
 * (`https://zalo.me/<number or name>`); `null` for anything else.
 */
export function zaloLink(input: string): string | null {
  const text = input.trim();
  if (text.length === 0 || text.length > CONTACT_LINK_MAX) return null;
  if (/^https:\/\//i.test(text)) {
    const url = parseHttps(text);
    if (!url || !['zalo.me', 'www.zalo.me'].includes(url.hostname.toLowerCase())) return null;
    const path = url.pathname.replace(/\/+$/, '');
    return /^\/[A-Za-z0-9._-]{1,64}(\/[A-Za-z0-9._-]{1,64})?$/.test(path)
      ? `https://zalo.me${path}`
      : null;
  }
  if (!/^\+?[0-9().\s-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return null;
  // zalo.me opens a chat by the national number as Vietnamese users know it (0...) or by the international digits (84...).
  return `https://zalo.me/${digits}`;
}
