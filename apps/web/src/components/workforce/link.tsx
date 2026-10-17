'use client';

import { prefetchAllowed, readMotionEnvironment } from '@lucy-spa/ui';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { useListHref } from '../navigation/page-back';

/**
 * Whether this device may fetch pages ahead of a click: not in data saver mode and not on a low memory device (the same
 * environment check the motion uses). Read once per page load and cached (rbp js-cache-function-results: a board renders
 * dozens of links); the answer is never part of the markup, so the server and the first client render agree. On the server
 * there is no browser to ask, and the answer is yes.
 */
let prefetchAnswer: boolean | undefined;
function mayPrefetch(): boolean {
  if (typeof window === 'undefined') return true;
  prefetchAnswer ??= prefetchAllowed(readMotionEnvironment());
  return prefetchAnswer;
}

/**
 * The staff area's router link. It keeps Next's default prefetch (the route's shell once the link is on screen; the whole page only
 * where a caller passes `prefetch`), so a board of 24 record links no longer loads 24 whole pages (rbp bundle-preload, session 10).
 * Every list, number and form is fetched from the API when the page opens, with `cache: 'no-store'`, so a prefetched page never
 * shows old data. Data saver and low memory devices turn the prefetch off and navigate as before.
 */
export function PrefetchLink({ prefetch, ...props }: ComponentProps<typeof Link>) {
  return <Link prefetch={prefetch ?? (mayPrefetch() ? null : false)} {...props} />;
}

/**
 * A breadcrumb parent (`Breadcrumbs LinkComponent={ListCrumbLink}`): the list opens as it was left in this tab, with its filters,
 * search, sort and page (HIG C70). A parent that already carries the list state (the POS `?back=` query) is used as given.
 */
export function ListCrumbLink({
  href,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  return <PrefetchLink {...props} href={useListHref(href)} />;
}
