'use client';

import { PublicMain } from '@lucy-spa/ui';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCustomer } from './session';

/**
 * The signed-in member area. The header (menu, bell, account menu), footer and phone tab bar are the shared site frame; this is the
 * page's `main`. Each page draws its own title band and content band with `AccountScreen` (the Back row, the title, the tabs and the
 * "session lost" notice are there). The booking page is its own full-width flow (steps, summary, action bar) and draws its own main landmark.
 */
export function CustomerShell({ children }: { children: ReactNode }) {
  const { base } = useCustomer();
  const pathname = usePathname();
  if (pathname === `${base}/book` || pathname.startsWith(`${base}/book/`)) return <>{children}</>;
  return <PublicMain className="ls-main-tall">{children}</PublicMain>;
}
