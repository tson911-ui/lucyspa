'use client';

import { Breadcrumbs } from '@lucy-spa/ui';
import Link from 'next/link';

/** The trail above a public detail page; a client wrapper because the router link cannot be handed over from a server page. */
export function PublicBreadcrumbs({
  label,
  items,
}: {
  label: string;
  items: readonly { label: string; href?: string }[];
}) {
  return <Breadcrumbs label={label} items={items} LinkComponent={Link} />;
}
