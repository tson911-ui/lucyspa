'use client';

import type { CurrentAccountResponse } from '@lucy-spa/contracts';
import { Button, PublicMain } from '@lucy-spa/ui';
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
import { customerLogout, loadCustomerSession } from '../../lib/customer/auth';
import { announceSessionChange } from '../../lib/site-session';

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
 */
export function RequireCustomer({ children }: { children: ReactNode }) {
  const { api, base, t } = useCustomer();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GuardState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    loadCustomerSession(api)
      .then((session) => {
        if (!active) return;
        if (session.kind === 'anonymous') {
          router.replace(`${base}/login?next=${encodeURIComponent(pathname)}`);
        } else if (session.kind === 'workforce') {
          setState({ kind: 'workforce' });
        } else {
          setState({ kind: 'customer', account: session.account });
        }
      })
      .catch(() => active && setState({ kind: 'error' }));
    return () => {
      active = false;
    };
    // Resolved once per mount; navigation inside the area keeps the session.
  }, [api]);

  const signOut = useCallback(async () => {
    try {
      await customerLogout(api);
    } finally {
      announceSessionChange();
      router.replace(`${base}/login?signedOut=1`);
    }
  }, [api, base, router]);

  if (state.kind === 'loading') {
    return (
      <PublicMain>
        <p className="ls-site-state" role="status">
          {t.auth.checking}
        </p>
      </PublicMain>
    );
  }
  if (state.kind === 'error') {
    return (
      <PublicMain>
        <div className="ls-site-state">
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
      <PublicMain>
        <div className="ls-site-state">
          <p role="alert">{t.auth.workforceNotAllowed}</p>
          <Button variant="primary" onClick={() => void signOut()}>
            {t.nav.signOut}
          </Button>
        </div>
      </PublicMain>
    );
  }
  return (
    <CustomerAccountContext.Provider value={{ account: state.account, signOut }}>
      {children}
    </CustomerAccountContext.Provider>
  );
}
