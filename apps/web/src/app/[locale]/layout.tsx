import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrandWordmark } from '@lucy-spa/ui';
import '@lucy-spa/ui/tokens.css';
import { getDictionary } from '../../i18n/dictionaries';
import { isLocale, locales } from '../../i18n/locales';
import '../globals.css';

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dictionary = getDictionary(locale);
  return {
    title: dictionary.title,
    description: dictionary.description,
    // The Phase 0 shell is not a published public website.
    robots: { index: false, follow: false },
  };
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dictionary = getDictionary(locale);

  return (
    <html lang={locale}>
      <body>
        <a className="skip-link" href="#main-content">
          {dictionary.skipToContent}
        </a>
        <div className="site-shell">
          <header className="site-header">
            <Link className="brand-link" href={`/${locale}`} aria-label="Lucy Spa">
              <BrandWordmark />
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
          {children}
          <footer className="site-footer">
            <span>Lucy Spa</span>
            <span>{dictionary.signature}</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
