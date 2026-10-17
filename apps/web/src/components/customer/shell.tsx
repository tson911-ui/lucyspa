'use client';

import { PublicMain, ToastProvider } from '@lucy-spa/ui';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCustomer } from './session';

/**
 * The signed-in member area. The header (menu, bell, account menu), footer and phone tab bar are the shared site frame; this is the
 * page's `main`. Each page draws its own title band and content band with `AccountScreen` (the Back row, the title, the tabs and the
 * "session lost" notice are there). The booking page is its own full-width flow (steps, summary, action bar) and draws its own main landmark.
 * The toast region answers an action that can be undone (removing a guest from a booking: "Hoàn tác", 8 s).
 */
export function CustomerShell({ children }: { children: ReactNode }) {
  const { base, t } = useCustomer();
  const pathname = usePathname();
  const booking = pathname === `${base}/book` || pathname.startsWith(`${base}/book/`);
  return (
    <ToastProvider regionLabel={t.common.toastRegion} dismissLabel={t.common.close}>
      {booking ? children : <PublicMain className="ls-main-tall">{children}</PublicMain>}
    </ToastProvider>
  );
}
