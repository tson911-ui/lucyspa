import { Band, PublicMain, Skeleton } from '@lucy-spa/ui';

/**
 * Shown while the home page reads its data: the shape of the page, no text to translate, nothing announced twice. The
 * header already floats over the hero here, so the hero is its full-bleed shape (the brand panel) and not a pale band.
 */
export default function Loading() {
  return (
    <PublicMain>
      <section className="ls-hero-full" aria-hidden="true">
        <div className="ls-hero-stage">
          <div className="ls-brand-panel" />
        </div>
      </section>
      <Band tone="page">
        <div aria-busy="true">
          <Skeleton lines={1} height="var(--ls-space-9)" width="60%" />
          <Skeleton lines={2} height="var(--ls-space-5)" width="80%" />
          <div className="ls-site-grid ls-site-grid-groups">
            {[0, 1, 2].map((index) => (
              <div key={index} className="ls-site-card">
                <Skeleton lines={4} height="var(--ls-space-5)" />
              </div>
            ))}
          </div>
        </div>
      </Band>
    </PublicMain>
  );
}
