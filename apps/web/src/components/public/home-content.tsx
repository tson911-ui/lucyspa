import Link from 'next/link';
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
    <main className="welcome" id="main-content" tabIndex={-1}>
      <HomeSlider locale={locale} />
      <div className="welcome-copy">
        <p className="eyebrow">{dictionary.eyebrow}</p>
        <h1>{dictionary.heading}</h1>
        <p className="introduction">{dictionary.introduction}</p>
        <nav className="welcome-actions" aria-label={dictionary.book}>
          <Link className="welcome-primary" href={`/${locale}/account/book`}>
            {dictionary.book}
          </Link>
          <Link href={`/${locale}/account/login`}>{dictionary.signIn}</Link>
          <Link href={`/${locale}/account/register`}>{dictionary.register}</Link>
        </nav>
        <div className="welcome-note">
          <p>{dictionary.welcome}</p>
        </div>
      </div>
      <div className="welcome-art" aria-hidden="true">
        <div className="art-frame">
          <span className="art-orbit art-orbit-one" />
          <span className="art-orbit art-orbit-two" />
          <span className="art-line" />
          <span className="art-initial">L</span>
          <span className="art-caption">Lucy Spa</span>
        </div>
      </div>
      {popup ? <PromoPopup locale={locale} /> : null}
    </main>
  );
}
