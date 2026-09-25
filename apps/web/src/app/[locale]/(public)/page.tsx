import { notFound } from 'next/navigation';
import { getDictionary } from '../../../i18n/dictionaries';
import { isLocale } from '../../../i18n/locales';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dictionary = getDictionary(locale);

  return (
    <main className="welcome" id="main-content" tabIndex={-1}>
      <div className="welcome-copy">
        <p className="eyebrow">{dictionary.eyebrow}</p>
        <h1>{dictionary.heading}</h1>
        <p className="introduction">{dictionary.introduction}</p>
        <div className="welcome-note">
          <p>{dictionary.comingSoon}</p>
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
    </main>
  );
}
