import Link from 'next/link';
import { buttonClass, Band, PublicMain } from '@lucy-spa/ui';
import { getDictionary } from '../../i18n/dictionaries';
import type { Locale } from '../../i18n/locales';
import { HomeSlider } from './home-slider';
import { PromoPopup } from './promo-popup';

/**
 * The public home page's content. The page and the admin's season preview draw it the same way; the preview leaves
 * the promotional popup out (it is not part of a season's look and would cover the page).
 */
export function HomeContent({ locale, popup = true }: { locale: Locale; popup?: boolean }) {
  const dictionary = getDictionary(locale);
  return (
    <PublicMain>
      <Band tone="page" labelledBy="home-title" className="ls-hero">
        <div className="ls-hero-grid">
          <div className="ls-hero-copy">
            <p className="ls-eyebrow">{dictionary.eyebrow}</p>
            <h1 className="ls-site-display" id="home-title">
              {dictionary.heading}
            </h1>
            <p className="ls-lead">{dictionary.introduction}</p>
            <div className="ls-hero-actions">
              <Link className={buttonClass('primary', 'lg')} href={`/${locale}/account/book`}>
                {dictionary.book}
              </Link>
              <Link className={buttonClass('secondary', 'lg')} href={`/${locale}/account/login`}>
                {dictionary.signIn}
              </Link>
            </div>
          </div>
          <HomeSlider
            locale={locale}
            fallback={
              <div className="ls-brand-panel" aria-hidden="true">
                <span className="ls-brand-panel-mark">Lucy Spa</span>
              </div>
            }
          />
        </div>
      </Band>
      {popup ? <PromoPopup locale={locale} /> : null}
    </PublicMain>
  );
}
