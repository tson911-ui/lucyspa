import { Band, PublicMain, Skeleton } from '@lucy-spa/ui';

/**
 * Shown while the list reads its data: the shape of the page (the title band, then a grid of cards: the picture on its step and quiet bars
 * for the words), no text to translate, nothing announced twice.
 */
export default function Loading() {
  return (
    <PublicMain>
      <Band tone="page" className="ls-band--alt ls-prod-title">
        <div aria-busy="true">
          <Skeleton lines={1} height="var(--ls-space-9)" width="40%" />
          <Skeleton lines={1} height="var(--ls-space-5)" width="60%" />
        </div>
      </Band>
      <Band tone="page" className="ls-band--base ls-prod-list">
        <div aria-busy="true">
          <ul className="ls-prod-grid" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
              <li key={index}>
                <div className="ls-pcard">
                  <div className="ls-pcard-media" />
                  <div className="ls-pcard-body">
                    <span className="ls-pcard-meta ls-skel">&nbsp;</span>
                    <span className="ls-pcard-name ls-skel ls-skel-name">&nbsp;</span>
                    <span className="ls-skel ls-skel-price">&nbsp;</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Band>
    </PublicMain>
  );
}
