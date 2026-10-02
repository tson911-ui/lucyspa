'use client';

import { Button } from '@lucy-spa/ui';
import type { PublicSeasonResponse } from '@lucy-spa/contracts';
import { useEffect, useState } from 'react';
import { seasonText } from '../../i18n/season';
import type { Locale } from '../../i18n/locales';
import {
  parseAdminHidden,
  parsePublicSeason,
  publicSeasonUrl,
  serializeAdminHidden,
} from '../../lib/season-core';

/**
 * The admin side's small greeting chip (docs/UXUI_REDESIGN_DESIGN.md 20.5, Q-S4), shown on the dashboard while a
 * season applies to admin, with a per-device "hide" that also turns off the topbar accent line. No ornaments, no
 * particles, no motion. Hiding sets a cookie and the document attribute at once; "show" undoes both. Asked for
 * after the page has painted; any failure means nothing is shown.
 */
export function AdminSeasonChip({ locale }: { locale: Locale }) {
  const [season, setSeason] = useState<PublicSeasonResponse | null>(null);
  const [hidden, setHidden] = useState(false);
  const text = seasonText(locale);

  useEffect(() => {
    setHidden(parseAdminHidden(document.cookie));
    let cancelled = false;
    fetch(publicSeasonUrl(locale), { credentials: 'omit' })
      .then((response) => (response.status === 200 ? response.json() : null))
      .then((body: unknown) => {
        if (!cancelled) setSeason(parsePublicSeason(body));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (season === null || !season.admin) return null;

  const change = (next: boolean) => {
    document.cookie = serializeAdminHidden(next);
    if (next) document.documentElement.setAttribute('data-season-admin', 'off');
    else document.documentElement.removeAttribute('data-season-admin');
    setHidden(next);
  };

  return (
    <div className="ls-season-admin">
      {hidden ? null : <span className="ls-season-pchip">{season.greeting}</span>}
      <Button variant="ghost" onClick={() => change(!hidden)}>
        {hidden ? text.chipShow : text.chipHide}
      </Button>
    </div>
  );
}
