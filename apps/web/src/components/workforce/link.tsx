'use client';

import { prefetchAllowed, readMotionEnvironment } from '@lucy-spa/ui';
import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * Whether this device may fetch pages ahead of a click: not in data saver mode and not on a low memory device (the same
 * environment check the motion uses). Read when a link renders; the answer is never part of the markup, so the server
 * and the first client render agree. On the server there is no browser to ask, and the answer is yes.
 */
function mayPrefetch(): boolean {
  return typeof window === 'undefined' || prefetchAllowed(readMotionEnvironment());
}

/**
 * The staff area's router link. `prefetch` loads the whole page as soon as the link is on screen, so a click opens it
 * at once (production builds only). A page here is only its code and layout: every list, number and form is fetched from
 * the API when the page opens, with `cache: 'no-store'`, so a prefetched page never shows old data. Data saver and low
 * memory devices turn the prefetch off and navigate as before.
 */
export function PrefetchLink({ prefetch, ...props }: ComponentProps<typeof Link>) {
  return <Link prefetch={prefetch ?? mayPrefetch()} {...props} />;
}
