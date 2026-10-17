'use client';

import type { CurrentAccountResponse } from '@lucy-spa/contracts';
import { Band, Button, PublicMain, Skeleton } from '@lucy-spa/ui';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getCustomerDictionary, type CustomerDictionary } from '../../i18n/customer';
import type { Locale } from '../../i18n/locales';
import { ApiClient } from '../../lib/api/client';
import { customerLogout, loadCustomerSession, loginHref } from '../../lib/customer/auth';
import { clearCachedReads } from '../../lib/customer/fetch-cache';
import { announceSessionChange, SITE_SESSION_CHANGED } from '../../lib/site-session';
import { useSiteSession } from '../public/site-session';

export interface CustomerContextValue {
  locale: Locale;
  t: CustomerDictionary;
  api: ApiClient;
  /** Base path of the member area for this locale, e.g. `/vi/account`. */
  base: string;
  /** Set when a submission failed because the session expired (the page is kept). */
  sessionLost: boolean;
}

export const CustomerContext = createContext<CustomerContextValue | null>(null);

/**
 * One shared API client for the member area. On a 401 a failed read returns to login with
 * this page as the return path; a failed submission keeps the page and its entries (the
 * same rule as the workforce area).
 */
export function CustomerProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const base = `/${locale}/account`;
  const [sessionLost, setSessionLost] = useState(false);
  const redirecting = useRef(false);
  const api = useMemo(
    () =>
      new ApiClient({
        onUnauthenticated: (method) => {
          if (method === 'POST') {
            setSessionLost(true);
            return;
          }
          if (redirecting.current) return;
          redirecting.current = true;
          const next = `${window.location.pathname}${window.location.search}`;
          router.replace(`${base}/login?${new URLSearchParams({ expired: '1', next }).toString()}`);
        },
        onAuthenticatedResponse: () => setSessionLost(false),
      }),
    [router, base],
  );
  const value = useMemo(
    () => ({ locale, t: getCustomerDictionary(locale), api, base, sessionLost }),
    [locale, api, base, sessionLost],
  );
  return <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>;
}

export function useCustomer(): CustomerContextValue {
  const value = useContext(CustomerContext);
  if (!value) throw new Error('useCustomer outside CustomerProvider');
  return value;
}

export interface CustomerAccountValue {
  account: CurrentAccountResponse;
  signOut: () => Promise<void>;
}

export const CustomerAccountContext = createContext<CustomerAccountValue | null>(null);

export function useCustomerAccount(): CustomerAccountValue {
  const value = useContext(CustomerAccountContext);
  if (!value) throw new Error('useCustomerAccount outside RequireCustomer');
  return value;
}

type GuardState =
  | { kind: 'loading' }
  | { kind: 'customer'; account: CurrentAccountResponse }
  | { kind: 'workforce' }
  | { kind: 'error' };

/**
 * UX gate for the member area (every API call is still authorized by the server): anonymous
 * sessions go to login; staff sessions are refused with a sign-out option (contract section 13).
 *
 * One session read, not three (rbp session.tsx:109-127, :155-198): the site frame's session (read once per tab and again whenever a
 * sign-in, a sign-out or a profile change is announced) already knows a member, so the area opens at once and follows it (a new name
 * shows everywhere). Only when the frame knows no member (anonymous, a staff session, or its read failed) does the guard read once
 * more, to tell those apart. Any change of session also clears the member's cached reads.
 */
export function RequireCustomer({ children }: { children: ReactNode }) {
  const { api, base, t } = useCustomer();
  const router = useRouter();
  const pathname = usePathname();
  const site = useSiteSession();
  const [own, setOwn] = useState<GuardState>({ kind: 'loading' });
  // Set by sign-out: the page is leaving for the sign-in page, so the guard does not send it there a second time.
  const leaving = useRef(false);
  const needsOwnRead = site.ready && site.account === null;

  useEffect(() => {
    if (!needsOwnRead) return;
    let active = true;
    loadCustomerSession(api)
      .then((session) => {
        if (!active) return;
        if (session.kind === 'anonymous') {
          if (!leaving.current) router.replace(loginHref(base, pathname, window.location.search));
        } else if (session.kind === 'workforce') {
          setOwn({ kind: 'workforce' });
        } else {
          setOwn({ kind: 'customer', account: session.account });
        }
      })
      .catch(() => active && setOwn({ kind: 'error' }));
    return () => {
      active = false;
    };
    // Read when the frame knows no member; navigation inside the area keeps the answer.
  }, [api, needsOwnRead]);

  useEffect(() => {
    window.addEventListener(SITE_SESSION_CHANGED, clearCachedReads);
    return () => window.removeEventListener(SITE_SESSION_CHANGED, clearCachedReads);
  }, []);

  const signOut = useCallback(async () => {
    leaving.current = true;
    try {
      await customerLogout(api);
    } finally {
      clearCachedReads();
      site.markSignedOut();
      announceSessionChange();
      router.replace(`${base}/login?signedOut=1`);
    }
  }, [api, base, router, site]);

  // The frame's member first; the guard's own answer only when the frame has none; waiting while the frame is still reading.
  const state: GuardState = site.account
    ? { kind: 'customer', account: site.account }
    : !site.ready
      ? { kind: 'loading' }
      : own;
  const account = state.kind === 'customer' ? state.account : null;
  const accountValue = useMemo(() => (account ? { account, signOut } : null), [account, signOut]);

  if (state.kind === 'loading') {
    return (
      <PublicMain className="ls-main-tall">
        <Band tone="page" className="ls-band--alt ls-acct-title" label={t.auth.checking}>
          <span className="ls-visually-hidden" role="status">
            {t.auth.checking}
          </span>
          <Skeleton lines={1} height="var(--ls-space-9)" width="60%" />
        </Band>
        <Band tone="page" className="ls-band--base ls-acct-body" label={t.auth.checking}>
          <Skeleton lines={3} height="var(--ls-space-5)" />
        </Band>
      </PublicMain>
    );
  }
  if (state.kind === 'error') {
    return (
      <PublicMain className="ls-main-tall">
        <div className="ls-site-state">
          {/* The page still has its one heading when the account cannot open (wig session.tsx:170). */}
          <h1 className="ls-mem-state-title">{t.auth.areaErrorTitle}</h1>
          <p role="alert">{t.errors.unavailable}</p>
          <Button variant="primary" onClick={() => window.location.reload()}>
            {t.common.reload}
          </Button>
        </div>
      </PublicMain>
    );
  }
  if (state.kind === 'workforce') {
    return (
      <PublicMain className="ls-main-tall">
        <div className="ls-site-state">
          <h1 className="ls-mem-state-title">{t.auth.staffAccountTitle}</h1>
          <p role="alert">{t.auth.workforceNotAllowed}</p>
          <Button variant="primary" onClick={() => void signOut()}>
            {t.nav.signOut}
          </Button>
        </div>
      </PublicMain>
    );
  }
  return (
    <CustomerAccountContext.Provider value={accountValue}>
      {children}
    </CustomerAccountContext.Provider>
  );
}
