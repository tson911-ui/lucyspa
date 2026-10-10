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
import '@lucy-spa/ui/staff.css';
import '@lucy-spa/ui/site.css';
import '@lucy-spa/ui/customer-tokens.css';
import '@lucy-spa/ui/customer.css';
import '@lucy-spa/ui/customer-pages.css';
import { getDictionary } from '../../i18n/dictionaries';
import { RouteHistoryTracker } from '../../components/navigation/page-back';
// Direction C's two faces (Owner, 2026-10-10): the variables sit on the root now, so the staff screens use them too.
import { siteFontClass } from '../../components/public/site-fonts';
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

// Owner bug 2026-10-06 (tab bar labels cut off at the bottom): a page wider than the screen made the phone browser zoom
// out to fit it, which leaves the layout viewport (where the fixed bar is anchored) taller than the visible screen.
// `minimumScale: 1` forbids that zoom-out (the visitor can still zoom in), and the site frame clips horizontal overflow.
// `viewportFit: 'cover'` (back after cdde1cf dropped it): without it Android Chrome and the iPhone keep the page above their
// system bar and leave a thin strip of their own below the tab bar (Owner 2026-10-06, after cdde1cf). The page covers the
// whole screen, the bar's opaque background reaches the bottom edge and the bottom inset is padding inside it.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  viewportFit: 'cover',
  // The on-screen keyboard shrinks the page (the shell then ends above it) instead of covering it.
  interactiveWidget: 'resizes-content',
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
      className={`${beVietnamPro.variable} ${playfairDisplay.variable} ${siteFontClass}`}
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
