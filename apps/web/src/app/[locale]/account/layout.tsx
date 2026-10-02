import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SeasonSiteParticles } from '@lucy-spa/ui';
import { SeasonBand } from '../../../components/season/season-band';
import { loadSiteDecor, SiteSeasonStrip } from '../../../components/season/site-frame';
import { CustomerProvider } from '../../../components/customer/session';
import { getCustomerDictionary } from '../../../i18n/customer';
import { isLocale } from '../../../i18n/locales';
import '../../customer.css';

interface AccountLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: AccountLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // Personal account pages: never indexed.
  return {
    title: getCustomerDictionary(locale).meta.title,
    robots: { index: false, follow: false },
  };
}

const appClass = 'wf-app cu-app';

/** The member area (Phase 3 Step 4): shares the design tokens and form primitives. */
export default async function AccountLayout({ children, params }: AccountLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // A season with site-wide art (S6) gives the member area the tint, the particles behind the content and the greeting
  // strip; its own shell keeps its header and footer (Part 2 redesigns the member area).
  const decor = await loadSiteDecor(locale);
  return (
    <div className={decor ? `${appClass} ls-site-page` : appClass}>
      {decor?.particles ? <SeasonSiteParticles kit={decor.kit} density={decor.density} /> : null}
      {decor ? <SiteSeasonStrip decor={decor} locale={locale} /> : <SeasonBand locale={locale} />}
      <CustomerProvider locale={locale}>{children}</CustomerProvider>
    </div>
  );
}
