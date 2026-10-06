import { MotionGate } from '@lucy-spa/ui';
import type { ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { fetchPublicSite } from '../../lib/public-site';
import { loadSiteDecor, SeasonSiteFrame } from '../season/site-frame';
import { ContactWidget } from './contact-widget';
import { PublicFooter, PublicHeader } from './site-chrome';
import { PublicTabBar } from './site-chrome-client';
import { SiteScrollManager } from './site-scroll-manager';
import { SiteSessionProvider } from './site-session';

/**
 * The one frame of the customer side (Part 2 contract 3.1): the public pages, the member auth pages and the member
 * area all sit between the same header and footer, with the same phone tab bar and the same seasonal decoration.
 */
export async function SitePageFrame({ locale, children }: { locale: Locale; children: ReactNode }) {
  // A season with site-wide art (S6) decorates the whole page; without one the page keeps its exact structure.
  // The shop profile (cached 60 s, shared with the pages) feeds the footer's contact column.
  const [decor, site] = await Promise.all([loadSiteDecor(locale), fetchPublicSite(locale)]);
  const header = <PublicHeader locale={locale} decor={decor} />;
  const footer = <PublicFooter locale={locale} site={site} />;
  // The floating contact button is the last thing of the content (just before the footer), so it never covers the footer.
  const content = (
    <>
      {children}
      <ContactWidget locale={locale} site={site} />
    </>
  );

  return (
    <div className="ls-site">
      <SiteSessionProvider>
        {/* Below 1024 px this is the one scroll container of the page (the app shell, site.css); the tab bar below it is in
            the flow. From 1024 px it is display: contents and the document scrolls. */}
        <div className="ls-site-scroll" data-ls-scroll="">
          <SiteScrollManager />
          {decor ? (
            <SeasonSiteFrame decor={decor} locale={locale} header={header} footer={footer}>
              {content}
            </SeasonSiteFrame>
          ) : (
            <div className="site-shell">
              {header}
              {content}
              {footer}
            </div>
          )}
        </div>
        <PublicTabBar locale={locale} />
      </SiteSessionProvider>
      <MotionGate />
    </div>
  );
}
