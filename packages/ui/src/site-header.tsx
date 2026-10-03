'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The sticky site header: brand at the start, the main menu, then tools (language, theme, account) and the call
 * to action. A 1 px sentinel at the top of the page tells it when the page has scrolled, which adds the shadow
 * (pattern M4) without a scroll listener.
 */
export function SiteHeader({
  brand,
  nav,
  tools,
  cta,
}: {
  brand: ReactNode;
  nav: ReactNode;
  tools: ReactNode;
  cta?: ReactNode;
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
  return (
    <>
      <div ref={sentinel} className="ls-site-sentinel" aria-hidden="true" />
      <header className="ls-site-header" data-scrolled={scrolled ? 'true' : undefined}>
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
