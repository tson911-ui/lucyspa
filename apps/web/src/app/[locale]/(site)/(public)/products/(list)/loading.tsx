import { Band, PublicMain, Skeleton } from '@lucy-spa/ui';

/** Shown while the list reads its data: the shape of the page (title, a row of cards), no text to translate, nothing announced twice. */
export default function Loading() {
  return (
    <PublicMain>
      <Band tone="page">
        <div aria-busy="true">
          <Skeleton lines={1} height="var(--ls-space-9)" width="60%" />
          <div className="ls-prod-grid">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div key={index} className="ls-prod-card">
                <Skeleton lines={1} height="var(--ls-space-10)" />
                <div className="ls-prod-body">
                  <Skeleton lines={3} height="var(--ls-space-4)" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Band>
    </PublicMain>
  );
}
