'use client';

import { Band, Button, EmptyState, SearchInput, useUrlState } from '@lucy-spa/ui';
import { Fragment, useMemo, type ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { fill } from '../../lib/fill';
import { matchesQuery } from '../../lib/search-core';

/** One service of the list as the search sees it: its code, the words it is found by, and the finished card (drawn on the server). */
export interface ServiceListItem {
  code: string;
  text: string;
  card: ReactNode;
}

export interface ServiceListGroup {
  code: string;
  name: string;
  items: readonly ServiceListItem[];
}

const SEARCH_DEFAULTS = { q: '' };

/**
 * The service list page below the server's header (DESIGN.md 9.2): the title band (the server's `intro`: the h1 and the sentence) with
 * the search, the sticky chips row (the server's group links, the bottom of the title band: B8), then one band for each group with a
 * heading and the cards. The bands alternate from the base color after the title band. The cards are server-rendered and handed in
 * finished; this client part only keeps the search in the address (`?q=`, so a search can be shared and Back returns to it) and shows the
 * cards whose name or description match (accents and case ignored).
 */
export function ServicesList({
  locale,
  groups,
  intro,
  chips,
}: {
  locale: Locale;
  groups: readonly ServiceListGroup[];
  /** The title band's content: the page's one h1 (id `services-title`) and its sentence. */
  intro: ReactNode;
  /** The group filter (links, drawn by the server page), kept at the top while the page scrolls. */
  chips: ReactNode;
}) {
  const text = getSiteText(locale).services;
  const [search, setSearch] = useUrlState(SEARCH_DEFAULTS);
  const query = search.q;
  const shown = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => matchesQuery(item.text, query)),
        }))
        .filter((group) => group.items.length > 0),
    [groups, query],
  );
  return (
    <>
      <Band tone="page" labelledBy="services-title" className="ls-svc-title">
        {intro}
        <div className="ls-svc-search" role="search" aria-label={text.searchLabel}>
          <SearchInput
            value={query}
            label={text.searchLabel}
            clearLabel={text.searchClear}
            hint={text.searchPlaceholder}
            debounceMs={150}
            onSearch={(q) => setSearch({ q }, { replace: true })}
          />
        </div>
      </Band>
      <div className="ls-svc-chips">
        <div className="ls-container">{chips}</div>
      </div>
      {shown.length === 0 ? (
        <Band tone="page">
          <EmptyState
            icon="search"
            title={text.noMatchTitle}
            action={
              <Button variant="secondary" onClick={() => setSearch({ q: '' })}>
                {text.searchClear}
              </Button>
            }
          >
            {fill(text.noMatch, { query })}
          </EmptyState>
        </Band>
      ) : (
        shown.map((group) => (
          <Band
            key={group.code}
            tone="page"
            labelledBy={`group-${group.code}`}
            className="ls-svc-group"
          >
            <h2 className="ls-site-h2" id={`group-${group.code}`}>
              {group.name}
            </h2>
            <ul className="ls-svc-grid">
              {/* Each finished card is its own `li`. */}
              {group.items.map((item) => (
                <Fragment key={item.code}>{item.card}</Fragment>
              ))}
            </ul>
          </Band>
        ))
      )}
    </>
  );
}
