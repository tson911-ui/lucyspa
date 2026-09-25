import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrandWordmark } from '@lucy-spa/ui';
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

  return (
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
  );
}
