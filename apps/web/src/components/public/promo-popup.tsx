'use client';

import type { PublicPopupResponse } from '@lucy-spa/contracts';
import { PromoDialog, type PromoLink } from '@lucy-spa/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getDictionary } from '../../i18n/dictionaries';
import type { Locale } from '../../i18n/locales';
import {
  loadPublicPopup,
  markSessionSeen,
  popupSeenKey,
  publicPopupContent,
  sessionSeen,
} from '../../lib/popup-core';

const RouterLink: PromoLink = ({ href, className, onClick, children }) => (
  <Link href={href} {...(className ? { className } : {})} {...(onClick ? { onClick } : {})}>
    {children}
  </Link>
);

const browserStorage = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

/**
 * The promotional popup (design 16.5), mounted by the public home page only (Q-CM3): never on account,
 * workforce or checkout pages. It asks the API for the one live popup after the page has painted, shows it
 * as an accessible modal, and remembers for the browser session that it was shown (Q-CM4), so it appears
 * once per visit and again after the Owner edits it. The request is anonymous (no cookie) and any failure
 * means "no popup": the page itself is never blocked or changed.
 */
export function PromoPopup({ locale }: { locale: Locale }) {
  const [popup, setPopup] = useState<PublicPopupResponse | null>(null);
  const text = getDictionary(locale);

  useEffect(() => {
    let cancelled = false;
    // After first paint: the page's own content never waits for the popup.
    const timer = window.setTimeout(() => {
      const storage = browserStorage();
      void loadPublicPopup((url, init) => fetch(url, init), locale, sessionSeen(storage)).then(
        (found) => {
          if (cancelled || !found) return;
          // "Shown" counts as seen: a reload in the same session does not show it again.
          markSessionSeen(storage, popupSeenKey(found));
          setPopup(found);
        },
      );
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [locale]);

  if (!popup) return null;
  return (
    <PromoDialog
      content={publicPopupContent(popup)}
      label={text.promoLabel}
      closeLabel={text.promoClose}
      onClose={() => setPopup(null)}
      LinkComponent={RouterLink}
    />
  );
}
