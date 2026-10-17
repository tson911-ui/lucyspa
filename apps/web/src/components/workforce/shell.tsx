'use client';

import {
  AppShell,
  BrandWordmark,
  Button,
  Icon,
  MotionGate,
  Page,
  ToastProvider,
  UserMenu,
  isPathActive,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from './link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { invalidateCachedReads } from '../../lib/customer/fetch-cache';
import { pageTitle } from '../../lib/page-title';
import { SESSION_WATCH_INTERVAL_MS, createSessionCheck } from '../../lib/workforce/session-watch';
import { NAV_ICONS, personalEntries, sidebarGroups } from '../../lib/workforce/nav-groups';
import { navigationFor } from '../../lib/workforce/permissions';
import { PageBack } from '../navigation/page-back';
import { NotificationIndicator } from '../notifications/inbox';
import { LanguageSwitch } from './language-switch';
import { onPageReturn } from './data';
import { useAccount, useSessionNotice, useWorkforce } from './session';
import { Notice, STAFF_READ_PREFIX } from './ui';

/** The deepest navigation entry the address is in (a record page takes its list's name), or null outside every entry. */
export function staffPageName(
  items: ReturnType<typeof navigationFor>,
  base: string,
  pathname: string,
  t: ReturnType<typeof useWorkforce>['t'],
): string | null {
  let best: { label: string; length: number } | null = null;
  for (const item of items) {
    const href = `${base}${item.path}`;
    if (!isPathActive(pathname, href, item.path === '')) continue;
    if (!best || href.length > best.length) best = { label: t.nav[item.key], length: href.length };
  }
  return best?.label ?? null;
}

export function WorkforceShell({ children }: { children: ReactNode }) {
  const { t, base, locale, api } = useWorkforce();
  const { account, signOut } = useAccount();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  // Which entries exist is decided by `navigationFor` (permissions); the shell only presents them. Both lists are rebuilt only
  // when the account, the language or the page changes (rbp rerender-memo), so the memoised sidebar skips other renders.
  const items = useMemo(() => navigationFor(account), [account]);
  const nav = useMemo(
    () => sidebarGroups(items, t, base, (href, exact) => isPathActive(pathname, href, exact)),
    [items, t, base, pathname],
  );
  const labels = useMemo(
    () => ({
      nav: t.nav.label,
      menu: t.nav.menu,
      closeMenu: t.nav.closeMenu,
      collapse: t.nav.collapse,
      expand: t.nav.expand,
    }),
    [t],
  );
  // Leaving the staff area (sign-out, an ended session) forgets the shared reference reads (branches, names).
  useEffect(() => () => invalidateCachedReads(STAFF_READ_PREFIX), []);
  // HIG C41: the browser tab names the page, short, with the brand after it ("Chấm công – Lucy Spa", the one title form of every
  // area, `pageTitle`), never the brand alone.
  const pageName = useMemo(
    () => staffPageName(items, base, pathname, t),
    [items, base, pathname, t],
  );
  useEffect(() => {
    document.title = pageName ? pageTitle(pageName) : t.meta.title;
  }, [pageName, t]);
  const title = account.workforceTitle
    ? t.employees.titles[account.workforceTitle]
    : account.kind === 'OWNER'
      ? t.auth.owner
      : t.auth.employee;

  return (
    <WorkforceToasts>
      <MotionGate />
      <SessionWatch />
      <FreshOnReturn />
      <AppShell
        LinkComponent={Link}
        brand={
          <Link href={base} aria-label="Lucy Spa" translate="no">
            <BrandWordmark serif />
          </Link>
        }
        nav={nav}
        labels={labels}
        topbarExtras={
          <>
            <LanguageSwitch short />
          </>
        }
        topbar={<NotificationIndicator api={api} base={base} locale={locale} />}
        topbarEnd={
          <>
            <UserMenu name={account.displayName} subtitle={title} triggerLabel={t.nav.account}>
              <div className="ls-usermenu-section">
                {personalEntries(items).map((item) => (
                  <Link key={item.key} className="ls-usermenu-link" href={`${base}${item.path}`}>
                    <Icon name={NAV_ICONS[item.key]} />
                    {t.nav[item.key]}
                  </Link>
                ))}
              </div>
              <div className="ls-usermenu-section ls-only-phone">
                <p className="ls-usermenu-label">{t.nav.language}</p>
                <LanguageSwitch className="ls-usermenu-link" />
              </div>
              <div className="ls-usermenu-section">
                <button
                  type="button"
                  className="ls-usermenu-link"
                  disabled={signingOut}
                  onClick={() => {
                    setSigningOut(true);
                    void signOut();
                  }}
                >
                  <Icon name="log-out" />
                  {signingOut ? t.auth.signingOut : t.auth.signOut}
                </button>
              </div>
            </UserMenu>
          </>
        }
      >
        <Page>
          <PageBack root={base} menuRoot label={t.common.back} />
          <SessionLostNotice />
          {children}
        </Page>
      </AppShell>
    </WorkforceToasts>
  );
}

/** Quick success feedback for the whole workforce area: bottom-right, 5 s, errors stay in place. */
export function WorkforceToasts({ children }: { children: ReactNode }) {
  const { t } = useWorkforce();
  return (
    <ToastProvider regionLabel={t.common.toastRegion} dismissLabel={t.common.close}>
      {children}
    </ToastProvider>
  );
}

/**
 * A page restored from the browser's back/forward cache comes back exactly as it was left, numbers included. Staff
 * data must never look old, so a restored page reloads and fetches again. Renders nothing.
 */
export function FreshOnReturn() {
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  return null;
}

/**
 * Passive session check (`/auth/me`, never extends the idle timeout) on window focus and every
 * few minutes while visible. A role or scope change ends the session on the server; this tells
 * the person instead of failing on their next save. Renders nothing.
 */
export function SessionWatch() {
  const { api } = useWorkforce();
  const { report } = useSessionNotice();
  useEffect(() => {
    const check = createSessionCheck({ api, onEnded: report });
    const visibleCheck = () => {
      if (document.visibilityState === 'visible') void check();
    };
    // The shared page-return signal (one focus/visibility pair for the whole staff area), not a pair of its own.
    const stopReturn = onPageReturn(visibleCheck);
    const timer = window.setInterval(visibleCheck, SESSION_WATCH_INTERVAL_MS);
    return () => {
      stopReturn();
      window.clearInterval(timer);
    };
  }, [api, report]);
  return null;
}

/**
 * Shown when a submission failed because the session expired. The page and the form's
 * entries stay; signing in again happens in a new tab, and then the user saves again here
 * (the client picks up the new session's CSRF token automatically).
 */
export function SessionLostNotice() {
  const { t, base } = useWorkforce();
  const { lost, reason, dismiss } = useSessionNotice();
  if (!lost) return null;
  return (
    <Notice tone="warning">
      <p>
        {reason === 'AUTHORIZATION_CHANGED' ? t.auth.permissionsChangedLost : t.auth.sessionLost}
      </p>
      <p>
        <a href={`${base}/login?next=${encodeURIComponent(base)}`} target="_blank" rel="noopener">
          {t.auth.signInNewTab}
        </a>{' '}
        <Button variant="secondary" onClick={dismiss}>
          {t.common.close}
        </Button>
      </p>
    </Notice>
  );
}
