import type { PublicSiteResponse } from '@lucy-spa/contracts';
import { MotionGate, SelectIconScope } from '@lucy-spa/ui';
import { Suspense, type ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { fetchHasPublicProducts, fetchPublicSite } from '../../lib/public-site';
import { loadSiteDecor, SeasonSiteFrame } from '../season/site-frame';
import { ContactWidget } from './contact-widget';
import { PublicFooter, PublicHeader } from './site-chrome';
import { PublicTabBar } from './site-chrome-client';
import { SiteScrollManager } from './site-scroll-manager';
import { SiteSessionProvider } from './site-session';

/**
 * The one frame of the customer side (Part 2 contract 3.1): the public pages, the member auth pages and the member
 * area all sit between the same header and footer, with the same phone tab bar and the same seasonal decoration.
 *
 * The season decoration and "has products" are awaited here, together (both remembered for a minute, so usually already there):
 * the header menu and the tab bar hydrate with the rest of the frame. Streamed in their own boundaries, a member's session could
 * resolve before they hydrated, and their signed-in entries then differed from the server's HTML (React #418, member pages only).
 * The footer and the floating contact button, which do not depend on the session, stream behind their own boundary
 * (rbp async-suspense-boundaries) and follow the shop profile.
 */
export async function SitePageFrame({ locale, children }: { locale: Locale; children: ReactNode }) {
  const site = fetchPublicSite(locale);
  const [decor, hasProducts] = await Promise.all([
    loadSiteDecor(locale),
    fetchHasPublicProducts(locale),
  ]);
  const header = <PublicHeader locale={locale} decor={decor} hasProducts={hasProducts} />;
  const footer = (
    <Suspense fallback={null}>
      <FooterWhenKnown locale={locale} site={site} hasProducts={hasProducts} />
    </Suspense>
  );
  // The floating contact button is the last thing of the content (just before the footer), so it never covers the footer.
  const content = (
    <>
      {children}
      <Suspense fallback={null}>
        <ContactWhenKnown locale={locale} site={site} />
      </Suspense>
    </>
  );

  return (
    // data-ui="v2": the DESIGN.md token scope (tokens.css). Every dialog, menu and the tab bar render inside this frame, so
    // none of them needs the attribute of its own; nothing here is portaled to the document body.
    <div className="ls-site" data-ui="v2">
      <SelectIconScope>
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
          <PublicTabBar locale={locale} hasProducts={hasProducts} />
        </SiteSessionProvider>
      </SelectIconScope>
      <MotionGate />
    </div>
  );
}

async function FooterWhenKnown({
  locale,
  site,
  hasProducts,
}: {
  locale: Locale;
  site: Promise<PublicSiteResponse | null>;
  hasProducts: boolean;
}) {
  return <PublicFooter locale={locale} site={await site} hasProducts={hasProducts} />;
}

async function ContactWhenKnown({
  locale,
  site,
}: {
  locale: Locale;
  site: Promise<PublicSiteResponse | null>;
}) {
  return <ContactWidget locale={locale} site={await site} />;
}
