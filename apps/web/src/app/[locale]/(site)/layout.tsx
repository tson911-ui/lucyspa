import { notFound } from 'next/navigation';
// Session 10 page work (Steps 4-6), one sheet per area, after the foundation (the root layout's sheets load first).
import '@lucy-spa/ui/s10-public.css';
import '@lucy-spa/ui/s10-member.css';
import '@lucy-spa/ui/s10-account.css';
import { PageTransition } from '../../../components/public/page-transition';
import { SitePageFrame } from '../../../components/public/site-page-frame';
import { isLocale } from '../../../i18n/locales';

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
