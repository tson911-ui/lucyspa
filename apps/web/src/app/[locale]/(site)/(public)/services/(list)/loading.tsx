import { Band, PublicMain, Skeleton } from '@lucy-spa/ui';

/** Shown while a public page reads its data: the shape of the page, no text to translate, nothing announced twice. */
export default function Loading() {
  return (
    <PublicMain>
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
