'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicSeasonResponse } from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { siteDecorSpec } from '../../lib/season-core';
import { PREVIEW_SOURCE, parsePreviewMessage, seasonOfDraft } from '../../lib/season-preview';
import { HomeContent } from '../public/home-content';
import { siteFontClass } from '../public/site-fonts';
import { PublicFooter, PublicHeader } from '../public/site-chrome';
import { loadHomeDataInBrowser } from '../../lib/public-site-client';
import type { HomeData } from '../../lib/public-site-core';
import { SeasonSiteFrame } from './site-frame-view';

/**
 * The page behind the admin's full-page season preview (docs/UXUI_REDESIGN_S6_PLAN.md section 6): the real public
 * site, drawn from the draft the season form sends with `postMessage`. It only ever draws: it accepts a message only
 * from its parent frame or the window that opened it, on this origin, parses it with the live site's parser, keeps
 * nothing, and answers with "ready" and its own height. The theme and the preset are set on this document's own
 * `<html>` (and restored on leaving), so the admin page that holds the frame keeps its theme.
 */
export function SeasonPreviewStage({ locale }: { locale: Locale }) {
  const [season, setSeason] = useState<PublicSeasonResponse | null>(null);
  // The real home page: its shop profile, catalogue and slides are read here, in the browser, through the public routes.
  const [data, setData] = useState<HomeData | null>(null);
  useEffect(() => {
    let active = true;
    void loadHomeDataInBrowser((url, init) => fetch(url, init), locale).then((loaded) => {
      if (active) setData(loaded);
    });
    return () => {
      active = false;
    };
  }, [locale]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    const before = {
      season: html.getAttribute('data-season'),
      theme: html.getAttribute('data-theme'),
    };
    const origin = window.location.origin;
    const host = window.parent !== window ? window.parent : window.opener;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      if (
        event.source === null ||
        (event.source !== window.parent && event.source !== window.opener)
      ) {
        return;
      }
      const message = parsePreviewMessage(event.data);
      if (message?.type !== 'draft') return;
      const next = seasonOfDraft(message.draft);
      html.setAttribute('data-theme', message.theme);
      if (next) html.setAttribute('data-season', next.presetKey);
      else html.removeAttribute('data-season');
      setSeason(next);
    };
    window.addEventListener('message', onMessage);
    const tell = (message: { source: string; type: string; value?: number }) =>
      (host as Window | null)?.postMessage(message, origin);
    tell({ source: PREVIEW_SOURCE, type: 'ready' });
    const element = root.current;
    const observer =
      typeof ResizeObserver === 'undefined' || !element
        ? null
        : new ResizeObserver(() =>
            tell({ source: PREVIEW_SOURCE, type: 'height', value: element.offsetHeight }),
          );
    if (element) observer?.observe(element);
    return () => {
      window.removeEventListener('message', onMessage);
      observer?.disconnect();
      for (const [name, value] of [
        ['data-season', before.season],
        ['data-theme', before.theme],
      ] as const) {
        if (value === null) html.removeAttribute(name);
        else html.setAttribute(name, value);
      }
    };
  }, []);

  const decor = season ? siteDecorSpec(season, locale) : null;
  // The preview shows the home page, whose header is clear at the top (the preview's own path is not the home path).
  const header = <PublicHeader locale={locale} decor={decor} />;
  const footer = <PublicFooter locale={locale} site={data?.site ?? null} />;
  const home = data ? <HomeContent locale={locale} data={data} popup={false} /> : null;
  return (
    <div ref={root} className={`ls-season-preview-root ls-site ${siteFontClass}`}>
      {decor ? (
        <SeasonSiteFrame decor={decor} locale={locale} header={header} footer={footer}>
          {home}
        </SeasonSiteFrame>
      ) : (
        <div className="site-shell">
          {header}
          {home}
          {footer}
        </div>
      )}
    </div>
  );
}
