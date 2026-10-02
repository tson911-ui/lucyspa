import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrandWordmark } from '@lucy-spa/ui';
import { SeasonBand } from '../../../components/season/season-band';
import { loadSiteDecor, SeasonSiteFrame, SiteLogo } from '../../../components/season/site-frame';
import { getDictionary } from '../../../i18n/dictionaries';
import { isLocale } from '../../../i18n/locales';

interface PublicLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function PublicLayout({ children, params }: PublicLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dictionary = getDictionary(locale);
  // A season with site-wide art (S6) decorates the whole page; without one the page keeps its exact structure.
  const decor = await loadSiteDecor(locale);

  const header = (
    <header className="site-header">
      <Link className="brand-link" href={`/${locale}`} aria-label="Lucy Spa">
        <SiteLogo decor={decor}>
          <BrandWordmark />
        </SiteLogo>
      </Link>
      <nav aria-label={dictionary.language} className="language-selector">
        <Link
          href="/vi"
          lang="vi"
          hrefLang="vi"
          aria-current={locale === 'vi' ? 'page' : undefined}
        >
          Tiếng Việt
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href="/en"
          lang="en"
          hrefLang="en"
          aria-current={locale === 'en' ? 'page' : undefined}
        >
          English
        </Link>
      </nav>
    </header>
  );
  const footer = (
    <footer className="site-footer">
      <span>Lucy Spa</span>
      <span>{dictionary.signature}</span>
    </footer>
  );

  if (decor) {
    return (
      <SeasonSiteFrame decor={decor} locale={locale} header={header} footer={footer}>
        {children}
      </SeasonSiteFrame>
    );
  }
  return (
    <div className="site-shell">
      {header}
      <SeasonBand locale={locale} />
      {children}
      {footer}
    </div>
  );
}
