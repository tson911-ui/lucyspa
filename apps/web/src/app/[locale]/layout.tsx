import type { Metadata } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import { notFound } from 'next/navigation';
import { ThemeInitScript } from '@lucy-spa/ui';
import '@lucy-spa/ui/tokens.css';
import '@lucy-spa/ui/base.css';
import '@lucy-spa/ui/components.css';
import '@lucy-spa/ui/shell.css';
import { getDictionary } from '../../i18n/dictionaries';
import { isLocale, locales } from '../../i18n/locales';
import '../globals.css';

// Designed for Vietnamese (stacked diacritics); self-hosted by next/font at build time.
const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-be-vietnam-pro',
});

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

/** Document root shared by the public page and the workforce area. */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dictionary = getDictionary(locale);

  return (
    // The pre-paint script may set data-theme from the ls-theme cookie before hydration.
    <html lang={locale} className={beVietnamPro.variable} suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          {dictionary.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
