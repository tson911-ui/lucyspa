import Link from 'next/link';
import { BrandWordmark } from '@lucy-spa/ui';
import { getDictionary } from '../../i18n/dictionaries';
import type { Locale } from '../../i18n/locales';
import type { SiteDecorSpec } from '../../lib/season-core';
import { SiteLogo } from '../season/site-frame-view';

/**
 * The public site's header and footer. The public layout and the admin's season preview draw the same two pieces, so
 * what the Owner previews is the page a visitor gets.
 */
export function PublicHeader({
  locale,
  decor,
}: {
  locale: Locale;
  /** The season's site decoration (logo accent), or null for the plain wordmark. */
  decor: SiteDecorSpec | null;
}) {
  const dictionary = getDictionary(locale);
  return (
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
}

export function PublicFooter({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  return (
    <footer className="site-footer">
      <span>Lucy Spa</span>
      <span>{dictionary.signature}</span>
    </footer>
  );
}
