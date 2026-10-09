'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CurrentAccountResponse } from '@lucy-spa/contracts';
import { ApiClient } from '../../lib/api/client';
import { loadCustomerSession } from '../../lib/customer/auth';
import { SITE_SESSION_CHANGED } from '../../lib/site-session';

/**
 * Who is signed in, for the parts of the site frame that depend on it (the menu entries for members, the phone tab
 * bar and the account menu). It only reads the session: every page and API call still authorizes on the server. A
 * sign-in or sign-out announces itself on the window (`announceSessionChange`) and this reads the session again.
 */
interface SiteSession {
  /** A customer (member) session is open. A staff session has no member pages, so it counts as not signed in. */
  signedIn: boolean;
  /** The member's own account while signed in (the bell needs it to link a notification), else null. */
  account: CurrentAccountResponse | null;
  api: ApiClient;
  /** False until the first answer (or failure) is in: a page that differs for members waits for it instead of flashing the guest view. */
  ready: boolean;
  /** For a sign-out that has just completed, before the next read confirms it. */
  markSignedOut: () => void;
}

// Without a provider (the admin's season preview draws the header too) the visitor is simply not signed in.
const fallback: SiteSession = {
  signedIn: false,
  account: null,
  ready: true,
  api: new ApiClient(),
  markSignedOut: () => undefined,
};
const Context = createContext<SiteSession>(fallback);

export const useSiteSession = (): SiteSession => useContext(Context);

export function SiteSessionProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => new ApiClient(), []);
  const [account, setAccount] = useState<CurrentAccountResponse | null>(null);
  const [ready, setReady] = useState(false);
  const signedIn = account !== null;

  const refresh = useCallback(() => {
    let active = true;
    // Known (either way) once the first answer or failure is in: the phone tab bar shows then (see site.css).
    const known = () => {
      document.documentElement.dataset['lsSession'] = 'ready';
      if (active) setReady(true);
    };
    loadCustomerSession(api)
      .then((session) => {
        if (active) setAccount(session.kind === 'customer' ? session.account : null);
        known();
      })
      // A failed read keeps the signed-out menus: sign-in is always reachable.
      .catch(() => {
        if (active) setAccount(null);
        known();
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let cancel = refresh();
    const changed = () => {
      cancel();
      cancel = refresh();
    };
    window.addEventListener(SITE_SESSION_CHANGED, changed);
    return () => {
      cancel();
      window.removeEventListener(SITE_SESSION_CHANGED, changed);
      delete document.documentElement.dataset['lsSession'];
    };
  }, [refresh]);

  const value = useMemo<SiteSession>(
    () => ({ signedIn, account, api, ready, markSignedOut: () => setAccount(null) }),
    [signedIn, account, api, ready],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
