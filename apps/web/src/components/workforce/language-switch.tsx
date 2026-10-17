'use client';

import { buttonClass } from '@lucy-spa/ui';
import { PrefetchLink as Link } from './link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useWorkforce } from './session';

interface SwitchProps {
  className?: string;
  short?: boolean;
}

function LanguageLink({
  className = buttonClass('ghost'),
  short = false,
  search,
}: SwitchProps & { search: string }) {
  const { locale } = useWorkforce();
  const pathname = usePathname();
  const other = locale === 'vi' ? 'en' : 'vi';
  const name = other === 'vi' ? 'Tiếng Việt' : 'English';
  const href = `${pathname.replace(/^\/(vi|en)(?=\/|$)/, `/${other}`)}${search ? `?${search}` : ''}`;
  return (
    <Link
      href={href}
      hrefLang={other}
      lang={other}
      // Language names and codes are never machine-translated (WIG locale).
      translate="no"
      className={className}
      aria-label={short ? `${name} (${other.toUpperCase()})` : undefined}
    >
      {short ? other.toUpperCase() : name}
    </Link>
  );
}

function LanguageLinkWithQuery(props: SwitchProps) {
  // Outside the app router (unit tests) there is no search-params context and the hook returns null.
  const params = useSearchParams() as URLSearchParams | null;
  return <LanguageLink {...props} search={params?.toString() ?? ''} />;
}

/**
 * Switches between VI and EN on the same page (the locale is the first path segment), keeping the query (list filters, page,
 * sort). In the bars it shows the short code ("EN", like the customer header; session 10 DNA) with the language's full name as
 * its accessible name; in a menu it shows the full name. useSearchParams needs a Suspense boundary when a page is prerendered;
 * the fallback is the same link without the query.
 */
export function LanguageSwitch(props: SwitchProps) {
  return (
    <Suspense fallback={<LanguageLink {...props} search="" />}>
      <LanguageLinkWithQuery {...props} />
    </Suspense>
  );
}
