import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro, Playfair_Display } from 'next/font/google';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ThemeInitScript } from '@lucy-spa/ui';
import '@lucy-spa/ui/tokens.css';
// Seasonal presets (docs/UXUI_REDESIGN_DESIGN.md 20): inert until an element carries data-season (set below, S5).
import '@lucy-spa/ui/season.css';
import '@lucy-spa/ui/season-decor.css';
import '@lucy-spa/ui/season-art.css';
import '@lucy-spa/ui/season-preview.css';
import '@lucy-spa/ui/base.css';
import '@lucy-spa/ui/components.css';
import '@lucy-spa/ui/shell.css';
import '@lucy-spa/ui/site.css';
import { getDictionary } from '../../i18n/dictionaries';
import { RouteHistoryTracker } from '../../components/navigation/page-back';
import { isLocale, locales } from '../../i18n/locales';
import { ADMIN_HIDE_COOKIE, seasonRootAttributes } from '../../lib/season-core';
import { fetchActiveSeason } from '../../lib/season-server';
import '../globals.css';

// Designed for Vietnamese (stacked diacritics); self-hosted by next/font at build time.
const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-be-vietnam-pro',
});

// Display and italic face (season greetings, legacy headings): Vietnamese subset so every stacked mark (ố ế ữ ặ ỗ ợ)
// draws in the font itself, self-hosted by next/font; never a system serif.
const playfairDisplay = Playfair_Display({
  subsets: ['latin', 'vietnamese'],
  // 400 is the h1-h3 weight of the public site and member area (Owner decision 2026-10-04, earlier 500/600); 500 and 600 stay loaded for the logo wordmark, the seasonal greetings and emphasis.
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-playfair-display',
});

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

// The page covers the whole screen, the bottom safe area (an iPhone's home indicator) included: the phone tab bar draws its
// own opaque background down to the screen edge and pads its labels above the indicator (env(safe-area-inset-bottom)).
// Without viewport-fit=cover the inset is always 0 and the browser decides what shows below the page.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

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
    // Not indexable unless a page says otherwise: only the home page, the service list and a service's page do
    // (lib/public-metadata.ts); the member area, the sign-in pages and the staff area stay out of every index.
    robots: { index: false, follow: false },
  };
}

/** Document root shared by the public page and the workforce area. */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dictionary = getDictionary(locale);
  // The active season (cached 60 s, fail closed) and this device's choice to hide the admin touch.
  const season = await fetchActiveSeason(locale);
  const adminHidden = (await cookies()).get(ADMIN_HIDE_COOKIE)?.value === 'off';

  return (
    // The pre-paint script may set data-theme from the ls-theme cookie before hydration.
    <html
      lang={locale}
      className={`${beVietnamPro.variable} ${playfairDisplay.variable}`}
      suppressHydrationWarning
      {...seasonRootAttributes(season, adminHidden)}
    >
      <head>
        <ThemeInitScript />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          {dictionary.skipToContent}
        </a>
        <RouteHistoryTracker />
        {children}
      </body>
    </html>
  );
}
