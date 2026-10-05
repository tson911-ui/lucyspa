'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The sticky site header: brand at the start, the main menu, then tools (language, theme, account) and the call
 * to action. A sentinel at the top of the page tells it when the page has scrolled, which adds the shadow
 * (pattern M4) without a scroll listener.
 *
 * `overlay` is for a page that starts with a full-bleed hero (the home page): the bar floats over the hero,
 * transparent with light text, and after about 60 px of scrolling it turns into the normal solid bar (site.css).
 * Nothing else changes, so a page without a hero keeps the plain header.
 */
export function SiteHeader({
  brand,
  nav,
  tools,
  cta,
  overlay = false,
}: {
  brand: ReactNode;
  nav: ReactNode;
  tools: ReactNode;
  cta?: ReactNode;
  overlay?: boolean;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const mode = overlay ? 'true' : undefined;
  return (
    <>
      <div ref={sentinel} className="ls-site-sentinel" data-overlay={mode} aria-hidden="true" />
      <header
        className="ls-site-header"
        data-overlay={mode}
        data-scrolled={scrolled ? 'true' : undefined}
      >
        <div className="ls-container ls-site-header-row">
          <div className="ls-site-brand">{brand}</div>
          {nav}
          <div className="ls-site-tools">{tools}</div>
          {cta ? <div className="ls-site-cta">{cta}</div> : null}
        </div>
      </header>
    </>
  );
}
