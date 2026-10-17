'use client';

import type { PublicProductCard } from '@lucy-spa/contracts';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../../i18n/locales';

/**
 * What stands in the row until it is loaded (and for a visitor without scripts): the same grid of cards with the picture on the sunken
 * step and quiet bars for the words, so the page does not jump when the real row arrives. Drawn on the server too.
 */
function ProductRowSkeleton({ count }: { count: number }) {
  return (
    <div className="ls-snap-row" aria-hidden="true">
      <ul className="ls-snap-track">
        {Array.from({ length: Math.min(count, 6) }, (_, index) => (
          <li key={index} className="ls-snap-item">
            <div className="ls-pcard">
              <div className="ls-pcard-media" />
              <div className="ls-pcard-body">
                <span className="ls-pcard-name ls-skel ls-skel-name">&nbsp;</span>
                <span className="ls-skel ls-skel-price">&nbsp;</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The row's code (ScrollRow, the cards, the price blocks) is its own chunk: it is fetched only when the row is about to be seen.
const HomeProductRow = dynamic(() => import('./home-product-row').then((m) => m.HomeProductRow), {
  ssr: false,
  loading: () => <ProductRowSkeleton count={4} />,
});

/** How long after the first paint the row loads even when it has not come near the screen. */
const IDLE_LOAD_MS = 2000;

/** How far below the screen the row starts loading, so it is ready before the visitor scrolls to it. */
const LOAD_MARGIN = '600px 0px';

/**
 * The home page's product row, loaded after the first paint (redesign group 1, C11b; Owner decision). The page ships only this small
 * shell; when the row is within 600 px of the screen (or at once when the browser cannot observe that) its code is fetched and the cards
 * replace the skeleton.
 */
export function LazyProductRow({
  locale,
  cards,
  label,
}: {
  locale: Locale;
  cards: readonly PublicProductCard[];
  label: string;
}) {
  const slot = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    // The row also loads a moment after the first paint, so a visitor who jumps down the page (an anchor, the End key) finds it ready too.
    const timer = window.setTimeout(() => setNear(true), IDLE_LOAD_MS);
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: LOAD_MARGIN },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={slot} className="ls-pcard-lazy">
      {near ? (
        <HomeProductRow locale={locale} cards={cards} label={label} />
      ) : (
        <ProductRowSkeleton count={cards.length} />
      )}
    </div>
  );
}
