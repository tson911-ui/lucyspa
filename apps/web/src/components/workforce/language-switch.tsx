'use client';

import { buttonClass } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorkforce } from './session';

/** Switches between VI and EN on the same page (the locale is the first path segment). */
export function LanguageSwitch({ className = buttonClass('ghost') }: { className?: string }) {
  const { locale } = useWorkforce();
  const pathname = usePathname();
  const other = locale === 'vi' ? 'en' : 'vi';
  const href = pathname.replace(/^\/(vi|en)(?=\/|$)/, `/${other}`);
  return (
    <Link href={href} hrefLang={other} lang={other} className={className}>
      {other === 'vi' ? 'Tiếng Việt' : 'English'}
    </Link>
  );
}
