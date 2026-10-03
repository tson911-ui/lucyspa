import { notFound } from 'next/navigation';
import { PublicTabBar } from '../../../components/public/site-chrome-client';
import { PublicFooter, PublicHeader } from '../../../components/public/site-chrome';
import { loadSiteDecor, SeasonSiteFrame } from '../../../components/season/site-frame';
import { isLocale } from '../../../i18n/locales';
import { fetchPublicSite } from '../../../lib/public-site';

interface PublicLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function PublicLayout({ children, params }: PublicLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // A season with site-wide art (S6) decorates the whole page; without one the page keeps its exact structure.
  // The shop profile (cached 60 s, shared with the pages) feeds the footer's contact column.
  const [decor, site] = await Promise.all([loadSiteDecor(locale), fetchPublicSite(locale)]);
  const header = <PublicHeader locale={locale} decor={decor} />;
  const footer = <PublicFooter locale={locale} site={site} />;

  return (
    <div className="ls-site">
      {decor ? (
        <SeasonSiteFrame decor={decor} locale={locale} header={header} footer={footer}>
          {children}
        </SeasonSiteFrame>
      ) : (
        <div className="site-shell">
          {header}
          {children}
          {footer}
        </div>
      )}
      <PublicTabBar locale={locale} />
    </div>
  );
}
