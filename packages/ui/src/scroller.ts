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

// The page scroller, resolved once and kept until the layout can have changed it: a resize (the 1024 px switch) or a route
// change. Scroll handlers never query the DOM or read computed style (rbp js-batch-dom-css).
let cached: HTMLElement | null | undefined;

/** `findScroller()`, cached between resizes and route changes; use it in anything that runs per scroll or per frame. */
export function currentScroller(): HTMLElement | null {
  if (cached === undefined || (cached !== null && !cached.isConnected)) cached = findScroller();
  return cached;
}

/** How far the page is scrolled, in px. */
export function scrollPosition(scroller: HTMLElement | null = currentScroller()): number {
  return scroller ? scroller.scrollTop : window.scrollY;
}

// One page-scroll store for every subscriber (rbp client-event-listeners): one passive capture listener on the window sees the
// document's scroll and the scroller's (scroll events do not bubble, but they pass the window in the capture phase), one frame
// per burst of events, one position read per frame.
type PageScrollListener = (position: number) => void;
const listeners = new Set<PageScrollListener>();
let frame = 0;

function isPageScroll(target: EventTarget | null): boolean {
  if (target === window || target === document) return true;
  return (target as Element | null)?.matches?.(SCROLLER_SELECTOR) === true;
}

function flush() {
  frame = 0;
  const position = scrollPosition();
  for (const listener of listeners) listener(position);
}

function onScroll(event: Event) {
  if (frame !== 0 || !isPageScroll(event.target)) return;
  frame = requestAnimationFrame(flush);
}

function forget() {
  cached = undefined;
}

const CAPTURE = { capture: true, passive: true } as const;

/**
 * Calls `listener` with the page's scroll position once per frame while the page scrolls, whichever element scrolls it (the
 * scroller below 1024 px, the window above; the page can change from one to the other when the window is resized). Returns
 * the cleanup.
 */
export function onPageScroll(listener: PageScrollListener): () => void {
  if (listeners.size === 0) {
    window.addEventListener('scroll', onScroll, CAPTURE);
    window.addEventListener('resize', forget, { passive: true });
    window.addEventListener('ls:route', forget);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener('scroll', onScroll, CAPTURE);
    window.removeEventListener('resize', forget);
    window.removeEventListener('ls:route', forget);
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    cached = undefined;
  };
}
