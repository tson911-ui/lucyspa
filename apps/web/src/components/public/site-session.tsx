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
  api: ApiClient;
  /** For a sign-out that has just completed, before the next read confirms it. */
  markSignedOut: () => void;
}

// Without a provider (the admin's season preview draws the header too) the visitor is simply not signed in.
const fallback: SiteSession = {
  signedIn: false,
  api: new ApiClient(),
  markSignedOut: () => undefined,
};
const Context = createContext<SiteSession>(fallback);

export const useSiteSession = (): SiteSession => useContext(Context);

export function SiteSessionProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => new ApiClient(), []);
  const [signedIn, setSignedIn] = useState(false);

  const refresh = useCallback(() => {
    let active = true;
    loadCustomerSession(api)
      .then((session) => active && setSignedIn(session.kind === 'customer'))
      // A failed read keeps the signed-out menus: sign-in is always reachable.
      .catch(() => active && setSignedIn(false));
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
    };
  }, [refresh]);

  const value = useMemo<SiteSession>(
    () => ({ signedIn, api, markSignedOut: () => setSignedIn(false) }),
    [signedIn, api],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
