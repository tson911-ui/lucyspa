import type { Viewport } from 'next';
import { notFound } from 'next/navigation';
import { PageTransition } from '../../../components/public/page-transition';
import { SitePageFrame } from '../../../components/public/site-page-frame';
import { isLocale } from '../../../i18n/locales';

/** The browser bar takes the page's base band color in each scheme (DESIGN.md 6.1: --ls-band-base, white in light and black in dark). */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

interface SiteLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * The one frame of the customer side: the public pages, the member auth pages and the member area are all children of
 * this layout, so the header, the phone tab bar, the footer, the contact button and the session state stay mounted and
 * still while only the page between them changes (a layout per group used to remount all of them when a visitor went
 * from the public pages to the member area, which flashed the whole screen).
 */
export default async function SiteLayout({ children, params }: SiteLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <SitePageFrame locale={locale}>
      <PageTransition>{children}</PageTransition>
    </SitePageFrame>
  );
}
