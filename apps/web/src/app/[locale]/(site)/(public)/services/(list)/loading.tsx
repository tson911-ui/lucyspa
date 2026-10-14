import { Band, PublicMain, Skeleton } from '@lucy-spa/ui';

/**
 * Shown while the service list reads its data: the shape of the page (the title band, the chips row, then a band of cards), no text to
 * translate, nothing announced twice.
 */
export default function Loading() {
  return (
    <PublicMain>
      <Band tone="page" className="ls-band--alt ls-svc-title">
        <div aria-busy="true">
          <Skeleton lines={1} height="var(--ls-space-9)" width="40%" />
          <Skeleton lines={1} height="var(--ls-space-5)" width="60%" />
        </div>
      </Band>
      <Band tone="page" className="ls-band--base">
        <div className="ls-svc-grid" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div key={index}>
              <Skeleton lines={5} height="var(--ls-space-5)" />
            </div>
          ))}
        </div>
      </Band>
    </PublicMain>
  );
}
