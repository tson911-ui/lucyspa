import { notFound } from 'next/navigation';
import { PublicFooter, PublicHeader } from '../../../components/public/site-chrome';
import { loadSiteDecor, SeasonSiteFrame } from '../../../components/season/site-frame';
import { isLocale } from '../../../i18n/locales';

interface PublicLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function PublicLayout({ children, params }: PublicLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // A season with site-wide art (S6) decorates the whole page; without one the page keeps its exact structure.
  const decor = await loadSiteDecor(locale);
  const header = <PublicHeader locale={locale} decor={decor} />;
  const footer = <PublicFooter locale={locale} />;

  if (decor) {
    return (
      <SeasonSiteFrame decor={decor} locale={locale} header={header} footer={footer}>
        {children}
      </SeasonSiteFrame>
    );
  }
  return (
    <div className="site-shell">
      {header}
      {children}
      {footer}
    </div>
  );
}
