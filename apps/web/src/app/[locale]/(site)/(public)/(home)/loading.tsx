import { Band, PublicMain, Skeleton } from '@lucy-spa/ui';

/**
 * Shown while the home page reads its data: the shape of the page (the hero on the alternate band, then the trust band and the split
 * intro), no text to translate, nothing announced twice. The hero keeps its height, so nothing moves when the page arrives.
 */
export default function Loading() {
  return (
    <PublicMain>
      <section className="ls-home-hero" data-media="flat" aria-busy="true">
        <div className="ls-container ls-home-hero-inner">
          <div className="ls-home-hero-copy">
            <Skeleton lines={2} height="var(--ls-space-9)" width="60%" />
            <Skeleton lines={2} height="var(--ls-space-5)" width="80%" />
          </div>
          {/* The frame the hero photo (or its placeholder) takes, so nothing moves when the page arrives. */}
          <div className="ls-slot ls-home-hero-slot" data-empty="true" aria-hidden="true" />
        </div>
      </section>
      <Band tone="page">
        <div aria-busy="true">
          <Skeleton lines={3} height="var(--ls-space-7)" />
        </div>
      </Band>
    </PublicMain>
  );
}
