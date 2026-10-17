/**
 * An image address that is safe to put in `src` or a CSS `url()`: a same-origin absolute path made of plain URL
 * characters. Anything else (a scheme, a host, a quote, a parenthesis, a backslash) is dropped, so a bad value draws
 * the kit's own art instead of a request. A tiny pure module, so the particle layer can use it without loading the
 * season art (rbp bundle-conditional).
 */
export function safeImageUrl(value: string | null | undefined): string | undefined {
  return typeof value === 'string' &&
    /^\/[A-Za-z0-9/_\-.%]+$/.test(value) &&
    !value.startsWith('//')
    ? value
    : undefined;
}
