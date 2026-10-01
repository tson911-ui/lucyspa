'use client';

import {
  AppShell,
  BrandWordmark,
  Icon,
  Page,
  ThemeToggle,
  ToastProvider,
  UserMenu,
  isPathActive,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { SESSION_WATCH_INTERVAL_MS, createSessionCheck } from '../../lib/workforce/session-watch';
import { NAV_ICONS, personalEntries, sidebarGroups } from '../../lib/workforce/nav-groups';
import { navigationFor } from '../../lib/workforce/permissions';
import { NotificationIndicator } from '../notifications/inbox';
import { themeLabels } from './auth-actions';
import { LanguageSwitch } from './language-switch';
import { useAccount, useSessionNotice, useWorkforce } from './session';
import { Notice } from './ui';

export function WorkforceShell({ children }: { children: ReactNode }) {
  const { t, base, locale, api } = useWorkforce();
  const { account, signOut } = useAccount();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  // Which entries exist is decided by `navigationFor` (permissions); the shell only presents them.
  const items = navigationFor(account);
  const title = account.workforceTitle
    ? t.employees.titles[account.workforceTitle]
    : account.kind === 'OWNER'
      ? t.auth.owner
      : t.auth.employee;

  return (
    <WorkforceToasts>
      <SessionWatch />
      <AppShell
        className="wf-app"
        mainClassName="wf-main"
        LinkComponent={Link}
        brand={
          <Link href={base} aria-label="Lucy Spa">
            <BrandWordmark />
          </Link>
        }
        nav={sidebarGroups(items, t, base, (href, exact) => isPathActive(pathname, href, exact))}
        labels={{
          nav: t.nav.label,
          menu: t.nav.menu,
          closeMenu: t.nav.closeMenu,
          collapse: t.nav.collapse,
          expand: t.nav.expand,
        }}
        topbarExtras={
          <>
            <ThemeToggle labels={themeLabels(t)} />
            <LanguageSwitch />
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
                <p className="ls-usermenu-label">{t.nav.appearance}</p>
                <ThemeToggle labels={themeLabels(t)} withLabels />
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
    window.addEventListener('focus', visibleCheck);
    document.addEventListener('visibilitychange', visibleCheck);
    const timer = window.setInterval(visibleCheck, SESSION_WATCH_INTERVAL_MS);
    return () => {
      window.removeEventListener('focus', visibleCheck);
      document.removeEventListener('visibilitychange', visibleCheck);
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
        <button type="button" className="wf-button wf-button-quiet" onClick={dismiss}>
          {t.common.close}
        </button>
      </p>
    </Notice>
  );
}
