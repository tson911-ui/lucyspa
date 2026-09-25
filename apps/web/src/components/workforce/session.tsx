'use client';

import type { CurrentAccountResponse } from '@lucy-spa/contracts';
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
import type { Locale } from '../../i18n/locales';
import { getWorkforceDictionary, type WorkforceDictionary } from '../../i18n/workforce';
import { WorkforceApi } from '../../lib/workforce/api';
import { expiredLoginPath, expiryAction } from '../../lib/workforce/expiry';
import { loadSession, workforceLogout } from '../../lib/workforce/workflows';

export interface WorkforceContextValue {
  locale: Locale;
  t: WorkforceDictionary;
  api: WorkforceApi;
  /** Base path of the workforce area for this locale, e.g. `/vi/workforce`. */
  base: string;
}

/** Exported for component tests; application code uses `WorkforceProvider`. */
export const WorkforceContext = createContext<WorkforceContextValue | null>(null);

/** Set while a submission failed because the session expired and the page was kept. */
export interface SessionNoticeValue {
  lost: boolean;
  dismiss: () => void;
}

/** Exported for component tests; application code uses `WorkforceProvider`. */
export const SessionNoticeContext = createContext<SessionNoticeValue>({
  lost: false,
  dismiss: () => undefined,
});

export function useSessionNotice(): SessionNoticeValue {
  return useContext(SessionNoticeContext);
}

export function WorkforceProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const base = `/${locale}/workforce`;
  const [lost, setLost] = useState(false);
  // Any 401 means the session ended (idle or absolute expiry, revocation, sign-out
  // elsewhere). See `expiryAction`: a failed submission keeps the page and its entries; a
  // failed read returns to login with this page as the return path.
  const redirecting = useRef(false);
  const api = useMemo(
    () =>
      new WorkforceApi({
        onUnauthenticated: (method) => {
          if (expiryAction(method) === 'keep') {
            setLost(true);
            return;
          }
          if (redirecting.current) return;
          redirecting.current = true;
          router.replace(
            expiredLoginPath(base, `${window.location.pathname}${window.location.search}`),
          );
        },
        onAuthenticatedResponse: () => setLost(false),
      }),
    [router, base],
  );
  const value = useMemo(
    () => ({ locale, t: getWorkforceDictionary(locale), api, base }),
    [locale, api, base],
  );
  const notice = useMemo(() => ({ lost, dismiss: () => setLost(false) }), [lost]);
  return (
    <WorkforceContext.Provider value={value}>
      <SessionNoticeContext.Provider value={notice}>{children}</SessionNoticeContext.Provider>
    </WorkforceContext.Provider>
  );
}

export function useWorkforce(): WorkforceContextValue {
  const value = useContext(WorkforceContext);
  if (!value) throw new Error('useWorkforce outside WorkforceProvider');
  return value;
}

export interface AccountContextValue {
  account: CurrentAccountResponse;
  signOut: () => Promise<void>;
}

/** Exported for component tests; application code uses `RequireWorkforce`. */
export const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount outside RequireWorkforce');
  return value;
}

type GuardState =
  | { kind: 'loading' }
  | { kind: 'workforce'; account: CurrentAccountResponse }
  | { kind: 'customer' }
  | { kind: 'error' };

/**
 * Client-side route guard for the authenticated workforce area. It is a UX gate only:
 * every API call is still authorized by the server. Anonymous sessions go to login;
 * customer sessions are refused with a sign-out option.
 */
export function RequireWorkforce({ children }: { children: ReactNode }) {
  const { api, base, t } = useWorkforce();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GuardState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    loadSession(api)
      .then((result) => {
        if (!active) return;
        if (result.kind === 'anonymous') {
          router.replace(`${base}/login?next=${encodeURIComponent(pathname)}`);
        } else if (result.kind === 'customer') {
          setState({ kind: 'customer' });
        } else {
          setState({ kind: 'workforce', account: result.account });
        }
      })
      .catch(() => active && setState({ kind: 'error' }));
    return () => {
      active = false;
    };
    // The session is resolved once per mount; navigation inside the area keeps it.
  }, [api]);

  const signOut = useCallback(async () => {
    try {
      await workforceLogout(api);
    } finally {
      router.replace(`${base}/login?signedOut=1`);
    }
  }, [api, base, router]);

  if (state.kind === 'loading') {
    return (
      <p className="wf-center" role="status">
        {t.auth.checking}
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="wf-center">
        <p role="alert">{t.errors.unavailable}</p>
        <button type="button" className="wf-button" onClick={() => window.location.reload()}>
          {t.common.reload}
        </button>
      </div>
    );
  }
  if (state.kind === 'customer') {
    return (
      <div className="wf-center">
        <p role="alert">{t.auth.customerNotAllowed}</p>
        <button type="button" className="wf-button" onClick={() => void signOut()}>
          {t.auth.signOut}
        </button>
      </div>
    );
  }
  return (
    <AccountContext.Provider value={{ account: state.account, signOut }}>
      {children}
    </AccountContext.Provider>
  );
}
