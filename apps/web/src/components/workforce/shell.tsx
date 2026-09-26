'use client';

import { BrandWordmark } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { navigationFor, type NavItem } from '../../lib/workforce/permissions';
import { useAccount, useSessionNotice, useWorkforce } from './session';
import { Notice } from './ui';

const GROUPS: NavItem['group'][] = ['home', 'operations', 'management'];

/** Groups the permission-filtered navigation; empty groups are omitted. */
export function groupedNavigation(items: readonly NavItem[]) {
  return GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);
}

export function NavigationLinks({
  items,
  base,
  current,
  t,
  onNavigate,
}: {
  items: readonly NavItem[];
  base: string;
  current: string;
  t: WorkforceDictionary;
  onNavigate?: () => void;
}) {
  return (
    <>
      {groupedNavigation(items).map(({ group, items: entries }) => (
        <div className="wf-nav-group" key={group}>
          <p className="wf-nav-heading">{t.nav[group]}</p>
          <ul>
            {entries.map((item) => {
              const href = `${base}${item.path}`;
              const active =
                item.path === ''
                  ? current === base
                  : current === href || current.startsWith(`${href}/`);
              return (
                <li key={item.key}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    {...(onNavigate ? { onClick: onNavigate } : {})}
                  >
                    {t.nav[item.key]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

export function WorkforceShell({ children }: { children: ReactNode }) {
  const { t, base, locale } = useWorkforce();
  const { account, signOut } = useAccount();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const items = navigationFor(account);
  const other = locale === 'vi' ? 'en' : 'vi';
  const switchHref = pathname.replace(/^\/(vi|en)(?=\/|$)/, `/${other}`);

  return (
    <div className="wf-app">
      <header className="wf-topbar">
        <button
          type="button"
          className="wf-menu-button"
          aria-expanded={open}
          aria-controls="wf-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {t.nav.menu}
        </button>
        <Link className="wf-brand" href={base} aria-label="Lucy Spa">
          <BrandWordmark />
        </Link>
        <div className="wf-account">
          <span className="wf-account-name">
            {account.displayName}
            <span className="wf-muted wf-small">
              {' · '}
              {account.workforceTitle
                ? t.employees.titles[account.workforceTitle]
                : account.kind === 'OWNER'
                  ? t.auth.owner
                  : t.auth.employee}
            </span>
          </span>
          <Link href={switchHref} hrefLang={other} lang={other} className="wf-lang">
            {other === 'vi' ? 'Tiếng Việt' : 'English'}
          </Link>
          <button
            type="button"
            className="wf-button wf-button-quiet"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOut();
            }}
          >
            {signingOut ? t.auth.signingOut : t.auth.signOut}
          </button>
        </div>
      </header>
      <div className="wf-body">
        <nav id="wf-nav" className="wf-nav" data-open={open} aria-label={t.nav.label}>
          <NavigationLinks
            items={items}
            base={base}
            current={pathname}
            t={t}
            onNavigate={() => setOpen(false)}
          />
        </nav>
        <main className="wf-main" id="main-content" tabIndex={-1}>
          <SessionLostNotice />
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Shown when a submission failed because the session expired. The page and the form's
 * entries stay; signing in again happens in a new tab, and then the user saves again here
 * (the client picks up the new session's CSRF token automatically).
 */
export function SessionLostNotice() {
  const { t, base } = useWorkforce();
  const { lost, dismiss } = useSessionNotice();
  if (!lost) return null;
  return (
    <Notice tone="warning">
      <p>{t.auth.sessionLost}</p>
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
