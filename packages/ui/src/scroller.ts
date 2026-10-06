/**
 * The customer pages below 1024 px are an app shell: the page scrolls inside one element (`.ls-site-scroll`, marked
 * `data-ls-scroll`) and the document never scrolls (site.css). From 1024 px that element is `display: contents` and the
 * document scrolls as usual. Everything that reads or listens to the page scroll goes through these helpers, so it follows
 * whichever of the two is the scroller right now.
 */
export const SCROLLER_SELECTOR = '[data-ls-scroll]';

/** The element that scrolls the page at this moment, or null when the document does (desktop, admin pages). */
export function findScroller(from?: Element | null): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const element =
    (from?.closest?.(SCROLLER_SELECTOR) as HTMLElement | null | undefined) ??
    document.querySelector<HTMLElement>(SCROLLER_SELECTOR);
  if (!element) return null;
  const overflow = getComputedStyle(element).overflowY;
  return overflow === 'auto' || overflow === 'scroll' ? element : null;
}

/** How far the page is scrolled, in px. */
export function scrollPosition(scroller: HTMLElement | null = findScroller()): number {
  return scroller ? scroller.scrollTop : window.scrollY;
}

/**
 * Calls `listener` on every scroll of the page, whichever element scrolls it (the scroller below 1024 px, the window above;
 * the page can change from one to the other when the window is resized). Returns the cleanup.
 */
export function onPageScroll(listener: () => void): () => void {
  const scroller = document.querySelector<HTMLElement>(SCROLLER_SELECTOR);
  window.addEventListener('scroll', listener, { passive: true });
  scroller?.addEventListener('scroll', listener, { passive: true });
  return () => {
    window.removeEventListener('scroll', listener);
    scroller?.removeEventListener('scroll', listener);
  };
}
