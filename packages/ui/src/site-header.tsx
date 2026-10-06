'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The sticky site header of every public and member page: brand and main menu at the start, then tools (language, theme,
 * account) and the call to action. A sentinel at the top of the page tells it when the page has scrolled, so no scroll
 * listener runs. At the top the bar is the page itself (no background, hairline or shadow); after about 48 px it shrinks
 * and becomes frosted glass (site.css). The bar keeps its height and its place in the flow, so nothing moves.
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
          <div className="ls-site-lead">
            <div className="ls-site-brand">{brand}</div>
            {nav}
          </div>
          <div className="ls-site-tools">{tools}</div>
          {cta ? <div className="ls-site-cta">{cta}</div> : null}
        </div>
      </header>
    </>
  );
}
