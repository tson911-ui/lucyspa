/**
 * The one link rule of the website (popup button, footer and map links, links inside page text). It lives in its own module so the
 * customer pages that only check a link do not carry the page-text parser with them.
 */

const INTERNAL_URL = /^\/(vi|en|\{locale\})(\/[^\s<>"'\\]*)?$/;
const MAILTO = /^mailto:[^\s<>"'\\@:?#]+@[^\s<>"'\\@:?#]+\.[^\s<>"'\\@:?#]+$/;
const TEL = /^tel:\+?[0-9]{6,15}$/;
const ANCHOR = /^#[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The link rule of design 16.2: an internal `/vi/...`, `/en/...` or `/{locale}/...` path, or an `https://` URL with a host and
 * no credentials. Never `javascript:`, `data:`, `http:` or a protocol-relative `//host`. The popup's button and the shop's map
 * and footer links use exactly this.
 */
export function isWebsiteLink(value: string, max = 500): boolean {
  if ([...value].length > max) return false;
  if (INTERNAL_URL.test(value)) return true;
  if (!/^https:\/\/[^\s<>"'\\/]/.test(value) || /[\s<>"'\\]/.test(value)) return false;
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === 'https:' && url.username === '' && url.password === '' && url.hostname !== ''
  );
}

/** A link inside page text: the website link rule, plus `mailto:`, `tel:` and an anchor to a heading of the same page. */
export function isRichTextLink(value: string): boolean {
  return isWebsiteLink(value) || MAILTO.test(value) || TEL.test(value) || ANCHOR.test(value);
}
